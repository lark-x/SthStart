import { randomInt } from 'node:crypto';
import type { PublicationDocument, PublicationApprovalRequest, PublicationTask, SpeechProfile } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { createGenerationTask, cancelGenerationTask } from '../generation/execution.js';
import { getGenerationTask } from '../generation/task-store.js';
import { updateAiCallRecord } from '../ai-call-trace.js';
import { PublicationStore, contentFingerprint, fingerprint, publicationError, shotFingerprint, utteranceFingerprint } from './store.js';
import { imagePlan, preflightImage, type FrozenImagePlan } from './images.js';
import { speechKey, synthesizeSpeech } from './speech.js';
import { exportPublication } from './exports.js';
import { checkVideoDependencies, missingVideoDependency, probeBinary, type VideoBinary, type VideoBinaryProbe } from './runtime-preflight.js';

export interface FrozenProductionConfig { contentHash: string; images: FrozenImagePlan[]; speech: SpeechProfile | null; makeVideo: boolean }
interface ImageTaskInput { plan: FrozenImagePlan; seed: number; sourceFingerprint: string }
interface SpeechTaskInput { text: string; voice: string; profile: SpeechProfile; sourceFingerprint: string }

export class PublicationWorker {
  private active: Promise<void> | null = null;
  private closed = false;
  private abort = new AbortController();
  private interval: ReturnType<typeof setInterval> | null = null;
  private taskAbort: { runId: string; controller: AbortController } | null = null;
  private readonly videoProbe: VideoBinaryProbe;
  // Defaults to the real host probe so production gating is never conditional on a test seam.
  // Tests may inject an equivalent factory to simulate a missing binary.
  constructor(readonly store: PublicationStore, readonly config: ServiceConfig, readonly secrets: SecretStore, readonly fetcher: typeof fetch = fetch, probe: VideoBinaryProbe = probeBinary) {
    this.videoProbe = probe;
  }
  /**
   * Reject `makeVideo` runs before any paid image/speech request when the service host is
   * missing FFmpeg/FFprobe. Comics (`makeVideo === false`) skip this and never need the binaries.
   */
  private async requireVideoDependencies() {
    const check = await checkVideoDependencies(this.videoProbe);
    if (!check.ok) { const { code, message } = missingVideoDependency(check.missing); throw publicationError(code, message, 409); }
  }
  async configuration(doc: PublicationDocument, input: Pick<PublicationApprovalRequest,'speechProfileId'|'makeVideo'>, live: boolean): Promise<FrozenProductionConfig> {
    this.store.validate(doc);
    const images:FrozenImagePlan[]=[];
    for(const shot of doc.shots) {
      const plan=live?await preflightImage(this.store.db,doc,shot,this.secrets,this.fetcher):imagePlan(this.store.db,doc,shot);
      for(const reference of plan.inputArtifacts) this.store.artifact(reference.artifactId,'image');
      images.push(plan);
    }
    const speech=input.speechProfileId?this.store.speechProfile(input.speechProfileId):null;
    if(input.makeVideo && !speech && doc.shots.some(s=>s.utterances.some(u=>!u.selectedAudioArtifactId))) throw publicationError('publication_speech_missing','视频需要独立配音配置，或为每句上传已有配音。漫画不需要配置配音。',409);
    if(speech && input.makeVideo && doc.shots.some(s=>s.utterances.some(u=>!u.selectedAudioArtifactId))) {
      if(live) await speechKey(this.secrets,speech,this.store.db);
      for(const u of doc.shots.flatMap(s=>s.utterances)) {
        const voice=u.voiceBindingId??doc.actors.find(a=>a.id===u.speakerActorId)?.voiceBindingId??speech.defaultVoice;
        if(!speech.voices.includes(voice)) throw publicationError('publication_voice_missing',`对白 ${u.id} 的声音 ${voice} 不在配音清单中。`);
      }
    }
    return {contentHash:contentFingerprint(doc),images,speech,makeVideo:input.makeVideo};
  }
  async approve(activityId:string,input:PublicationApprovalRequest) {
    const draft=this.store.assertVersion(activityId,input.expectedDraftVersion);
    if(input.makeVideo) await this.requireVideoDependencies();
    const config=await this.configuration(draft.document,input,true);
    if(input.expectedConfigHash && fingerprint(config)!==input.expectedConfigHash) throw publicationError('publication_configuration_changed','预览后配置已改变，请重新核对配置。',409);
    const chars=draft.document.shots.flatMap(s=>s.utterances).filter(u=>!u.selectedAudioArtifactId).reduce((n,u)=>n+u.text.length,0);
    if(input.makeVideo && chars>input.speechCharacterBudget) throw publicationError('publication_budget_invalid',`需批准至少 ${chars} 字配音额度。`);
    return this.store.approve(activityId,input,config);
  }
  async start(activityId:string,approvalId:string,key:string) {
    const approval=this.store.approval(activityId,approvalId), config=this.store.approvedConfig<FrozenProductionConfig>(approval.id), draft=this.store.requireDraft(activityId);
    const existing=this.store.listRuns(activityId).find(r=>r.approvalId===approvalId);
    if(existing) return this.store.createRun(activityId,approvalId,key);
    // Re-check at start: the environment may have changed between approve and the actual run.
    if(config.makeVideo) await this.requireVideoDependencies();
    const current=await this.configuration(draft.document,approval,false);
    if(fingerprint(current)!==approval.configHash) throw publicationError('publication_configuration_changed','生图或配音配置已变化，请重新人工确认。',409);
    const run=this.store.createRun(activityId,approvalId,key);
    // Deterministic task keys also cover recovery after a process crash during task initialization.
    this.initializeRun(run.id,activityId,approval.revisionId,config);
    this.wake();
    return this.store.run(activityId,run.id);
  }
  private initializeRun(runId:string,activityId:string,revisionId:string,config:FrozenProductionConfig) {
    const doc=this.store.revisionDocument(activityId,revisionId);
    this.store.db.transaction(()=>{
      for(const shot of doc.shots) {
        if(!shot.selectedImage) this.store.createTask(runId,'image',shot.id,{plan:config.images.find(p=>p.shotId===shot.id),seed:randomInt(1,2**31),sourceFingerprint:shotFingerprint(doc,shot.id)},`image:${shot.id}`);
        if(config.makeVideo) for(const u of shot.utterances) if(!u.selectedAudioArtifactId && config.speech) {
          this.store.createTask(runId,'speech',u.id,{text:u.text,voice:u.voiceBindingId??doc.actors.find(a=>a.id===u.speakerActorId)?.voiceBindingId??config.speech.defaultVoice,
            profile:config.speech,sourceFingerprint:utteranceFingerprint(doc,u.id)},`speech:${u.id}`);
        }
      }
      this.store.updateRun(runId,'running');
    });
  }
  latestTasks(tasks:PublicationTask[]):PublicationTask[] {
    const map=new Map<string,PublicationTask>();
    for(const t of tasks) map.set(`${t.kind}:${t.targetId}`,t);
    return [...map.values()];
  }
  recover() {
    const rows=this.store.db.connection.prepare("SELECT id,status,generation_task_id,call_id FROM publication_tasks WHERE status IN ('preparing','running')").all();
    for(const row of rows) {
      if(row.generation_task_id) { this.store.updateTask(String(row.id),{status:'running'});continue; }
      const unknown=row.status==='running';
      this.store.updateTask(String(row.id),{status:unknown?'unknown':'interrupted',error:unknown?'服务重启，已提交结果无法确定；不会自动重复调用。':'服务重启前未提交；需要人工发起重试。'});
      if(row.call_id) updateAiCallRecord(this.store.db,String(row.call_id),{status:'unknown',event:'publication.recovered_uncertain',errorMessage:'服务重启后提交状态无法确定。'});
    }
    const empty=this.store.db.connection.prepare("SELECT r.id,r.activity_id,a.revision_id,a.config_json FROM publication_runs r JOIN publication_approvals a ON a.id=r.approval_id WHERE r.status='queued' AND NOT EXISTS (SELECT 1 FROM publication_tasks t WHERE t.run_id=r.id)").all();
    for(const row of empty) this.initializeRun(String(row.id),String(row.activity_id),String(row.revision_id),JSON.parse(String(row.config_json)) as FrozenProductionConfig);
  }
  startScheduler() {
    this.recover();
    this.interval=setInterval(()=>this.wake(),2000);this.interval.unref();this.wake();
  }
  wake() {
    if(this.closed||this.active) return;
    this.active=this.pump().catch(()=>undefined).finally(()=>{this.active=null;});
  }
  async close() { this.closed=true;if(this.interval) clearInterval(this.interval);this.abort.abort();await this.active; }
  async stop(activityId:string,runId:string) {
    const run=this.store.run(activityId,runId);this.store.updateRun(runId,'stopped');
    if(this.taskAbort?.runId===runId) this.taskAbort.controller.abort();
    for(const task of run.tasks) {
      if(task.status==='queued') this.store.updateTask(task.id,{status:'stopped',error:'用户停止制作。'});
      if(task.generationTaskId && task.status==='running') await cancelGenerationTask(this.config,this.store.db,this.secrets,task.generationTaskId,'activities',this.fetcher).catch(()=>undefined);
    }
    return this.store.run(activityId,runId);
  }
  retryShot(activityId:string,shotId:string,runId:string,key:string) {
    const run=this.store.run(activityId,runId), approval=this.store.approval(activityId,run.approvalId), frozen=this.store.revisionDocument(activityId,approval.revisionId);
    if(!frozen.shots.some(s=>s.id===shotId) || shotFingerprint(frozen,shotId)!==shotFingerprint(this.store.requireDraft(activityId).document,shotId)) throw publicationError('publication_approval_stale','镜头内容已改变，请重新人工确认。',409);
    const existing=this.store.db.connection.prepare('SELECT id,target_id,kind FROM publication_tasks WHERE run_id=? AND idempotency_key=?').get(runId,key);
    if(existing) { if(existing.kind!=='image'||existing.target_id!==shotId) throw publicationError('publication_idempotency_conflict','重复键与镜头不一致。',409);return this.store.task(String(existing.id)); }
    if(run.tasks.some(t=>t.kind==='image' && t.targetId===shotId && ['unknown','running','preparing','queued'].includes(t.status))) throw publicationError('publication_result_unknown','该镜头仍在处理或结果不确定，不能再次提交。',409);
    if(run.imagesUsed>=approval.imageBudget) throw publicationError('publication_budget_exceeded','此轮图片额度已用完。',409);
    const plan=this.store.approvedConfig<FrozenProductionConfig>(approval.id).images.find(p=>p.shotId===shotId)!;
    const task=this.store.createTask(runId,'image',shotId,{plan,seed:randomInt(1,2**31),sourceFingerprint:plan.sourceFingerprint},key);
    this.store.updateRun(runId,'running');this.wake();return task;
  }
  async retryUtterance(activityId:string,utteranceId:string,runId:string,key:string) {
    const run=this.store.run(activityId,runId),approval=this.store.approval(activityId,run.approvalId);
    const existing=this.store.db.connection.prepare('SELECT id,target_id,kind FROM publication_tasks WHERE run_id=? AND idempotency_key=?').get(runId,key);
    if(existing){if(existing.kind!=='speech'||existing.target_id!==utteranceId)throw publicationError('publication_idempotency_conflict','重复键与对白不一致。',409);return this.store.task(String(existing.id));}
    if(run.status==='stopped')throw publicationError('publication_stopped','此轮已停止，不能追加配音。',409);
    const frozen=this.store.revisionDocument(activityId,approval.revisionId),current=this.store.requireDraft(activityId).document;
    const u=frozen.shots.flatMap(s=>s.utterances).find(u=>u.id===utteranceId);
    if(!u||contentFingerprint(frozen)!==contentFingerprint(current))throw publicationError('publication_approval_stale','方案或声音已变化，请重新人工确认。',409);
    const config=this.store.approvedConfig<FrozenProductionConfig>(approval.id);
    if(!config.makeVideo||!config.speech)throw publicationError('publication_speech_missing','本轮未批准配音。',409);
    const prepared=await this.configuration(current,approval,false);
    if(fingerprint(prepared)!==approval.configHash)throw publicationError('publication_configuration_changed','批准配置已改变。',409);
    const input:SpeechTaskInput={text:u.text,voice:u.voiceBindingId??frozen.actors.find(a=>a.id===u.speakerActorId)?.voiceBindingId??config.speech.defaultVoice,profile:config.speech,sourceFingerprint:utteranceFingerprint(frozen,u.id)};
    const task=this.store.db.transaction(()=>{
      const latest=this.store.run(activityId,runId);
      const same=this.store.db.connection.prepare('SELECT id,target_id,kind FROM publication_tasks WHERE run_id=? AND idempotency_key=?').get(runId,key);
      if(same){if(same.kind!=='speech'||same.target_id!==utteranceId)throw publicationError('publication_idempotency_conflict','重复键与对白不一致。',409);return this.store.task(String(same.id));}
      if(latest.status==='stopped')throw publicationError('publication_stopped','此轮已停止。',409);
      if(contentFingerprint(frozen)!==contentFingerprint(this.store.requireDraft(activityId).document))throw publicationError('publication_approval_stale','方案已变化。',409);
      if(latest.tasks.some(t=>t.kind==='speech'&&t.targetId===utteranceId&&['unknown','running','preparing','queued'].includes(t.status)))throw publicationError('publication_result_unknown','配音正在处理或结果未知，不能重投。',409);
      const reusable=latest.tasks.some(t=>t.kind==='speech'&&t.inputHash===fingerprint(input)&&t.status==='succeeded'&&t.artifactIds.some(id=>{try{this.store.artifact(id,'audio');return true;}catch{return false;}}));
      // Admission counts queued retries atomically; execution retains the existing atomic reservation.
      const pending=this.store.db.connection.prepare("SELECT input_json FROM publication_tasks WHERE run_id=? AND kind='speech' AND status IN ('queued','preparing')").all(runId).reduce((n,r)=>n+(JSON.parse(String(r.input_json)) as SpeechTaskInput).text.length,0);
      if(!reusable&&latest.speechCharactersUsed+pending+u.text.length>approval.speechCharacterBudget)throw publicationError('publication_budget_exceeded','本轮剩余配音字数不足，请重新确认。',409);
      const created=this.store.createTask(runId,'speech',utteranceId,input,key);this.store.updateRun(runId,'running');return created;
    });
    this.wake();return task;
  }
  async export(activityId:string,expected:number,makeVideo:boolean,key:string) {
    const draft=this.store.assertVersion(activityId,expected), run=this.store.listRuns(activityId)[0];
    if(!run) throw publicationError('publication_run_missing','请先人工确认制作方案，或运行制作，再导出。',409);
    for(const shot of draft.document.shots){
      if(!shot.selectedImage) throw publicationError('publication_image_missing',`镜头 ${shot.id} 尚未选图。`,409);
      this.store.artifact(shot.selectedImage.artifactId,'image');
      if(makeVideo) for(const u of shot.utterances){
        if(!u.selectedAudioArtifactId) throw publicationError('publication_audio_missing',`对白 ${u.id} 未配音。`,409);
        this.store.artifact(u.selectedAudioArtifactId,'audio');
      }
    }
    const revisionId=this.store.db.transaction(()=>this.store.revision(activityId,draft.document));
    const task=this.store.createTask(run.id,'export','publication',{revisionId,makeVideo},key);
    // Replaying the same export must return its persisted result, not reopen a finished run.
    if(task.status!=='queued') return task;
    this.store.updateRun(run.id,'running');this.wake();return task;
  }
  private async applyResult(activityId:string,task:PublicationTask,artifactId:string) {
    const draft=this.store.requireDraft(activityId), doc=draft.document;
    if(task.kind==='image') {
      const shot=doc.shots.find(s=>s.id===task.targetId), input=this.store.taskInput<ImageTaskInput>(task.id);
      if(shot && !shot.selectedImage && shotFingerprint(doc,shot.id)===input.sourceFingerprint) this.store.selectImage(activityId,draft.draftVersion,shot.id,artifactId);
    } else if(task.kind==='speech') {
      const u=doc.shots.flatMap(s=>s.utterances).find(u=>u.id===task.targetId), input=this.store.taskInput<SpeechTaskInput>(task.id);
      if(u && !u.selectedAudioArtifactId && utteranceFingerprint(doc,u.id)===input.sourceFingerprint) this.store.selectAudio(activityId,draft.draftVersion,u.id,artifactId);
    }
  }
  private async reconcile(activityId:string,task:PublicationTask) {
    const generated=getGenerationTask(this.store.db,task.generationTaskId!,'activities');
    if(!generated) {this.store.updateTask(task.id,{status:'unknown',error:'关联生成任务不可查，不会重新提交。'});return;}
    if(['completed','succeeded'].includes(generated.status)) {
      const images=generated.artifacts.filter(a=>a.mediaKind==='image').map(a=>a.artifactId);
      const available=images.filter(id=>{try{this.store.artifact(id,'image');return true;}catch{return false;}});
      if(!available.length) {this.store.updateTask(task.id,{status:'failed',error:'上游完成但图片未持久保存或文件不可读。'});return;}
      this.store.taskHistory(task.id,available);await this.applyResult(activityId,task,available[0]);
    } else if(['failed','abandoned','cancelled'].includes(generated.status)) {
      this.store.updateTask(task.id,{status:generated.upstreamMayContinue?'unknown':'failed',error:generated.errorMessage??'上游生成失败。'});
    }
  }
  private async execute(activityId:string,task:PublicationTask) {
    if(!this.store.claim(task.id)) return;
    const controller=new AbortController();this.taskAbort={runId:task.runId,controller};
    const signal=AbortSignal.any([this.abort.signal,controller.signal]);
    let reserved=false;
    try {
      if(task.kind==='image') {
        const input=this.store.taskInput<ImageTaskInput>(task.id), run=this.store.run(activityId,task.runId), approval=this.store.approval(activityId,run.approvalId), frozen=this.store.revisionDocument(activityId,approval.revisionId);
        const shot=frozen.shots.find(s=>s.id===task.targetId)!;
        if(shotFingerprint(this.store.requireDraft(activityId).document,shot.id)!==input.sourceFingerprint) throw publicationError('publication_source_changed','镜头内容已改变，此任务停止。',409);
        if(approval.makeVideo) await this.requireVideoDependencies();
        const current=await preflightImage(this.store.db,frozen,shot,this.secrets,this.fetcher);
        if(fingerprint(current)!==fingerprint(input.plan)) throw publicationError('publication_configuration_changed','工作流或模型配置已变化，停止此轮制作。',409);
        this.store.reserve(task.id,1);reserved=true;
        const plan=input.plan;
        await createGenerationTask(this.config,this.store.db,this.secrets,{appId:'activities',purpose:plan.purpose,workflowId:plan.workflowId,workflowVersion:plan.workflowVersion,
          engineId:plan.engineId,presetId:plan.presetId,presetRevision:plan.presetRevision,inputs:plan.inputs,seed:input.seed,
          inputArtifacts:plan.inputArtifacts,activityLoras:plan.loras,isInternal:true,validationMode:'strict',idempotencyKey:`publication:${task.id}`,
          audit:{feature:'publication',businessEvent:'activity.publication.image',objectType:'publication-shot',objectId:`${activityId}:${task.targetId}`,
            traceId:task.runId,positivePrompt:plan.positivePrompt,negativePrompt:plan.negativePrompt,sourceUrl:`/apps/activities/${activityId}`,
            visualConfiguration:{promptOrigin:'harness_structured',sourceFingerprint:plan.sourceFingerprint,configurationHash:plan.configurationHash}},
          onInsertTask:snapshot=>{
            this.store.updateTask(task.id,{generationTaskId:snapshot.taskId,callId:snapshot.callId});
            updateAiCallRecord(this.store.db,snapshot.callId,{event:'publication.prompt.compiled',detail:{promptOrigin:'harness_structured',structuredPrompt:shot.structuredPrompt,finalPrompt:plan.positivePrompt,seed:snapshot.actualSeed}});
          }},this.fetcher);
      } else if(task.kind==='speech') {
        const input=this.store.taskInput<SpeechTaskInput>(task.id);
        const approval=this.store.approval(activityId,this.store.run(activityId,task.runId).approvalId);
        if(utteranceFingerprint(this.store.requireDraft(activityId).document,task.targetId)!==input.sourceFingerprint) throw publicationError('publication_source_changed','对白已改变，停止原配音。',409);
        if(fingerprint(this.store.speechProfile(input.profile.id))!==fingerprint(input.profile)) throw publicationError('publication_configuration_changed','配音配置已改变，请重新确认。',409);
        const previous=this.store.db.connection.prepare(`SELECT t.output_json FROM publication_tasks t JOIN publication_runs r ON r.id=t.run_id
          WHERE r.activity_id=? AND t.id<>? AND t.kind='speech' AND t.status='succeeded' AND t.input_hash=? ORDER BY t.created_at DESC`).all(activityId,task.id,task.inputHash);
        for(const row of previous){
          const artifactId=(JSON.parse(String(row.output_json)) as string[])[0];
          try{this.store.artifact(artifactId,'audio');}catch{continue;}
          this.store.taskHistory(task.id,[artifactId]);await this.applyResult(activityId,task,artifactId);return;
        }
        // Independent speech verifies its audio with FFprobe, and a video run also needs FFmpeg,
        // so confirm the real host dependencies before reserving budget or sending any paid request.
        const required:VideoBinary[]=approval.makeVideo?['ffmpeg','ffprobe']:['ffprobe'];
        for(const binary of required) if(!(await this.videoProbe(binary))) { const { code, message } = missingVideoDependency([binary]); throw publicationError(code, message, 409); }
        await speechKey(this.secrets,input.profile,this.store.db);this.store.reserve(task.id,input.text.length);reserved=true;
        const artifactId=await synthesizeSpeech({store:this.store,config:this.config,secrets:this.secrets,activityId,taskId:task.id,profile:input.profile,text:input.text,voice:input.voice,fetcher:this.fetcher,signal});
        this.store.taskHistory(task.id,[artifactId]);await this.applyResult(activityId,task,artifactId);
      } else {
        this.store.updateTask(task.id,{status:'running'});
        const input=this.store.taskInput<{revisionId:string;makeVideo:boolean}>(task.id);
        const assets=await exportPublication({store:this.store,config:this.config,activityId,taskId:task.id,...input,signal});
        this.store.taskHistory(task.id,assets);
      }
    } catch(error) {
      const e=error as Error&{code?:string};
      // A linked unified task is authoritative even if a later callback throws.
      if(this.store.task(task.id).generationTaskId) return;
      const unknown=e.code==='publication_speech_unknown'||(reserved&&!e.code);
      this.store.updateTask(task.id,{status:unknown?'unknown':'failed',error:e.message||'制作失败。'});
    } finally {
      this.taskAbort=null;
    }
  }
  async pump() {
    const rows=this.store.db.connection.prepare("SELECT id,activity_id FROM publication_runs WHERE status IN ('queued','running') ORDER BY created_at,id").all();
    for(const row of rows) {
      if(this.closed) break;
      const activityId=String(row.activity_id),runId=String(row.id);
      let run=this.store.run(activityId,runId);
      for(const task of run.tasks.filter(t=>t.status==='running' && t.generationTaskId)) await this.reconcile(activityId,task);
      run=this.store.run(activityId,runId);
      const tasks=this.latestTasks(run.tasks);
      // Explicit exports freeze currently selected media; an older failed drawing must not block them.
      const requestedExport=tasks.find(t=>t.kind==='export'&&t.status==='queued');
      if(requestedExport){await this.execute(activityId,requestedExport);return;}
      const uncertain=tasks.find(t=>['unknown','interrupted'].includes(t.status));
      if(uncertain) {this.store.updateRun(runId,uncertain.status);continue;}
      if(tasks.some(t=>t.status==='failed')) {this.store.updateRun(runId,'failed');continue;}
      if(tasks.some(t=>['running','preparing'].includes(t.status))) continue;
      const queued=tasks.find(t=>t.status==='queued');
      if(queued) {
        if(queued.kind==='image') {
          const inflight=this.store.db.connection.prepare(`SELECT 1 FROM publication_tasks t LEFT JOIN generation_tasks g ON g.id=t.generation_task_id
            WHERE t.kind='image' AND t.id<>? AND (t.status='preparing' OR (t.status='running' AND (g.status IS NULL OR g.status IN ('queued','submitting','accepted','running')))) LIMIT 1`).get(queued.id);
          if(inflight) continue;
        }
        await this.execute(activityId,queued);return;
      }
      const approval=this.store.approval(activityId,run.approvalId);
      if(!run.tasks.some(t=>t.kind==='export')) {
        const doc=this.store.requireDraft(activityId).document;
        if(contentFingerprint(doc)!==contentFingerprint(this.store.revisionDocument(activityId,approval.revisionId))) {this.store.updateRun(runId,'interrupted');continue;}
        try{await this.export(activityId,this.store.requireDraft(activityId).draftVersion,approval.makeVideo,`export:${run.id}`);}
        catch(error){const failed=this.store.createTask(run.id,'export','publication',{revisionId:approval.revisionId,makeVideo:approval.makeVideo},`export-error:${run.id}`);this.store.updateTask(failed.id,{status:'failed',error:(error as Error).message});this.store.updateRun(run.id,'failed');}
        return;
      }
      this.store.updateRun(runId,'succeeded');
    }
  }
}
