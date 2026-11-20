import { randomUUID } from 'node:crypto';
import type {
  SceneAdoption, SceneImage, SceneMessage, StorySceneActionRequest, StorySceneActionResponse, StorySceneDraft,
} from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import { SceneDraftError, SceneDraftStore, isCompleteBrief } from './store.js';
import { StorySceneTextError, type createStorySceneTextActions } from './text.js';
import type { createSceneDraftMedia } from './media.js';

const ACTION_TIMEOUT_MS = 180_000;
type TextActions = ReturnType<typeof createStorySceneTextActions>;
type MediaActions = ReturnType<typeof createSceneDraftMedia>;
type TextResult = Awaited<ReturnType<TextActions>>;

function applyTextResult(draft: StorySceneDraft, result: TextResult) {
  switch (result.action) {
    case 'discover': {
      draft.sources = result.sources;
      draft.candidates = result.candidates;
      draft.discovery = result.discovery;
      break;
    }
    case 'refresh-sources': {
      const cited = new Set([...(draft.start ? [draft.start] : []), ...draft.candidates]
        .flatMap(item => [...item.timeEvidence.sourceIds, ...item.locationEvidence.sourceIds]));
      const refreshed = new Set(result.sources.map(source => source.id));
      const retained = draft.sources.filter(source => !refreshed.has(source.id) && (cited.has(source.id)
        || (result.discovery.status !== 'ready' && source.kind !== 'author')));
      draft.sources = [...result.sources, ...retained];
      draft.discovery = result.discovery;
      break;
    }
    case 'discuss':
      draft.messages.push(result.message);
      break;
    case 'write':
      if (draft.body.trim()) {
        draft.writingCandidate = { id: randomUUID(), body: result.body, createdAt: nowIso() };
      } else {
        draft.body = result.body;
        draft.bodyVersion++;
      }
      break;
    case 'plan-image':
      draft.imagePlan = {
        ...result.plan, id: draft.imagePlan?.id ?? randomUUID(), version: (draft.imagePlan?.version ?? 0) + 1, bodyVersion: draft.bodyVersion,
        referenceArtifactId: draft.imagePlan?.referenceArtifactId ?? null,
      };
      break;
  }
}

function preflight(draft: StorySceneDraft, input: StorySceneActionRequest, original?: StorySceneDraft) {
  if (input.action === 'discuss' && (!draft.start || !draft.direction)) {
    throw new SceneDraftError('start_required', '请先确定时地和走向。');
  }
  if (input.action === 'write' && (!draft.briefConfirmed || !isCompleteBrief(draft))) {
    throw new SceneDraftError('brief_required', '请先确认创作提要。');
  }
  if (['plan-image', 'generate-image', 'adopt'].includes(input.action) && !draft.body.trim()) {
    throw new SceneDraftError('body_required', '请先写好这一幕。');
  }
  if (input.action === 'generate-image') {
    const plan = draft.imagePlan;
    if (!plan || plan.bodyVersion !== draft.bodyVersion || !plan.moment.trim() || !plan.subject.trim()) {
      throw new SceneDraftError('image_plan_required', '请先确认适用于当前正文的画面方案。');
    }
    if (draft.images.some(image => ['queued', 'running', 'uncertain'].includes(image.status))) {
      throw new SceneDraftError('image_pending', '已有画面正在生成或等待恢复。', 409);
    }
  }
  if (original) {
    const omitDisplay = (value: StorySceneDraft) => {
      const { revision, updatedAt, progress, currentAction, title, images, ...rest } = value;
      return input.action === 'adopt' ? { ...rest, title } : rest;
    };
    if (JSON.stringify(omitDisplay(original)) !== JSON.stringify(omitDisplay(draft))) {
      throw new SceneDraftError('retry_input_changed', '草稿已有改动，请基于当前内容重新执行。', 409);
    }
  }
}

export class StorySceneService {
  readonly store: SceneDraftStore;

  constructor(private readonly db: ServiceDatabase, private readonly text: TextActions, private readonly media: MediaActions) {
    this.store = new SceneDraftStore(db);
  }

  private refresh(id: string) {
    this.store.recover(id, new Date(Date.now() - ACTION_TIMEOUT_MS - 10_000).toISOString());
    return this.store.syncImages(id, this.media.readImageTask);
  }

  get(id: string) { return this.db.transaction(() => this.refresh(id)); }

  private response(id: string, actionId: string): StorySceneActionResponse {
    const draft = this.get(id);
    const row = this.store.actionById(id, actionId);
    if (!row) throw new SceneDraftError('action_not_found', '找不到这次操作。', 404);
    return { draft, action: this.store.readAction(row) };
  }

  private textResult(draft: StorySceneDraft, input: StorySceneActionRequest, actionId: string, message?: SceneMessage): Promise<TextResult> {
    const controller = new AbortController();
    return new Promise<TextResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new SceneDraftError('action_timeout', '资料操作超时，可以重试。', 504));
      }, ACTION_TIMEOUT_MS);
      this.text(draft, input as Extract<StorySceneActionRequest, { action: 'discover' | 'refresh-sources' | 'discuss' | 'write' | 'plan-image' }>, { actionId, message, signal: controller.signal })
        .then(resolve, reject).finally(() => clearTimeout(timer));
    });
  }

  async run(id: string, request: StorySceneActionRequest): Promise<StorySceneActionResponse> {
    const accepted = this.db.transaction(() => {
      let draft = this.refresh(id);
      const replay = this.store.actionByKey(id, request.idempotencyKey);
      if (replay) {
        this.store.checkReplay(replay, request);
        return { actionId: replay.id };
      }
      if (draft.currentAction?.status === 'running') throw new SceneDraftError('action_busy', '请等待当前操作完成。', 409);
      if (request.action === 'adopt' && draft.adoption) {
        const actionId = this.store.begin(draft, request, request);
        this.store.finish(actionId, { status: 'succeeded' }, draft.adoption);
        return { actionId };
      }
      this.store.expectRevision(draft, request.expectedRevision);

      let input = request;
      let message: SceneMessage | undefined;
      let original: StorySceneDraft | undefined;
      if (request.retryOf) {
        const earlier = this.store.actionById(id, request.retryOf);
        if (!earlier || earlier.action !== request.action || earlier.status !== 'failed') {
          throw new SceneDraftError('action_not_retryable', '这次操作当前无法重试。', 409);
        }
        input = JSON.parse(earlier.input_json) as StorySceneActionRequest;
        original = JSON.parse(earlier.snapshot_json) as StorySceneDraft;
        message = draft.messages.find(item => item.id === earlier.message_id);
      }
      preflight(draft, input, original);
      if (!request.retryOf && input.action === 'discuss' && input.message) {
        message = { id: randomUUID(), role: 'author', text: input.message.trim(), createdAt: nowIso() };
        draft = this.store.save({ ...draft, messages: [...draft.messages, message] });
      }
      return { actionId: this.store.begin(draft, request, input, message?.id), draft, input, message };
    });

    const { actionId, draft, input, message } = accepted;
    if (!draft || !input) return this.response(id, actionId);
    const currentInput = () => {
      const latest = this.store.get(id);
      this.store.expectRevision(latest, draft.revision);
      if (this.store.actionById(id, actionId)?.status !== 'running') {
        throw new SceneDraftError('action_expired', '这次执行已超过时限，可以重试。', 409);
      }
      return latest;
    };

    try {
      if (input.action === 'generate-image') {
        await this.media.generateImage(draft, input, actionId, taskId => {
          const latest = currentInput();
          const image: SceneImage = {
            id: actionId, taskId, bodyVersion: draft.bodyVersion, planVersion: draft.imagePlan!.version,
            status: 'queued', createdAt: nowIso(),
          };
          latest.images.push(image);
          this.store.save(latest);
          this.store.finish(actionId, { status: 'queued', taskId }, image);
        });
      } else if (input.action === 'adopt') {
        this.media.adopt(draft, input, (adoption: SceneAdoption) => {
          const latest = currentInput();
          this.store.save({ ...latest, adoption });
          this.store.finish(actionId, { status: 'succeeded' }, adoption);
        });
      } else {
        const result = await this.textResult(draft, input, actionId, message);
        this.db.transaction(() => {
          const latest = currentInput();
          applyTextResult(latest, result);
          this.store.save(latest);
          this.store.finish(actionId, { status: 'succeeded' }, result);
        });
      }
    } catch (error) {
      const safe = error instanceof SceneDraftError || error instanceof StorySceneTextError
        ? { code: error.code, message: error.message }
        : { code: 'scene_action_failed', message: '这次操作未完成，请稍后重试。' };
      this.db.transaction(() => this.store.finish(actionId, { status: safe.code === 'revision_conflict' ? 'stale' : 'failed', error: safe }));
    }
    return this.response(id, actionId);
  }
}
