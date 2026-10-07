import { Readable } from 'node:stream';
import type { SpeechProfile } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import type { ServiceDatabase } from '../database.js';
import { streamUploadArtifact } from '../artifacts.js';
import { createAiCallRecord, updateAiCallRecord } from '../ai-call-trace.js';
import { PublicationStore, publicationError } from './store.js';
import { ffprobeAvailable, missingVideoDependency, type VideoBinaryProbe } from './runtime-preflight.js';

export async function speechKey(secrets: SecretStore, profile: SpeechProfile, database?:ServiceDatabase) {
  if(profile.connectionId){
    const row=database?.connection.prepare(`SELECT c.base_url,c.credential_account FROM service_connections c
      JOIN model_profiles m ON m.connection_id=c.id WHERE c.id=? AND c.enabled=1 AND m.enabled=1 AND m.model_id=?
      AND c.kind='openai-compatible-text' LIMIT 1`).get(profile.connectionId,profile.model);
    if(!row||String(row.base_url).replace(/\/+$/,'')!==profile.baseUrl.replace(/\/+$/,''))
      throw publicationError('publication_speech_connection_changed','配音来源连接已停用、删除或地址/模型改变，请重新选择配置。',409);
    const credential=row.credential_account?await secrets.get(String(row.credential_account),`STHSTART_SECRET_${profile.connectionId.toUpperCase().replace(/[^A-Z0-9]/g,'_')}`):{value:null};
    if(!credential.value)throw publicationError('publication_speech_key_missing','已配置的配音连接缺少可用密钥，请在公共服务中检查凭据。',409);
    return credential.value;
  }
  const secret = await secrets.get(`publication-speech:${profile.id}`, profile.secretEnvironment);
  if (!secret.value) throw publicationError('publication_speech_key_missing', `配音配置「${profile.name}」缺少独立密钥，请设置 ${profile.secretEnvironment} 或系统凭据。`, 409);
  return secret.value;
}
export async function synthesizeSpeech(input: { store: PublicationStore; config: ServiceConfig; secrets: SecretStore;
  activityId: string; taskId: string; profile: SpeechProfile; text: string; voice: string; fetcher?: typeof fetch; signal?: AbortSignal;
  /** Internal test seam for the dependency probe only; it never changes the API contract. */
  probe?: VideoBinaryProbe }) {
  const { store, config, secrets, activityId, taskId, profile, text, voice } = input;
  const key = await speechKey(secrets, profile,store.db);
  if (!profile.voices.includes(voice)) throw publicationError('publication_voice_missing', `声音 ${voice} 不在此配音服务清单中。`);
  // Confirm the audio probe before the paid TTS request: the returned mp3 is verified with FFprobe,
  // and a missing probe must fail here rather than after the provider has already been charged.
  const probe = input.probe ?? ffprobeAvailable;
  if (!(await probe('ffprobe'))) {
    const { code, message } = missingVideoDependency(['ffprobe']);
    throw publicationError(code, message, 409);
  }
  const body = { model: profile.model, input: text, voice, speed: profile.speed, response_format: 'mp3' };
  const callId = createAiCallRecord(store.db, { applicationId: 'activities', feature: 'publication', businessEvent: 'activity.publication.speech',
    callType: 'speech', traceId: taskId, objectType: 'publication-utterance', objectId: `${activityId}:${store.task(taskId).targetId}`,
    models: [profile.model], provider: profile.baseUrl, parameters: { voice, speed: profile.speed }, requestSnapshot: body,
    sourceUrl: `/apps/activities/${activityId}`, redactionSecrets: [key] });
  store.updateTask(taskId, { callId });
  updateAiCallRecord(store.db, callId, { status: 'running', event: 'speech.request' });
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(`${profile.baseUrl.replace(/\/$/,'')}/audio/speech`, { method:'POST',
      headers: { authorization:`Bearer ${key}`, 'content-type':'application/json' }, body:JSON.stringify(body),
      redirect:'error', signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  } catch {
    updateAiCallRecord(store.db, callId, { status:'unknown', errorCode:'speech_result_unknown', errorMessage:'配音提交结果无法确定，请人工核对提供商账单；不会自动重试。' });
    throw publicationError('publication_speech_unknown', '配音超时或断流，提交结果不确定；额度仍已计入，不自动重新收费调用。', 409);
  }
  if (!response.ok || !response.body) {
    updateAiCallRecord(store.db, callId, { status:'failed', errorCode:'speech_upstream_error', errorMessage:`配音上游 HTTP ${response.status}` });
    throw publicationError('publication_speech_failed', `配音服务返回 HTTP ${response.status}，请查看服务配置和额度。`);
  }
  const type = response.headers.get('content-type')?.split(';')[0] ?? 'audio/mpeg';
  if (!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','application/octet-stream'].includes(type)) {
    updateAiCallRecord(store.db,callId,{status:'failed',errorCode:'speech_invalid_response',errorMessage:'配音返回的不是音频。'});
    throw publicationError('publication_speech_invalid', '配音服务没有返回可识别音频。');
  }
  try {
    const artifact = await streamUploadArtifact(config,store.db,{appId:'activities',stream:Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      contentType: type === 'application/octet-stream' ? 'audio/mpeg' : type, originalName:type.includes('wav')?'speech.wav':'speech.mp3',
      refType:'publication_history',refId:`publication:${activityId}:${taskId}`,metadata:{publicationActivityId:activityId,inputHash:store.task(taskId).inputHash}});
    const checked = store.artifact(artifact.id,'audio');
    if (!checked.has_audio || !Number.isFinite(Number(checked.duration_ms)) || Number(checked.duration_ms) <= 0 || Number(checked.duration_ms)>300000) throw publicationError('publication_speech_invalid','无法读取有效配音音轨或超过5分钟，请确认 FFprobe 可用及音频格式。');
    updateAiCallRecord(store.db,callId,{status:'succeeded',artifactIds:[artifact.id],event:'speech.persisted',detail:{durationMs:Number(checked.duration_ms)},usage:{inputCharacters:text.length},redactionSecrets:[key]});
    return artifact.id;
  } catch (error) {
    updateAiCallRecord(store.db,callId,{status:'unknown',errorCode:'speech_persistence_failed',errorMessage:'上游已返回，但音频保存或探测失败；不会再次调用上游。'});
    throw publicationError('publication_speech_unknown', '配音已返回但保存失败，请人工核对；不自动重新调用。', 409);
  }
}
