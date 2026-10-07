import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildActivityDocument, type StudioTarget } from '@sthstart/contracts';
import { ServiceDatabase, nowIso } from './database.js';
import { readConfig } from './config.js';
import { SecretStore } from './security.js';
import { createService } from './server.js';
import { ActivityStore } from './activities/store.js';
import { applyParityConfig } from './activities/parity-config.js';
import { commitImageConfigRevision, getImageConfigDraft } from './activities/image-configs.js';
import { installVisualTestWorkflow } from './activities/test-support/visual-workflow.js';
import { previewBeatRenderSourceFingerprint } from './activities/beat-renders.js';
import { setDefaultPreset } from './generation/configuration-store.js';
import { PARITY_HIRES_WORKFLOW_ID, PARITY_TEXT_ENCODER, PARITY_VAE, PARITY_BASE_UNET } from './activities/parity-workflows.js';

/**
 * 细化（放大重绘）阶段 4A／4B 的服务端测试夹具。
 *
 * 全部使用内存数据库与临时产物目录；不连接真实 ComfyUI，不写入 data/sthstart.db。
 * 这不是测试文件：命名不带 `.test`，不会被 node --test 当作用例收集。
 */

const token = 'isolated-studio-hires-admin-token', headers = { 'x-sthstart-admin-token': token };
const ADMIN_TOKEN_HASH = createHash('sha256').update(token).digest('hex');
const SOURCE_WORKFLOW_ID = 'source-beat-flow';
export const SOURCE_FINGERPRINT = 'source-fingerprint-1';

/** 只读 PNG 头所需的最小合法文件：签名 + IHDR（含真实宽高与颜色类型）。 */
export function pngBytes(width: number, height: number, colorType: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
    return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
}

export function upstreamMock() {
  const graphs: Record<string, unknown>[] = [], bodies: string[] = [], requests: string[] = [];
  const objectInfo = {
    CLIPTextEncode: { input: { required: { text: ['STRING', {}] } } },
    KSampler: { input: { required: {} } },
    VAEDecode: { input: { required: {} } },
    VAEEncode: { input: { required: {} } },
    SaveImage: { input: { required: {} } },
    EmptyLatentImage: { input: { required: {} } },
    LoadImage: { input: { required: { image: [[], {}] } } },
    EmptyImage: { input: { required: {} } },
    ImageCompositeMasked: { input: { required: {} } },
    InvertMask: { input: { required: { mask: ['MASK', {}] } } },
    ImageScale: { input: { required: {} } },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['base.safetensors', 'turbo.safetensors'], {}] } } },
    UNETLoader: { input: { required: { unet_name: [[PARITY_BASE_UNET, 'anima_turboV10.safetensors'], {}] } } },
    CLIPLoader: { input: { required: { clip_name: [[PARITY_TEXT_ENCODER], {}] } } },
    VAELoader: { input: { required: { vae_name: [[PARITY_VAE], {}] } } },
    LoraLoaderModelOnly: { input: { required: { lora_name: [['test-lora.safetensors'], {}] } } },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/object_info')) return Response.json(objectInfo);
    if (url.endsWith('/upload/image')) return Response.json({ name: `uploaded-${bodies.length + 1}.png`, subfolder: '', type: 'input' });
    if (url.endsWith('/prompt')) {
      const body = String(init?.body); bodies.push(body);
      graphs.push((JSON.parse(body) as { prompt: Record<string, unknown> }).prompt);
      return Response.json({ prompt_id: `hires-prompt-${graphs.length}` });
    }
    if (url.includes('/history/')) {
      const id = url.split('/history/')[1];
      return Response.json({ [id]: { status: { status_str: 'success', completed: true }, outputs: { '13': { images: [{ filename: `${id}-one.png`, subfolder: '', type: 'output' }] } } } });
    }
    if (url.includes('/view?')) return new Response(new Uint8Array(pngBytes(2048, 1368, 2)), { headers: { 'content-type': 'image/png' } });
    if (url.endsWith('/queue')) return Response.json({ queue_running: [], queue_pending: [] });
    return new Response('not found', { status: 404 });
  };
  return { fetcher, graphs, bodies, requests };
}

/** 源工作流的实际渲染图：一个 KSampler、直接绑定编码器的正负文本、原图加载器。 */
export function sourceSnapshot(): Record<string, unknown> {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: PARITY_BASE_UNET, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: PARITY_TEXT_ENCODER, type: 'qwen_image', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: PARITY_VAE } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '@ebora, masterpiece, 1girl, alice, long hair' } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: 'score_1, score_2, bad anatomy' } },
    '8': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 512, batch_size: 1 } },
    '9': { class_type: 'KSampler', inputs: {
      model: ['1', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0],
      seed: 4242, steps: 31, cfg: 5, sampler_name: 'er_sde', scheduler: 'beta', denoise: 1,
    } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: 'sthstart/anima_activity_parity' } },
  };
}

export interface HiresFixture {
  database: ServiceDatabase; config: ReturnType<typeof readConfig>; secrets: SecretStore;
  activities: ActivityStore; activityId: string; stageId: string; target: StudioTarget;
  artifactId: string; sourceTaskId: string; sourceSha256: string; sourcePath: string;
  sourceFingerprint: string;
  mock: ReturnType<typeof upstreamMock>; hiresVersion: number;
  previewRequest: Record<string, unknown>;
}

export function hiresFixture(options: { width?: number; height?: number; colorType?: number } = {}): HiresFixture {
  const width = options.width ?? 768, height = options.height ?? 512, colorType = options.colorType ?? 2;
  const artifactDirectory = mkdtempSync(join(tmpdir(), 'sthstart-studio-hires-'));
  const database = new ServiceDatabase();
  const now = nowIso();
  const config = readConfig({ STHSTART_ADMIN_TOKEN: token, STHSTART_ARTIFACT_DIR: artifactDirectory });
  const secrets = new SecretStore({});
  const mock = upstreamMock();
  const activities = new ActivityStore(database);

  database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
    VALUES ('activities','活动',?,'[]',1,?,?)`).run(ADMIN_TOKEN_HASH, now, now);
  database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at)
    VALUES ('hires-engine','本地 ComfyUI','comfyui','http://127.0.0.1:8188',1,1,?,?)`).run(now, now);

  const sourceGraph = sourceSnapshot();
  const sourceSchema = {
    prompt: { semantic: 'prompt', type: 'string', required: true },
    negativePrompt: { semantic: 'negative_prompt', type: 'string' },
    unet_name: { semantic: 'unet', type: 'model' }, clip_name: { semantic: 'clip', type: 'model' }, vae_name: { semantic: 'vae', type: 'model' },
    seed: { semantic: 'seed', type: 'seed' }, width: { semantic: 'width', type: 'integer' }, height: { semantic: 'height', type: 'integer' },
    steps: { semantic: 'steps', type: 'integer' }, cfg: { semantic: 'cfg', type: 'number' },
    sampler_name: { semantic: 'sampler_name', type: 'enum' }, scheduler: { semantic: 'scheduler', type: 'enum' },
  };
  const sourceBindings = {
    prompt: ['6', 'inputs', 'text'], negativePrompt: ['7', 'inputs', 'text'],
    unet_name: ['1', 'inputs', 'unet_name'], clip_name: ['2', 'inputs', 'clip_name'], vae_name: ['3', 'inputs', 'vae_name'],
    seed: ['9', 'inputs', 'seed'], width: ['8', 'inputs', 'width'], height: ['8', 'inputs', 'height'],
    steps: ['9', 'inputs', 'steps'], cfg: ['9', 'inputs', 'cfg'], sampler_name: ['9', 'inputs', 'sampler_name'], scheduler: ['9', 'inputs', 'scheduler'],
  };
  const editorConfig = {
    version: 2, modelSelection: 'preset-locked', fields: {}, loraSlots: [],
    activityLoraInjection: { targetNodeId: '9', targetInput: 'model' },
    promptAssembly: 'service-finalized-v1', sizePresets: [], constraints: {},
  };
  database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,category,created_at,updated_at)
    VALUES (?,'源镜头工作流','','comfyui',1,'image',?,?)`).run(SOURCE_WORKFLOW_ID, now, now);
  database.connection.prepare(`INSERT INTO generation_workflow_versions
    (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,
     input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES (?,1,'hires-engine',?,?,?,?,1,?,'{}','["image/png"]','{}',2,?)`).run(
    SOURCE_WORKFLOW_ID, JSON.stringify(sourceSchema), JSON.stringify(sourceBindings), '["11"]',
    JSON.stringify(sourceGraph), now, JSON.stringify(editorConfig));

  const content = buildActivityDocument({
    templateId: 'blank', title: '细化测试活动', type: '测试', theme: '', location: '营地', rules: '',
    actors: [{ id: 'a', displayName: '研究员', persona: { appearance: { baseText: '银发' } }, outfitDescription: '蓝衣',
      activityRole: '', visualLoras: [], appearanceReferenceAssetKeys: [] } as never],
  });
  const stageId = content.stages[0].id;
  content.scenes = [{ id: 'scene-1', stageId, title: '实验', timeText: '傍晚', locationText: '营地', environment: '暖光',
    beats: [{ id: 'beat-1', characterId: 'a', action: '观察结晶', dialogue: '稳定。', outcome: '记录参数', renderSettings: {} }] }];
  content.mediaSlots = [{ id: 'slot-1', kind: 'image', stageId, caption: '结晶素材', shotDescription: '营地实验台', actorIds: ['a'], sourceFactIds: [] }];
  const activity = activities.createActivity({ title: content.activity.title, type: '测试', initialDocument: content }).activity;

  // 当前画面描述必须可解析，来源描述变化（stale）检查才有意义。
  const visual = installVisualTestWorkflow(database);
  setDefaultPreset(database, visual.draft.presetId);
  const imageConfig = getImageConfigDraft(database, activity.id);
  commitImageConfigRevision(database, activities, activity.id, imageConfig.draftVersion, activity.headVersion);

  // 源生成任务：真实渲染图 + 实际输入 + 冻结的 LoRA 配置。
  const sourceTaskId = 'source-task-1';
  const sourceBytes = pngBytes(width, height, colorType);
  const sourcePath = join(artifactDirectory, 'source.png');
  writeFileSync(sourcePath, sourceBytes);
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  database.connection.prepare(`INSERT INTO generation_tasks
    (id,app_id,engine_id,workflow_id,workflow_version,purpose,idempotency_key,request_hash,request_params_json,workflow_snapshot_json,
     actual_seed,status,upstream_may_continue,cancellation_scope,created_at,updated_at,priority,progress_json)
    VALUES (?,'activities','hires-engine',?,1,'activity_image_text','source-key','source-hash',?,?,4242,'succeeded',0,'none',?,?,'normal','{}')`).run(
    sourceTaskId, SOURCE_WORKFLOW_ID,
    JSON.stringify({ inputs: { prompt: '@ebora, masterpiece, 1girl, alice, long hair', negativePrompt: 'score_1, score_2, bad anatomy' }, inputArtifacts: [], activityLoras: [] }),
    JSON.stringify(sourceGraph), now, now);

  const artifactId = 'source-artifact-1';
  database.connection.prepare(`INSERT INTO artifacts(id,app_id,task_id,local_path,content_type,byte_size,sha256,media_type,file_status,created_at)
    VALUES (?,'activities',?,?,'image/png',?,?,'image','ready',?)`).run(artifactId, sourceTaskId, sourcePath, sourceBytes.length, sourceSha256, now);
  database.connection.prepare(`INSERT INTO generation_task_artifacts(task_id,artifact_id,output_name,sort_order,created_at)
    VALUES (?,?,'default',0,?)`).run(sourceTaskId, artifactId, now);

  const candidateId = 'source-candidate-1';
  // 来源指纹必须与当前内容编译出的指纹一致，否则“来源已变化”会永远为真。
  const fingerprint = previewBeatRenderSourceFingerprint(database, activity.id, { stageId, sceneId: 'scene-1', beatId: 'beat-1' });
  if (!fingerprint) throw new Error('hires fixture requires a resolvable beat source fingerprint');
  database.connection.prepare(`INSERT INTO activity_beat_render_candidates
    (id,activity_id,stage_id,scene_id,beat_id,idempotency_key,request_fingerprint,source_fingerprint,draft_version,status,
      positive_prompt,negative_prompt,created_at,original_prompt,prompt_optimization_status,auto_apply_state,auto_apply_draft_version,
      task_id,artifact_id,artifact_sha256)
    VALUES (?,?,?,?,?,'source-candidate-key','fp',?,1,'succeeded','@ebora','score_1',?,'@ebora','skipped','ineligible',1,?,?,?)`).run(
    candidateId, activity.id, stageId, 'scene-1', 'beat-1', fingerprint, now, sourceTaskId, artifactId, sourceSha256);
  database.connection.prepare(`INSERT INTO activity_beat_render_candidate_outputs(candidate_id,artifact_id,sort_order,created_at)
    VALUES (?,?,0,?)`).run(candidateId, artifactId, now);

  // 细化工作流：走既有注册路径发布 anima-activity-hires-basic。
  applyParityConfig(database, { engineId: 'hires-engine', hiresWorkflowId: PARITY_HIRES_WORKFLOW_ID });
  const hiresVersion = Number(database.connection.prepare('SELECT MAX(version) AS version FROM generation_workflow_versions WHERE workflow_id=?')
    .get(PARITY_HIRES_WORKFLOW_ID)!.version);

  return {
    database, config, secrets, activities, activityId: activity.id, stageId,
    target: { kind: 'beat', stageId, sceneId: 'scene-1', beatId: 'beat-1' },
    artifactId, sourceTaskId, sourceSha256, sourcePath, mock, hiresVersion, sourceFingerprint: fingerprint,
    previewRequest: {
      // 计划 §6.2 要求预览也校验请求版本，因此这里必须给出**当前**真实版本：
      // 不能用创建时的活动快照（`activity`），也不能硬编码 contentDraftVersion。
      // 第 168 行的 commitImageConfigRevision 会推进版本，用旧值会让预览被版本校验正确拒绝。
      versions: (() => {
        const current = activities.getActivity(activity.id)!;
        const draft = activities.getDraft(activity.id)!;
        // 图片配置必须读**库里的**草稿：内存里的 `imageConfig.baseRevisionId` 是提交前的 null，
        // 而第 168 行 commitImageConfigRevision 已经写入了真实修订号。
        const configDraft = getImageConfigDraft(database, activity.id);
        return {
          headVersion: current.headVersion,
          contentDraftVersion: draft.draftVersion,
          contentRevisionId: current.currentContentRevisionId,
          imageConfigDraftVersion: configDraft.draftVersion,
          imageConfigRevisionId: configDraft.baseRevisionId,
        };
      })(),
      target: { kind: 'beat', stageId, sceneId: 'scene-1', beatId: 'beat-1' },
      sourceArtifactId: artifactId, maxSize: 2000, denoise: 0.2, seed: 7,
    },
  };
}

export function closeFixture(fixture: HiresFixture) {
  fixture.database.close();
}

/**
 * 供路由测试使用：真实 Fastify 实例 + 同一内存数据库。
 * 返回的 `close` 必须在关闭数据库**之前**调用：路由里的后台细化任务由
 * `app.close()` 的 onClose 钩子等待，先关库会让仍在轮询的任务读到已关闭的连接。
 */
export async function hiresService(fixture: HiresFixture) {
  const { app } = await createService({ database: fixture.database, config: fixture.config, secrets: fixture.secrets, fetcher: fixture.mock.fetcher });
  return { app, headers, url: `/api/v1/admin/activities/${fixture.activityId}/studio/hires`, close: () => app.close() };
}
