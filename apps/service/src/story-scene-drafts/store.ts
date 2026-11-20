import { randomUUID } from 'node:crypto';
import type {
  CreateStorySceneDraft, PatchStorySceneDraft, SceneAction, SceneCandidate, SceneCharacter,
  SceneDirection, SceneEvidence, SceneImage, SceneStartSchema, StorySceneActionRequest,
  StorySceneDraft, StorySceneList, StorySceneSummary,
} from '@sthstart/contracts';
import type { Static } from '@sinclair/typebox';
import { nowIso, type ServiceDatabase } from '../database.js';
import { replaceScenePlanReference } from './media-references.js';

export class SceneDraftError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 400) { super(message); }
}

type Start = Static<typeof SceneStartSchema>;
type StartInput = NonNullable<PatchStorySceneDraft['start']>;
type ActionRow = {
  id: string; action: SceneAction['action']; input_revision: number; idempotency_key: string;
  created_at: string; updated_at: string; status: SceneAction['status'];
  error_json: string | null; task_id: string | null; message_id: string | null; retry_of: string | null;
  request_json: string; input_json: string; snapshot_json: string;
};
type ActionFinish = Pick<SceneAction, 'status' | 'error' | 'taskId'>;

// Canonicalize object keys so a transport retry can reorder JSON properties.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function summary(draft: StorySceneDraft): StorySceneSummary {
  const { id, revision, title, character, progress, createdAt, updatedAt } = draft;
  return { id, revision, title, character, progress, createdAt, updatedAt };
}

function status(draft: StorySceneDraft): StorySceneSummary['progress'] {
  if (draft.adoption) return 'adopted';
  if (draft.body.trim() && (draft.imagePlan || draft.images.length)) return 'image';
  if (draft.body.trim() || draft.briefConfirmed) return 'write';
  return draft.start ? 'discuss' : 'start';
}

function publicAction(row: ActionRow): SceneAction {
  return {
    id: row.id, action: row.action, inputRevision: row.input_revision, idempotencyKey: row.idempotency_key,
    createdAt: row.created_at, updatedAt: row.updated_at, status: row.status,
    ...(row.error_json && { error: JSON.parse(row.error_json) as SceneAction['error'] }),
    ...(row.task_id && { taskId: row.task_id }), ...(row.message_id && { messageId: row.message_id }),
    ...(row.retry_of && { retryOf: row.retry_of }),
  };
}

function findStart(input: StartInput, draft: StorySceneDraft): Start {
  const { candidateId, time, location } = input;
  const selected: SceneCandidate | Start | undefined = candidateId
    ? draft.candidates.find(candidate => candidate.id === candidateId)
      ?? (draft.start?.candidateId === candidateId ? draft.start : undefined)
    : (draft.start && !draft.start.candidateId ? draft.start : undefined);
  if (candidateId && !selected) throw new SceneDraftError('unknown_candidate', '该时地候选已不存在，请重新选择。');
  const authorEvidence = (previous?: SceneEvidence): SceneEvidence => ({ status: 'author', sourceIds: previous?.sourceIds ?? [], note: previous?.note ?? '' });
  return {
    ...(candidateId && { candidateId }), time, location,
    hook: input.hook ?? selected?.hook ?? '',
    timeEvidence: selected && time === selected.time ? selected.timeEvidence : authorEvidence(selected?.timeEvidence),
    locationEvidence: selected && location === selected.location ? selected.locationEvidence : authorEvidence(selected?.locationEvidence),
  };
}

function requireDirection(character: SceneCharacter, direction: SceneDirection | null | undefined) {
  if (direction && (direction === 'original') !== (character.origin === 'original')) {
    throw new SceneDraftError('invalid_direction', '所选走向与角色的作品来源不符。');
  }
}

export function isCompleteBrief(draft: StorySceneDraft) {
  const brief = draft.brief;
  return Boolean(draft.start && draft.direction && brief?.viewpoint.trim() && brief.action.trim()
    && brief.change.trim() && (draft.direction !== 'if' || (brief.canonEvent?.trim() && brief.divergence?.trim())));
}

export class SceneDraftStore {
  constructor(private readonly db: ServiceDatabase) {}

  create(input: CreateStorySceneDraft): StorySceneDraft {
    return this.db.transaction(() => {
      const previous = this.db.connection.prepare('SELECT id, create_input FROM story_scene_drafts WHERE create_key = ?')
        .get(input.idempotencyKey) as { id: string; create_input: string } | undefined;
      if (previous) {
        if (previous.create_input !== canonical(input)) throw new SceneDraftError('idempotency_mismatch', '这个提交编号已用于其他内容。', 409);
        return this.get(previous.id);
      }
      const parent = 'forkFrom' in input ? this.get(input.forkFrom) : null;
      const character = 'character' in input ? { ...input.character, name: input.character.name.trim() } : parent!.character;
      const direction = 'forkFrom' in input ? input.direction ?? parent!.direction : character.origin === 'original' ? 'original' : null;
      requireDirection(character, direction);
      const createdAt = nowIso();
      const draft: StorySceneDraft = {
        id: randomUUID(), revision: 1, title: ('title' in input ? input.title : parent?.title) || `${character.name}的一幕`,
        character, progress: 'start', createdAt, updatedAt: createdAt,
        notes: ('notes' in input ? input.notes : parent?.notes) ?? '', lockedConstraints: parent?.lockedConstraints ?? [],
        authorSources: parent?.authorSources ?? [], sources: parent?.sources ?? [], candidates: parent?.candidates ?? [],
        start: parent?.start ?? null, discovery: parent?.discovery ?? null, direction, messages: [],
        brief: null, briefConfirmed: false, format: parent?.format ?? 'story', body: '', bodyVersion: 1,
        writingCandidate: null, imagePlan: null, images: [], adoption: null, currentAction: null,
        ...(parent && { forkedFrom: parent.id }),
      };
      if ('start' in input && input.start) draft.start = findStart(input.start, draft);
      draft.progress = status(draft);
      this.db.connection.prepare(`INSERT INTO story_scene_drafts
        (id, create_key, create_input, revision, created_at, updated_at, summary_json, draft_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(draft.id, input.idempotencyKey, canonical(input), draft.revision, createdAt, createdAt, JSON.stringify(summary(draft)), JSON.stringify(draft));
      return draft;
    });
  }

  list(limit: number, cursor?: string): StorySceneList {
    let after: [string, string] | undefined;
    if (cursor) {
      try {
        const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some(item => typeof item !== 'string' || !item)) throw new Error();
        after = parsed as [string, string];
      } catch { throw new SceneDraftError('invalid_cursor', '无法识别这个草稿列表游标。'); }
    }
    const rows = (after
      ? this.db.connection.prepare(`SELECT summary_json FROM story_scene_drafts
          WHERE (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...after, limit + 1)
      : this.db.connection.prepare(`SELECT summary_json FROM story_scene_drafts
          ORDER BY updated_at DESC, id DESC LIMIT ?`).all(limit + 1)) as { summary_json: string }[];
    const items = rows.slice(0, limit).map(row => JSON.parse(row.summary_json) as StorySceneSummary);
    const last = items.at(-1);
    return { items, nextCursor: last && rows.length > limit ? Buffer.from(JSON.stringify([last.updatedAt, last.id])).toString('base64url') : null };
  }

  get(id: string): StorySceneDraft {
    const row = this.db.connection.prepare('SELECT draft_json FROM story_scene_drafts WHERE id = ?').get(id) as { draft_json: string } | undefined;
    if (!row) throw new SceneDraftError('draft_not_found', '找不到这份草稿。', 404);
    const draft = JSON.parse(row.draft_json) as StorySceneDraft;
    const last = this.db.connection.prepare('SELECT * FROM story_scene_actions WHERE draft_id = ? ORDER BY sequence DESC LIMIT 1').get(id) as ActionRow | undefined;
    draft.currentAction = last ? publicAction(last) : null;
    return draft;
  }

  expectRevision(draft: StorySceneDraft, expected: number) {
    if (draft.revision !== expected) throw new SceneDraftError('revision_conflict', '草稿已有更新。请先查看两个版本。', 409);
  }

  save(draft: StorySceneDraft, bump = true) {
    const next = { ...draft, progress: status(draft), revision: draft.revision + Number(bump), updatedAt: bump ? nowIso() : draft.updatedAt };
    this.db.connection.prepare('UPDATE story_scene_drafts SET revision = ?, updated_at = ?, summary_json = ?, draft_json = ? WHERE id = ?')
      .run(next.revision, next.updatedAt, JSON.stringify(summary(next)), JSON.stringify({ ...next, currentAction: null }), next.id);
    return next;
  }

  patch(id: string, input: PatchStorySceneDraft): StorySceneDraft {
    return this.db.transaction(() => {
      const draft = this.get(id);
      this.expectRevision(draft, input.expectedRevision);
      requireDirection(draft.character, input.direction);
      const start = input.start === undefined ? draft.start : input.start && findStart(input.start, draft);
      const direction = input.direction === undefined ? draft.direction : input.direction;
      const premiseChanged = canonical(start) !== canonical(draft.start) || direction !== draft.direction;
      if (premiseChanged && draft.body.trim()) throw new SceneDraftError('fork_required', '已有成稿。请从这里另开一幕来变更时地或走向。', 409);
      for (const key of ['title', 'notes', 'lockedConstraints', 'authorSources', 'format'] as const) {
        Object.assign(draft, input[key] === undefined ? {} : { [key]: input[key] });
      }
      draft.start = start;
      draft.direction = direction;
      if (input.brief !== undefined) draft.brief = input.brief;
      if (premiseChanged || input.brief !== undefined || input.lockedConstraints !== undefined) draft.briefConfirmed = false;
      if (input.briefConfirmed === true && (premiseChanged || !isCompleteBrief(draft))) {
        throw new SceneDraftError('brief_incomplete', '请先确定时地和走向，再确认完整的提要。');
      }
      if (input.briefConfirmed !== undefined) draft.briefConfirmed = input.briefConfirmed;
      let body = input.body ?? draft.body;
      if (input.writingCandidateDecision) {
        const candidate = draft.writingCandidate;
        if (!candidate || candidate.id !== input.writingCandidateDecision.id) throw new SceneDraftError('candidate_conflict', '改写候选已更新。', 409);
        if (input.writingCandidateDecision.decision === 'accept') body = candidate.body;
        draft.writingCandidate = null;
      }
      if (body !== draft.body) {
        draft.body = body;
        draft.bodyVersion++;
      }
      if (input.imagePlan) {
        if (!draft.body.trim()) throw new SceneDraftError('body_required', '请先写好这一幕。');
        const previous = draft.imagePlan;
        if (input.imagePlan.referenceArtifactId !== undefined && input.imagePlan.referenceArtifactId !== (previous?.referenceArtifactId ?? null)
          && !replaceScenePlanReference(this.db, id, input.imagePlan.referenceArtifactId)) {
          throw new SceneDraftError('image_reference_unavailable', '参考图片当前无法读取，请重新上传或移除。', 409);
        }
        const plan = { ...input.imagePlan, referenceArtifactId: input.imagePlan.referenceArtifactId === undefined ? previous?.referenceArtifactId ?? null : input.imagePlan.referenceArtifactId };
        const next = { ...plan, id: previous?.id ?? randomUUID(), version: previous?.version ?? 1, bodyVersion: draft.bodyVersion };
        if (canonical(next) !== canonical(previous)) {
          draft.imagePlan = { ...next, version: (previous?.version ?? 0) + 1 };
        }
      }
      return this.save(draft);
    });
  }

  actionByKey(id: string, key: string) {
    return this.db.connection.prepare('SELECT * FROM story_scene_actions WHERE draft_id = ? AND idempotency_key = ?')
      .get(id, key) as ActionRow | undefined;
  }

  actionById(id: string, actionId: string) {
    return this.db.connection.prepare('SELECT * FROM story_scene_actions WHERE draft_id = ? AND id = ?')
      .get(id, actionId) as ActionRow | undefined;
  }

  actionByTask(id: string, taskId: string) {
    return this.db.connection.prepare('SELECT * FROM story_scene_actions WHERE draft_id = ? AND task_id = ?')
      .get(id, taskId) as ActionRow | undefined;
  }

  readAction(row: ActionRow) { return publicAction(row); }

  checkReplay(row: ActionRow, request: StorySceneActionRequest) {
    if (row.request_json !== canonical(request)) throw new SceneDraftError('idempotency_mismatch', '这个提交编号已用于其他内容。', 409);
  }

  begin(draft: StorySceneDraft, request: StorySceneActionRequest, input: StorySceneActionRequest, messageId?: string) {
    const actionId = randomUUID();
    const now = nowIso();
    this.db.connection.prepare(`INSERT INTO story_scene_actions
      (id, draft_id, action, status, idempotency_key, input_revision, created_at, updated_at,
       request_json, input_json, snapshot_json, message_id, retry_of) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(actionId, draft.id, request.action, request.idempotencyKey, draft.revision, now, now,
        canonical(request), JSON.stringify(input), JSON.stringify(draft), messageId ?? null, request.retryOf ?? null);
    return actionId;
  }

  finish(actionId: string, result: ActionFinish, output?: unknown, expectedStatus: SceneAction['status'] = 'running') {
    this.db.connection.prepare(`UPDATE story_scene_actions SET status = ?, updated_at = ?, task_id = COALESCE(?, task_id), error_json = ?, result_json = COALESCE(?, result_json)
      WHERE id = ? AND status = ?`)
      .run(result.status, nowIso(), result.taskId ?? null, result.error ? JSON.stringify(result.error) : null,
        output === undefined ? null : JSON.stringify(output), actionId, expectedStatus);
  }

  recover(id: string, expiry: string) {
    this.db.connection.prepare(`UPDATE story_scene_actions SET status = 'failed', updated_at = ?, error_json = ?
      WHERE draft_id = ? AND status = 'running' AND updated_at <= ?`)
      .run(nowIso(), JSON.stringify({ code: 'action_expired', message: '上次执行已超过时限，可以重试。' }), id, expiry);
  }

  syncImages(id: string, readImage: (image: SceneImage) => SceneImage): StorySceneDraft {
    const draft = this.get(id);
    for (const [index, image] of draft.images.entries()) {
      if (image.status === 'succeeded' || image.status === 'failed') continue;
      const latest = readImage(image);
      if (canonical(latest) === canonical(image)) continue;
      draft.images[index] = latest;
      const action = this.actionByTask(id, image.taskId);
      if (action && latest.status === 'succeeded') this.finish(action.id, { status: 'succeeded' }, latest, 'queued');
      if (action && latest.status === 'failed') this.finish(action.id, {
        status: 'failed', error: { code: 'image_task_failed', message: latest.error ?? '图片任务失败，可以重试。' },
      }, latest, 'queued');
      this.save(draft, false);
    }
    return this.get(id);
  }
}
