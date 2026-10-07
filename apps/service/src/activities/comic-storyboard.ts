import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import type { ActivityScene, ComicDocument, ComicPage, ComicPanel, ComicStoryboardModelOutput, ContentDocument, ComicStoryboardRequest } from '@sthstart/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { ActivityStore } from './store.js';
import { callLlm } from './text-jobs.js';
import { parseAiJsonOutput } from './prompts.js';
import { ComicStore } from './comic-store.js';
import { ComicStoryboardRequestSchema, ComicStoryboardApplyRequestSchema, ComicStoryboardModelOutputSchema } from '@sthstart/contracts';

type AdminCheck = (request: FastifyRequest, reply: FastifyReply) => boolean;
type StoryboardRequest = Pick<ComicStoryboardRequest, 'stageId' | 'sceneId' | 'panelCount' | 'instructions'>;

function codedError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function sceneFor(document: ContentDocument, stageId: string, sceneId: string): ActivityScene | null {
  const stage = document.stages.find((item) => item.id === stageId);
  if (!stage) return null;
  const topLevel = (document.scenes ?? []).find((item) => item.id === sceneId && item.stageId === stageId);
  if (topLevel) return topLevel;
  const nested = (stage.scenes ?? []).find((item) => item.id === sceneId && (!item.stageId || item.stageId === stageId));
  return nested ? { ...nested, stageId } : null;
}

export function buildComicStoryboardPrompt(input: {
  content: ContentDocument; stageId: string; sceneId: string; panelCount: number; instructions?: string;
}): string {
  const stage = input.content.stages.find((item) => item.id === input.stageId);
  const scene = sceneFor(input.content, input.stageId, input.sceneId);
  if (!stage || !scene) throw codedError('comic_source_not_found', '漫画分镜来源的阶段或场次不存在。', 409);
  const actorIds = new Set([...stage.actorIds, ...scene.beats.map((beat) => beat.characterId).filter(Boolean)]);
  const actors = input.content.actors.filter((actor) => actorIds.has(actor.id)).map((actor) => ({
    id: actor.id, name: actor.displayName, role: actor.activityRole, appearance: actor.persona.appearance, outfit: actor.outfitDescription,
  }));
  const beats = scene.beats.map((beat) => ({ id: beat.id, actorId: beat.characterId, actorName: beat.characterName,
    action: beat.action, dialogue: beat.dialogue, outcome: beat.outcome }));
  return [
    '你是漫画分镜导演。只返回符合给定 Schema 的 JSON 对象，不要 Markdown 或说明文字。',
    '只允许使用输入中的角色 ID 和镜头 ID；不得增加原剧情不存在的重大事件。',
    '每格表现一个主要动作或情绪，用远景、中景、特写的变化组织节奏。',
    '枚举字段必须逐字使用下列英文值，不能使用近义词、下划线变体或额外方位：shotSize 只能是 "wide"、"medium"、"closeup"、"detail"；textSafeArea 只能是 "none"、"top_left"、"top_right"、"bottom"；bubbles.kind 只能是 "speech"、"caption"、"emphasis"。例如特写是 "closeup"，不是 "close_up"；底部留白只能是 "bottom"，不能是 "bottom_left" 或 "bottom_right"。',
    '台词只能写入 bubbles，visualDescription 只描述画面，不要求画出台词文字。',
    '画面描述应让后续绘图模型容易呈现；构图留白按 textSafeArea 标示，不要返回坐标、HTML、URL、代码或工作流参数。',
    `必须恰好返回 ${input.panelCount} 格；每格至少关联一个输入镜头。`,
    `用户补充要求：${input.instructions?.trim() || '无'}`,
    `剧情冻结版本：${input.content.activity.title}`,
    `阶段：${JSON.stringify({ id: stage.id, title: stage.title, location: stage.location, instruction: stage.instruction })}`,
    `场次：${JSON.stringify({ id: scene.id, title: scene.title, timeText: scene.timeText, locationText: scene.locationText, environment: scene.environment })}`,
    `可用角色：${JSON.stringify(actors)}`,
    `可用镜头：${JSON.stringify(beats)}`,
    '输出结构示例：{"panels":[{"sourceBeatIds":["beat-id"],"actorIds":["actor-id"],"shotSize":"medium","visualDescription":"...","composition":"...","textSafeArea":"top_left","bubbles":[{"kind":"speech","speakerActorId":"actor-id","text":"..."}]}]}',
  ].join('\n\n');
}

function validateStoryboardOutput(raw: unknown, source: ContentDocument, request: StoryboardRequest): ComicStoryboardModelOutput {
  if (!Value.Check(ComicStoryboardModelOutputSchema, raw)) {
    const first = [...Value.Errors(ComicStoryboardModelOutputSchema, raw)].slice(0, 5).map((error) => `${error.path || '/'}: ${error.message}`).join('；');
    throw codedError('comic_storyboard_invalid_output', `模型返回的分镜结构不合法：${first}`);
  }
  const output = raw as ComicStoryboardModelOutput;
  if (output.panels.length !== request.panelCount) throw codedError('comic_storyboard_panel_count', `模型返回了 ${output.panels.length} 格，要求 ${request.panelCount} 格。`);
  const scene = sceneFor(source, request.stageId, request.sceneId);
  const stage = source.stages.find((item) => item.id === request.stageId);
  if (!scene || !stage) throw codedError('comic_source_not_found', '剧情冻结版本中找不到指定阶段或场次。', 409);
  const actorIds = new Set(source.actors.map((actor) => actor.id));
  const beatIds = new Set(scene.beats.map((beat) => beat.id));
  const errors: string[] = [];
  output.panels.forEach((panel, index) => {
    if (panel.sourceBeatIds.some((id) => !beatIds.has(id))) errors.push(`第 ${index + 1} 格引用了不属于当前场次的镜头 ID`);
    if (panel.actorIds.some((id) => !actorIds.has(id))) errors.push(`第 ${index + 1} 格引用了未知角色 ID`);
    if (panel.bubbles.some((bubble) => bubble.speakerActorId && !panel.actorIds.includes(bubble.speakerActorId))) errors.push(`第 ${index + 1} 格台词角色没有包含在本格角色中`);
  });
  if (errors.length) throw codedError('comic_storyboard_invalid_reference', errors.join('；'));
  return output;
}

function defaultBubbleRect(area: ComicPanel['textSafeArea'], index: number, total: number) {
  const height = Math.min(0.2, Math.max(0.14, 0.84 / Math.max(1, total)));
  const y = area === 'bottom' ? 0.96 - height * (index + 1) : 0.04 + height * index;
  if (area === 'top_right') return { x: 0.39, y, width: 0.57, height };
  if (area === 'bottom') return { x: 0.08, y: Math.max(0.03, y), width: 0.84, height };
  return { x: 0.04, y, width: 0.57, height };
}

function pageTemplates(panelCount: number): Array<{ template: ComicPage['template']; count: number }> {
  const mapping: Record<number, Array<{ template: ComicPage['template']; count: number }>> = {
    4: [{ template: 'quad', count: 4 }],
    5: [{ template: 'trio', count: 3 }, { template: 'duo', count: 2 }],
    6: [{ template: 'trio', count: 3 }, { template: 'trio', count: 3 }],
    7: [{ template: 'quad', count: 4 }, { template: 'trio', count: 3 }],
    8: [{ template: 'quad', count: 4 }, { template: 'quad', count: 4 }],
  };
  const result = mapping[panelCount];
  if (!result) throw codedError('comic_storyboard_panel_count', '分镜格数只支持 4～8 格。');
  return result;
}

export function materializeComicStoryboard(output: ComicStoryboardModelOutput, source: ContentDocument, request: StoryboardRequest) {
  const checked = validateStoryboardOutput(output, source, request);
  const pageGroups = pageTemplates(checked.panels.length);
  let cursor = 0;
  const panels: ComicPanel[] = checked.panels.map((item) => {
    const bubbles = item.bubbles.map((bubble, index) => ({
      id: randomUUID(), kind: bubble.kind, speakerActorId: bubble.speakerActorId, text: bubble.text,
      rect: defaultBubbleRect(item.textSafeArea, index, item.bubbles.length), tail: null, fontSize: 32,
    }));
    return {
      id: randomUUID(), source: { stageId: request.stageId, sceneId: request.sceneId, beatIds: [...item.sourceBeatIds] },
      actorIds: [...new Set(item.actorIds)], shotSize: item.shotSize, visualDescription: item.visualDescription,
      composition: item.composition, textSafeArea: item.textSafeArea, selectedImage: null,
      crop: { focalX: 0.5, focalY: 0.5, zoom: 1 }, bubbles,
      presentation: { camera: 'none', impact: 'none', holdMs: null }, renderSettings: {},
    };
  });
  const pages = pageGroups.map(({ template, count }, index) => {
    const group = panels.slice(cursor, cursor + count);
    cursor += count;
    return { id: randomUUID(), title: `${sceneFor(source, request.stageId, request.sceneId)!.title || '分镜'} · ${index + 1}`, template, panelIds: group.map((panel) => panel.id) };
  });
  return { pages, panels };
}

export async function processComicStoryboardJob(options: {
  jobId: string; activityId: string; config: ServiceConfig; database: ServiceDatabase; secrets: SecretStore;
  fetcher?: typeof fetch; comicStore?: ComicStore; activityStore?: ActivityStore;
}): Promise<void> {
  const comicStore = options.comicStore ?? new ComicStore(options.database);
  if (!comicStore.claimComicJob(options.jobId)) return;
  const job = comicStore.getComicJob(options.activityId, options.jobId);
  if (!job) return;
  let callId: string | null = null;
  try {
    const request = job.input as unknown as StoryboardRequest & { expectedDraftVersion: number; sourceContentRevisionId: string };
    const draft = comicStore.getComicDraft(options.activityId);
    if (!draft || draft.draftVersion !== request.expectedDraftVersion || draft.document.contentRevisionId !== request.sourceContentRevisionId) {
      throw codedError('comic_draft_conflict', '漫画草稿或绑定的剧情版本已变化，请刷新后重新生成。', 409);
    }
    const activityStore = options.activityStore ?? new ActivityStore(options.database);
    const revision = activityStore.getContentRevision(options.activityId, request.sourceContentRevisionId);
    if (!revision) throw codedError('comic_source_missing', '漫画绑定的剧情版本不存在。', 409);
    if (!sceneFor(revision.document, request.stageId, request.sceneId)) throw codedError('comic_source_not_found', '指定场次不属于冻结的剧情版本。', 409);
    comicStore.updateComicJob(job.id, { status: 'running' });
    const profile = await resolveAssignedLlmProfile(options.database, options.secrets, 'activities', 'text');
    if (!profile) throw codedError('comic_llm_not_configured', '活动文本模型未配置，无法生成漫画分镜。', 409);
    const prompt = buildComicStoryboardPrompt({ ...request, content: revision.document });
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;
    let raw: string;
    try {
      raw = await Promise.race([
        callLlm(profile, prompt, options.fetcher ?? fetch, controller.signal, {
          database: options.database, traceId: job.traceId, feature: 'activity-comic', businessEvent: 'activity.comic.storyboard',
          objectType: 'activity-comic-job', objectId: job.id,
        }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(codedError('comic_storyboard_timeout', '漫画分镜生成超时。', 504)); }, 120_000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
    const call = options.database.connection.prepare(`SELECT id FROM ai_call_records WHERE trace_id=? AND business_event='activity.comic.storyboard' ORDER BY requested_at DESC LIMIT 1`).get(job.traceId) as { id: string } | undefined;
    callId = call?.id ?? null;
    const parsed = parseAiJsonOutput<unknown>(raw);
    if (!Value.Check(ComicStoryboardModelOutputSchema, parsed)) {
      const first = [...Value.Errors(ComicStoryboardModelOutputSchema, parsed)].slice(0, 5).map((error) => `${error.path || '/'}: ${error.message}`).join('；');
      throw codedError('comic_storyboard_invalid_output', `模型返回的分镜结构不合法：${first}`);
    }
    const result = materializeComicStoryboard(parsed, revision.document, request);
    comicStore.updateComicJob(job.id, { status: 'succeeded', result, callId });
  } catch (error) {
    const value = error as { code?: string; statusCode?: number; message?: string };
    const traceCall = options.database.connection.prepare(`SELECT id FROM ai_call_records WHERE trace_id=? ORDER BY requested_at DESC LIMIT 1`).get(job.traceId) as { id: string } | undefined;
    callId ??= traceCall?.id ?? null;
    comicStore.updateComicJob(job.id, { status: 'failed', errorCode: value.code ?? 'comic_storyboard_failed', errorMessage: value.message ?? '漫画分镜生成失败。', callId });
  }
}

export function registerComicStoryboardRoutes(
  app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, checkAdmin: AdminCheck, fetcher: typeof fetch = fetch,
) {
  const comicStore = new ComicStore(database);
  const activityStore = new ActivityStore(database);
  comicStore.recoverInterruptedJobs();
  for (const job of comicStore.listQueuedComicJobs(500).filter((item) => item.kind === 'storyboard')) {
    setImmediate(() => { void processComicStoryboardJob({ jobId: job.id, activityId: job.activityId, config, database, secrets, fetcher, comicStore, activityStore }); });
  }
  app.post<{ Params: { activityId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/storyboards', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ComicStoryboardRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request', details: [...Value.Errors(ComicStoryboardRequestSchema, request.body)].map((error) => `${error.path}: ${error.message}`) });
    const body = request.body as ComicStoryboardRequest;
    const existing = comicStore.getComicJobByIdempotencyKey(request.params.activityId, body.idempotencyKey);
    if (existing) {
      if (existing.kind !== 'storyboard' || existing.input.expectedDraftVersion !== body.expectedDraftVersion
        || existing.input.stageId !== body.stageId || existing.input.sceneId !== body.sceneId
        || existing.input.panelCount !== body.panelCount || existing.input.instructions !== (body.instructions ?? '')) {
        return reply.code(409).send({ error: 'idempotency_conflict', message: '相同请求标识已用于不同的分镜参数。' });
      }
      return reply.code(202).send({ job: existing });
    }
    const draft = comicStore.getComicDraft(request.params.activityId);
    if (!draft) return reply.code(404).send({ error: 'comic_draft_not_found' });
    if (draft.draftVersion !== body.expectedDraftVersion) return reply.code(409).send({ error: 'comic_draft_conflict', message: '漫画草稿已更新。' });
    const source = activityStore.getContentRevision(request.params.activityId, draft.document.contentRevisionId);
    if (!source || !sceneFor(source.document, body.stageId, body.sceneId)) return reply.code(409).send({ error: 'comic_source_not_found', message: '场次不属于漫画绑定的剧情版本。' });
    let created: ReturnType<ComicStore['createComicJob']>;
    try {
      created = comicStore.createComicJob({
        activityId: request.params.activityId, kind: 'storyboard', idempotencyKey: body.idempotencyKey,
        traceId: randomUUID(), request: { stageId: body.stageId, sceneId: body.sceneId, panelCount: body.panelCount,
          instructions: body.instructions ?? '', expectedDraftVersion: body.expectedDraftVersion, sourceContentRevisionId: source.id },
      });
    } catch (error) {
      const value = error as { code?: string; statusCode?: number; message?: string };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_job_create_failed', message: value.message ?? '无法创建漫画任务。' });
    }
    if (!created.isExisting) setImmediate(() => { void processComicStoryboardJob({ jobId: created.job.id, activityId: request.params.activityId, config, database, secrets, fetcher, comicStore, activityStore }); });
    return reply.code(202).send({ job: comicStore.getComicJob(request.params.activityId, created.job.id) });
  });

  app.post<{ Params: { activityId: string; jobId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/storyboards/:jobId/apply', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ComicStoryboardApplyRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    const body = request.body as { expectedDraftVersion: number; mode: 'append' | 'replace_scene' };
    const draft = comicStore.getComicDraft(request.params.activityId);
    const job = comicStore.getComicJob(request.params.activityId, request.params.jobId);
    if (!draft || !job || job.kind !== 'storyboard') return reply.code(404).send({ error: 'comic_storyboard_not_found' });
    if(job.input.readOnly===true)return reply.code(409).send({error:'comic_job_read_only',message:'导入的历史分镜只读，不能再次应用。'});
    if (job.status !== 'succeeded' || !job.result || !Array.isArray(job.result.pages) || !Array.isArray(job.result.panels)) return reply.code(409).send({ error: 'comic_storyboard_not_ready', message: '分镜草案尚未成功生成。' });
    if (draft.draftVersion !== body.expectedDraftVersion) return reply.code(409).send({ error: 'comic_draft_conflict', message: '漫画草稿已更新，保留本地输入后刷新再应用。' });
    if (draft.document.contentRevisionId !== job.input.sourceContentRevisionId) return reply.code(409).send({ error: 'comic_source_changed', message: '分镜草案来源剧情版本已变化。' });
    const input = job.input as unknown as StoryboardRequest;
    let pages = draft.document.pages;
    let panels = draft.document.panels;
    if (body.mode === 'replace_scene') {
      const pagePanels = new Map(pages.map((page) => [page.id, page.panelIds.map((id) => panels.find((panel) => panel.id === id))]));
      const replacementPageIds = new Set<string>();
      for (const page of pages) {
        const pageItems = pagePanels.get(page.id) ?? [];
        if (pageItems.some((panel) => panel?.source.stageId === input.stageId && panel.source.sceneId === input.sceneId)) {
          if (pageItems.some((panel) => !panel || panel.source.stageId !== input.stageId || panel.source.sceneId !== input.sceneId)) {
            return reply.code(409).send({ error: 'comic_mixed_scene_page', message: '目标场次与其他内容共用页面，未进行替换以免覆盖手工编排。' });
          }
          replacementPageIds.add(page.id);
        }
      }
      const removedPanelIds = new Set(pages.filter((page) => replacementPageIds.has(page.id)).flatMap((page) => page.panelIds));
      pages = pages.filter((page) => !replacementPageIds.has(page.id));
      panels = panels.filter((panel) => !removedPanelIds.has(panel.id));
    }
    const resultPages = job.result.pages as ComicPage[];
    const resultPanels = job.result.panels as ComicPanel[];
    const nextDocument: ComicDocument = { ...draft.document, pages: [...pages, ...resultPages], panels: [...panels, ...resultPanels] };
    try {
      const saved = comicStore.saveComicDraft(request.params.activityId, body.expectedDraftVersion, nextDocument);
      return reply.send({ draft: saved, addedPageIds: resultPages.map((page) => page.id) });
    } catch (error) {
      const value = error as { code?: string; statusCode?: number; message?: string };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_apply_failed', message: value.message ?? '无法应用分镜。' });
    }
  });
}
