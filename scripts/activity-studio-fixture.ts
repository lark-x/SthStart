/** Isolated browser fixture: in-memory databases and a fresh OS temp media directory.
 * No user credentials, configured ComfyUI, or real project database are loaded. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createHash,randomUUID } from 'node:crypto';
import { buildActivityDocument } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from '../apps/service/src/database.js';
import { readConfig } from '../apps/service/src/config.js';
import { createService } from '../apps/service/src/server.js';
import { SecretStore } from '../apps/service/src/security.js';
import { ActivityStore } from '../apps/service/src/activities/store.js';
import { getImageConfigDraft } from '../apps/service/src/activities/image-configs.js';
import { installVisualTestWorkflow } from '../apps/service/src/activities/test-support/visual-workflow.js';
import { setDefaultPreset } from '../apps/service/src/generation/configuration-store.js';
import { persistArtifact } from '../apps/service/src/artifacts.js';
import {prepareStudioContext,readStudioContext} from '../apps/service/src/activities/studio-context.js';
import {createStudioBatch,prepareStudioBatch,startStudioBatch,processStudioBatch,listStudioItems} from '../apps/service/src/activities/studio-batches.js';
import {recoverStudioJobs,resumeStudioJob} from '../apps/service/src/activities/studio-recovery.js';
import { applyParityConfig } from '../apps/service/src/activities/parity-config.js';
import { PARITY_HIRES_WORKFLOW_ID } from '../apps/service/src/activities/parity-workflows.js';
import {StudioStore} from '../apps/service/src/activities/studio-store.js';

if (!process.argv.includes('--isolated')) throw new Error('Pass --isolated to run this synthetic fixture.');
const token = 'activity-studio-fixture-token-not-production';
const database = new ServiceDatabase(':memory:');
const mediaDirectory = mkdtempSync(join(tmpdir(), 'sthstart-studio-ui-'));
const config = readConfig({ SERVICE_PORT: '4289', STHSTART_ADMIN_TOKEN: token, STHSTART_ARTIFACT_DIR: mediaDirectory,
  STHSTART_LOG_DIR: join(mediaDirectory, 'logs'), PORTAL_ORIGINS: 'http://127.0.0.1:4199' });

// Small deterministic gradient PNG. This is synthetic test data, not a user image.
function png() {
  const width = 640, height = 360;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels[offset] = 70 + Math.floor(x / 5); pixels[offset + 1] = 80 + Math.floor(y / 3); pixels[offset + 2] = 145;
  }
  const chunk = (kind: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(kind), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4); prefix.writeUInt32BE(data.length); suffix.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([prefix, body, suffix]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const image = png();
let promptNumber = 0;
let failNextImage=false;
let failNextText:'bad_json'|'transport'|null=null;
const textModels:string[]=[];
const fetcher: typeof fetch = async (input, options) => {
  const url = String(input);
  if (url.endsWith('/object_info')) return Response.json({
    CLIPTextEncode: { input: { required: { text: ['STRING',{}] } } }, KSampler: { input: { required: {} } },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors','turbo.safetensors'],{}] } } },
    SaveImage: { input: { required: {} } }, EmptyLatentImage: { input: { required: {} } },
  });
  if (url.endsWith('/chat/completions')) {
    const body = JSON.parse(String(options?.body ?? '{}'));
    textModels.push(String(body.model));
    if(failNextText){const mode=failNextText;failNextText=null;if(mode==='transport')throw new Error('synthetic unknown text transport');return Response.json({choices:[{message:{content:'{synthetic bad JSON'}}]});}
    const prompt = JSON.stringify(body.messages ?? []);
    const requestText = (body.messages ?? []).map((message: { content?: string }) => message.content ?? '').join('\n');
    let result = 'a young scientist studying a glass flask, snowy mountain camp, clear composition, no lettering';
    if (prompt.includes('画面调整助手')) {
      result=JSON.stringify({patch:{director:{shotSize:'wide',angle:'high',lighting:'warm',mood:'calm'},expression:'放松眉眼'},explanation:'只调整景别、俯视角度、暖光与平静表情，保留原动作和人物。'});
    } else if (prompt.includes('剧情分镜导演')) {
      const count = Number(requestText.match(/恰好 (\d+) 镜/)?.[1] ?? 6);
      result = JSON.stringify({ scene: { title: '智能分镜 · 结晶实验', timeText: '傍晚', locationText: '雪山营地', environment: '实验台透出微光' },
        beats: Array.from({ length: count }, (_, index) => ({ actorIds: ['scientist'], primaryActorId: 'scientist',
          action: `观察结晶的第 ${index + 1} 个动作`, dialogue: '记下这次变化。', outcome: '', director: { shotSize: index % 2 ? 'closeup' : 'wide' }, composition: '实验台位于前景' })) });
    } else if (prompt.includes('漫画分镜导演')) {
      const count = Number(requestText.match(/恰好返回 (\d+) 格/)?.[1] ?? 6);
      const beats = JSON.parse(requestText.match(/可用镜头：(\[[^\n]+\])/u)?.[1] ?? '[]');
      result = JSON.stringify({ panels: Array.from({ length: count }, (_, index) => ({ sourceBeatIds: [beats[index % beats.length]?.id], actorIds: ['scientist'],
        shotSize: 'medium', visualDescription: `观察结晶第 ${index + 1} 格`, composition: '实验台在前景', textSafeArea: 'top_left', bubbles: [{ kind: 'speech', speakerActorId: 'scientist', text: '反应稳定。' }] })) });
    }
    return Response.json({ choices: [{ message: { content: result } }] });
  }
  if (url.endsWith('/prompt')) {promptNumber++;if(failNextImage){failNextImage=false;return Response.json({error:'synthetic image failure'},{status:400});}return Response.json({ prompt_id: `fixture-${promptNumber}` });}
  if (url.includes('/history/')) { const id = url.split('/history/')[1]; return Response.json({ [id]: { status: { status_str: 'success', completed: true },
    outputs: { '5': { images: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] } } } }); }
  if (url.includes('/view?')) return new Response(new Uint8Array(image), { headers: { 'content-type': 'image/png' } });
  if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
  return new Response('Synthetic upstream has no such path', { status: 404 });
};
const { app } = await createService({ config, database, secrets: new SecretStore({}), fetcher });
let fixtureInfo: { activityId: string; stageId: string; sceneId: string; beatId: string };
app.get('/fixture', async () => ({...fixtureInfo,promptNumber,textModels}));
// Test-only fault injection. This fixture refuses to start without --isolated and has no persistent user data.
app.post('/fixture/fail-next-image',async(request,reply)=>{
  if(request.headers['x-sthstart-admin-token']!==token)return reply.code(401).send({error:'unauthorized'});
  failNextImage=true;return {armed:true};
});
app.post('/fixture/fail-next-text',async(request,reply)=>{
  if(request.headers['x-sthstart-admin-token']!==token)return reply.code(401).send({error:'unauthorized'});
  failNextText=(request.body as {mode?:string}|undefined)?.mode==='transport'?'transport':'bad_json';return {armed:true};
});
app.post('/fixture/recovery-sample',async(request,reply)=>{
  if(request.headers['x-sthstart-admin-token']!==token)return reply.code(401).send({error:'unauthorized'});
  const activityId=fixtureInfo.activityId,versions=prepareStudioContext(database,activityId,readStudioContext(database,activityId)),jobs=new StudioStore(database);
  const job=createStudioBatch(database,config,activityId,{kind:'render_batch',versions,idempotencyKey:`recovery-${randomUUID()}`,
    input:{targets:['beat-test','beat-two'].map(beatId=>({kind:'beat',stageId:fixtureInfo.stageId,sceneId:fixtureInfo.sceneId,beatId})),candidateCount:1,placement:'history_only'}});
  const options={database,config,secrets:new SecretStore({}),activityId,jobId:job.id,fetcher};
  await prepareStudioBatch(options);const reviewed=jobs.get(activityId,job.id)!;
  startStudioBatch(database,config,activityId,job.id,{expectedJobRevision:reviewed.revision,planHash:reviewed.planHash!});
  // Simulated restart before a request, then execute only the explicitly chosen first item.
  recoverStudioJobs(database,config,{startup:true,jobId:job.id});const interrupted=jobs.get(activityId,job.id)!;
  const items=listStudioItems(database,activityId,job.id).items;
  resumeStudioJob(database,config,activityId,job.id,{expectedJobRevision:interrupted.revision,planHash:interrupted.planHash!,itemIds:[items[0].id]});
  await processStudioBatch(options);
  return {jobId:job.id,items:listStudioItems(database,activityId,job.id).items,promptNumber};
});
const profiles = installVisualTestWorkflow(database);
setDefaultPreset(database, profiles.draft.presetId);
const now = nowIso();
database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
 VALUES ('fixture-text','模拟优化器','llm','http://fixture.test/v1','fixture-model',NULL,1,?,?)`).run(now, now);
database.connection.prepare(`INSERT INTO provider_profiles(id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
 VALUES ('fixture-backup','模拟备用模型','llm','http://fixture.test/v1','fixture-backup-model',NULL,1,?,?)`).run(now, now);
database.connection.prepare("INSERT INTO app_llm_assignments(app_id,role,profile_id,updated_at) VALUES ('activities','text','fixture-text',?)").run(now);
const content = buildActivityDocument({ templateId: 'blank', title: '工作台隔离验收 · 雪山实验', type: '测试', theme: '实验', location: '雪山营地', rules: '',
  actors: [{ id: 'scientist', displayName: '研究员', persona: { appearance: { baseText: '银色短发，绿色眼睛' } }, activityRole: '', outfitDescription: '蓝色实验外套' }] });
const stageId = content.stages[0].id;
content.scenes = [{ id: 'scene-test', stageId, title: '雪山低温萃取', timeText: '傍晚 18:30', locationText: '雪山营地', environment: '风雪渐起，烧瓶内透出金色微光',
  beats: [{ id: 'beat-test', characterId: 'scientist', action: '轻轻摇晃试管，观察结晶变化', dialogue: '低温并未抑制反应。', outcome: '记录新发现' },
    { id: 'beat-two', characterId: 'scientist', action: '在实验日志上记录参数', dialogue: '记下这次变化。' }] }];
content.mediaSlots = [{ id: 'slot-test', kind: 'image', stageId, caption: '雪山实验', shotDescription: '研究员观察结晶', actorIds: ['scientist'], sourceFactIds: [] }];
const store = new ActivityStore(database);
const created = store.createActivity({ title: content.activity.title, type: '测试', initialDocument: content });
const activityId = created.activity.id;
const draft = getImageConfigDraft(database, activityId);
const committed = await app.inject({ method: 'POST', url: `/api/v1/admin/activities/${activityId}/art-direction/commit`, headers: { 'x-sthstart-admin-token': token },
  payload: { expectedHeadVersion: store.getActivity(activityId)!.headVersion, expectedImageConfigDraftVersion: draft.draftVersion,
    document: { ...draft.document, globalStylePrompt: 'clean ink illustration', globalNegativePrompt: '', artDirection: {
      selectedStyle: null, quality: 'draft', canvas: { width: 1024, height: 768 }, renderProfiles: profiles, parameterOverrides: {} } } } });
if (committed.statusCode !== 200) throw new Error(committed.body);
// 路线 A（第二轮 §4o）：**只在显式带 --with-hires 时**绑定细化工作流。
// 不带开关时行为与之前完全一致——`activity-image-parity-browser.mjs` 第 72–73 行依赖
// 「夹具未绑定细化工作流 → 预览返回 409」，无条件绑定会作废上一轮已验收的证据。
if (process.argv.includes('--with-hires')) {
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
   VALUES ('hires-engine','本地 ComfyUI','comfyui','http://127.0.0.1:8188',1,1,?,?)`).run(now, now);
  applyParityConfig(database, { engineId: 'hires-engine', hiresWorkflowId: PARITY_HIRES_WORKFLOW_ID });
  // 第 2 件（交付记录 §4q）：细化要求**来源图有可读快照**，即源图必须由
  // 「服务端完成装配」的流程绘制。installVisualTestWorkflow 默认是 workflow-internal，
  // 直接用它画的源图会被细化以 hires_source_snapshot_unavailable 拒绝（已实测）。
  // 这里只改工作流版本的 editor_config，不动共享的 test-support 文件——
  // 后者被 V2 脚本依赖（它断言的是 workflow-internal）。
  const workflowRow = database.connection.prepare(
    "SELECT editor_config_json FROM generation_workflow_versions WHERE workflow_id='visual-flow' AND version=1").get() as { editor_config_json: string };
  const workflowEditor = JSON.parse(workflowRow.editor_config_json);
  workflowEditor.promptAssembly = 'service-finalized-v1';
  database.connection.prepare(
    "UPDATE generation_workflow_versions SET editor_config_json=? WHERE workflow_id='visual-flow' AND version=1")
    .run(JSON.stringify(workflowEditor));
  // 合成图里的 KSampler 原本没有 positive/negative 连线，快照解析器因此
  // 无法从采样器回溯到标准文本编码器（实测报错：「采样器的该输入没有连接到标准文本编码器」）。
  // 这里按真实 ComfyUI 的形状补上连线，否则 service-finalized 快照仍然解析不出来。
  const graphRow = database.connection.prepare(
    "SELECT definition_json FROM generation_workflow_versions WHERE workflow_id='visual-flow' AND version=1").get() as { definition_json: string };
  const graph = JSON.parse(graphRow.definition_json);
  graph['3'].inputs.positive = ['1', 0];
  graph['3'].inputs.negative = ['2', 0];
  // 快照解析还要求采样参数可读（实测报错：「原图执行快照缺少可用的采样参数
  // （steps、cfg、sampler、scheduler），无法安全复用」）。补齐图的输入与 schema 声明。
  graph['3'].inputs.steps = 31;
  graph['3'].inputs.cfg = 5;
  graph['3'].inputs.sampler_name = 'er_sde';
  graph['3'].inputs.scheduler = 'normal';
  database.connection.prepare(
    "UPDATE generation_workflow_versions SET definition_json=? WHERE workflow_id='visual-flow' AND version=1")
    .run(JSON.stringify(graph));
  const schemaRow = database.connection.prepare(
    "SELECT input_schema_json FROM generation_workflow_versions WHERE workflow_id='visual-flow' AND version=1").get() as { input_schema_json: string };
  const schema = JSON.parse(schemaRow.input_schema_json);
  schema.cfg = { type: 'number', semantic: 'cfg' };
  schema.sampler_name = { type: 'enum', semantic: 'sampler_name', options: ['er_sde'] };
  schema.scheduler = { type: 'enum', semantic: 'scheduler', options: ['normal'] };
  database.connection.prepare(
    "UPDATE generation_workflow_versions SET input_schema_json=? WHERE workflow_id='visual-flow' AND version=1")
    .run(JSON.stringify(schema));
  console.log(JSON.stringify({ hiresBound: true, hiresWorkflowId: PARITY_HIRES_WORKFLOW_ID, sourceAssembly: 'service-finalized-v1' }));
}
const artifactId = await persistArtifact(config, database, { appId: 'activities', sourceUrl: 'http://visual.test/view?filename=fixture.png', trustedBaseUrl: 'http://visual.test',
  contentType: 'image/png', refType: 'activity_asset', refId: `fixture:${activityId}` }, fetcher);
store.saveAsset({ activityId, assetKey: 'fixture-image', artifactId, source: 'upload', type: 'image', width: 640, height: 360,
  hash: createHash('sha256').update(image).digest('hex'), createdAt: now });
fixtureInfo = { activityId, stageId, sceneId: 'scene-test', beatId: 'beat-test' };
await app.listen({ host: config.host, port: config.port });
console.log(JSON.stringify({ isolated: true, service: 'http://127.0.0.1:4289', activityId, mediaDirectory }));
let closing = false;
const close = async () => { if (closing) return; closing = true; await app.close(); database.close(); process.exit(0); };
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
