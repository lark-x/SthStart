import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Activity,
  ActivityDraft,
  ActivityCheckpoint,
  ActivityAsset,
  ActivityJob,
  ActivityCandidate,
  ContentDocument,
  MediaRevisionDocument,
  PlaybackDocument,
  PlaybackRevision,
} from '@sthstart/contracts';
import { nowIso, type ServiceDatabase } from '../database.js';
import { clearActivitySchedule, normalizeScheduledDate, rebuildActivitySchedules, syncActivitySchedule } from './schedule.js';

export function hashDocument(doc: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex');
}

export class ActivityStore {
  constructor(private readonly db: ServiceDatabase) {}

  private get connection(): DatabaseSync {
    return this.db.connection;
  }

  createActivity(input: {
    title: string;
    type: string;
    theme?: string;
    location?: string;
    rules?: string;
    actors?: ContentDocument['actors'];
    relationships?: ContentDocument['relationships'];
    stages?: ContentDocument['stages'];
    initialDocument?: ContentDocument;
    /** 由外层事务调用时跳过内层事务，避免嵌套 BEGIN。 */
    skipTransaction?: boolean;
  }): { activity: Activity; draft: ActivityDraft } {
    const id = crypto.randomUUID();
    const now = nowIso();
    const title = input.title.trim() || input.initialDocument?.activity?.title?.trim() || '未命名活动';
    const type = input.type.trim() || input.initialDocument?.activity?.type?.trim() || '日常活动';
    const theme = (input.theme || input.initialDocument?.activity?.theme || '').trim();
    const location = (input.location || input.initialDocument?.activity?.location || '').trim();
    const rules = (input.rules || input.initialDocument?.activity?.rules || '').trim();

    const initialDoc: ContentDocument = input.initialDocument
      ? {
          ...input.initialDocument,
          activity: {
            ...input.initialDocument.activity,
            title,
            type,
            theme,
            location,
            rules,
          },
        }
      : {
          schemaVersion: 1,
          activity: {
            title,
            type,
            theme,
            location,
            rules,
            generationMode: 'autonomous',
          },
          actors: input.actors || [],
          relationships: input.relationships || [],
          stages: input.stages && input.stages.length >= 2
            ? input.stages
            : [
                {
                  id: 'stage_1',
                  title: '第一阶段：初始准备',
                  order: 1,
                  actorIds: (input.actors || []).map((a) => a.id),
                  location: location || '活动地点',
                  instruction: '准备与集合',
                  requiredBeats: [],
                  locked: false,
                  endCondition: '准备工作就绪',
                },
                {
                  id: 'stage_2',
                  title: '第二阶段：主要活动',
                  order: 2,
                  actorIds: (input.actors || []).map((a) => a.id),
                  location: location || '活动地点',
                  instruction: '展开主要互动与交流',
                  requiredBeats: [],
                  locked: false,
                  endCondition: '活动圆满结束',
                },
              ],
          conversations: [
            {
              id: 'group_main',
              kind: 'group',
              title,
              memberActorIds: (input.actors || []).map((a) => a.id),
            },
          ],
          messages: [],
          posts: [],
          comments: [],
          likes: [],
          mediaSlots: [],
          facts: [],
          stageResults: [],
        };

    const applyCreate = () => {
      const initialRevId = `rev_content_${crypto.randomUUID().replace(/-/g, '')}`;
      const initialMediaRevId = `rev_media_${crypto.randomUUID().replace(/-/g, '')}`;
      const docJson = JSON.stringify(initialDoc);
      const hash = crypto.createHash('sha256').update(docJson).digest('hex');

      // 1. Insert activity parent row first
      this.connection.prepare(
        `INSERT INTO activities(id, title, type, theme, location, rules, archived, head_version, current_content_revision_id, current_media_revision_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, NULL, NULL, ?, ?)`
      ).run(id, title, type, theme, location, rules, now, now);

      // 2. Insert initial baseline ContentRevision (satisfies FOREIGN KEY to activities.id)
      this.connection.prepare(
        `INSERT INTO activity_content_revisions(id, activity_id, parent_id, document_json, schema_version, hash, created_source, created_at)
         VALUES (?, ?, NULL, ?, 1, ?, 'initial_baseline', ?)`
      ).run(initialRevId, id, docJson, hash, now);

      // 3. Insert initial baseline MediaRevision
      const initialBindings: MediaRevisionDocument['slotBindings'] = (initialDoc.mediaSlots || []).map((s) => ({
        slotId: s.id,
        slotFingerprint: hashDocument({ kind: s.kind, shot: s.shotDescription, actorIds: s.actorIds }),
        assets: [],
      }));
      const initialMediaDoc: MediaRevisionDocument = { schemaVersion: 1, slotBindings: initialBindings };
      const mediaHash = hashDocument(initialMediaDoc);

      this.connection.prepare(
        `INSERT INTO activity_media_revisions(id, activity_id, content_revision_id, slot_bindings_json, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(initialMediaRevId, id, initialRevId, JSON.stringify(initialBindings), mediaHash, now);

      // 4. Point activity to initial content revision and media revision
      this.connection.prepare(
        `UPDATE activities SET current_content_revision_id = ?, current_media_revision_id = ? WHERE id = ?`
      ).run(initialRevId, initialMediaRevId, id);

      // 5. Insert initial draft
      this.connection.prepare(
        `INSERT INTO activity_drafts(activity_id, draft_version, document_json, base_content_revision_id, updated_at)
         VALUES (?, 1, ?, ?, ?)`
      ).run(id, docJson, initialRevId, now);
      syncActivitySchedule(this.connection, id, initialDoc);

      // 6. Insert initial checkpoint
      const checkpointId = crypto.randomUUID();
      this.connection.prepare(
        `INSERT INTO activity_checkpoints(id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, created_at)
         VALUES (?, ?, '初始创建', 1, ?, ?, NULL, ?)`
      ).run(checkpointId, id, initialRevId, initialMediaRevId, now);

      const activity: Activity = {
        id,
        title,
        type,
        theme,
        location,
        rules,
        archived: false,
        headVersion: 1,
        currentContentRevisionId: initialRevId,
        currentMediaRevisionId: initialMediaRevId,
        currentPlaybackRevisionId: null,
        scheduledDate: normalizeScheduledDate(initialDoc.activity.scheduledDate),
        createdAt: now,
        updatedAt: now,
      };

      const draft: ActivityDraft = {
        activityId: id,
        draftVersion: 1,
        document: initialDoc,
        baseContentRevisionId: initialRevId,
        updatedAt: now,
      };

      return { activity, draft };
    };
    // 企划会话在同一个外层事务里创建活动并标记会话，需要跳过内层事务。
    return input.skipTransaction ? applyCreate() : this.db.transaction(applyCreate);
  }

  getActivity(id: string): Activity | null {
    const row = this.connection.prepare(
      `SELECT id, title, type, theme, location, rules, archived, head_version,
      current_content_revision_id, current_media_revision_id, current_playback_revision_id,
              scheduled_date, created_at, updated_at
       FROM activities WHERE id = ?`
    ).get(id) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: String(row.id),
      title: String(row.title),
      type: String(row.type),
      theme: String(row.theme || ''),
      location: String(row.location || ''),
      rules: String(row.rules || ''),
      archived: Boolean(row.archived),
      headVersion: Number(row.head_version),
      currentContentRevisionId: row.current_content_revision_id ? String(row.current_content_revision_id) : null,
      currentMediaRevisionId: row.current_media_revision_id ? String(row.current_media_revision_id) : null,
      currentPlaybackRevisionId: row.current_playback_revision_id ? String(row.current_playback_revision_id) : null,
      scheduledDate: row.scheduled_date ? String(row.scheduled_date) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listActivities(options: { q?: string; archived?: boolean; cursor?: string; limit?: number } = {}): {
    items: Activity[];
    nextCursor: string | null;
  } {
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const archived = options.archived ? 1 : 0;
    const params: (string | number)[] = [archived];
    let where = 'WHERE archived = ?';

    if (options.q?.trim()) {
      where += ' AND (title LIKE ? OR theme LIKE ? OR type LIKE ?)';
      const query = `%${options.q.trim()}%`;
      params.push(query, query, query);
    }

    if (options.cursor) {
      where += ' AND updated_at < ?';
      params.push(options.cursor);
    }

    params.push(limit + 1);

    const rows = this.connection.prepare(
      `SELECT id, title, type, theme, location, rules, archived, head_version,
              current_content_revision_id, current_media_revision_id, current_playback_revision_id,
              created_at, updated_at
       FROM activities
       ${where}
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(...params) as Record<string, unknown>[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items: Activity[] = pageRows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      type: String(r.type),
      theme: String(r.theme || ''),
      location: String(r.location || ''),
      rules: String(r.rules || ''),
      archived: Boolean(r.archived),
      headVersion: Number(r.head_version),
      currentContentRevisionId: r.current_content_revision_id ? String(r.current_content_revision_id) : null,
      currentMediaRevisionId: r.current_media_revision_id ? String(r.current_media_revision_id) : null,
      currentPlaybackRevisionId: r.current_playback_revision_id ? String(r.current_playback_revision_id) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));

    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].updatedAt : null;
    return { items, nextCursor };
  }

  updateActivity(
    id: string,
    expectedHeadVersion: number,
    patch: { title?: string; type?: string; theme?: string; location?: string; rules?: string; archived?: boolean }
  ): Activity | null {
    const act = this.getActivity(id);
    if (!act) return null;
    if (act.headVersion !== expectedHeadVersion) {
      const err = new Error('Activity head version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    const now = nowIso();
    const newHeadVersion = act.headVersion + 1;
    const title = patch.title !== undefined ? patch.title.trim() : act.title;
    const type = patch.type !== undefined ? patch.type.trim() : act.type;
    const theme = patch.theme !== undefined ? patch.theme.trim() : act.theme;
    const location = patch.location !== undefined ? patch.location.trim() : act.location;
    const rules = patch.rules !== undefined ? patch.rules.trim() : act.rules;
    const archived = patch.archived !== undefined ? (patch.archived ? 1 : 0) : (act.archived ? 1 : 0);

    const res = this.connection.prepare(
      `UPDATE activities
       SET title = ?, type = ?, theme = ?, location = ?, rules = ?, archived = ?, head_version = ?, updated_at = ?
       WHERE id = ? AND head_version = ?`
    ).run(title, type, theme, location, rules, archived, newHeadVersion, now, id, expectedHeadVersion);

    if (res.changes === 0) {
      const err = new Error('Activity CAS update conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    return this.getActivity(id);
  }

  deleteActivity(id: string): boolean {
    const res = this.connection.prepare('DELETE FROM activities WHERE id = ?').run(id);
    return res.changes > 0;
  }

  duplicateActivity(id: string, options: { title?: string; scope?: 'settings' | 'adopted' } = {}): Activity | null {
    const source = this.getActivity(id);
    if (!source) return null;
    const draft = this.getDraft(id);
    if (!draft) return null;

    const newId = crypto.randomUUID();
    const now = nowIso();
    const title = options.title?.trim() || `${source.title} (副本)`;

    // Clone content document with new activity title
    const newDoc: ContentDocument = JSON.parse(JSON.stringify(draft.document));
    newDoc.activity.title = title;
    // 复制活动默认清空排期，避免副本立刻占用原日期。
    newDoc.activity.scheduledDate = null;

    if (options.scope === 'settings') {
      // Keep only actors and stages; reset messages/posts
      newDoc.messages = [];
      newDoc.posts = [];
      newDoc.comments = [];
      newDoc.likes = [];
      newDoc.mediaSlots = [];
      newDoc.facts = [];
      newDoc.stageResults = [];
    }

    return this.db.transaction(() => {
      this.connection.prepare(
        `INSERT INTO activities(id, title, type, theme, location, rules, archived, head_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      ).run(newId, title, source.type, source.theme, source.location, source.rules, now, now);

      this.connection.prepare(
        `INSERT INTO activity_drafts(activity_id, draft_version, document_json, base_content_revision_id, updated_at)
         VALUES (?, 1, ?, NULL, ?)`
      ).run(newId, JSON.stringify(newDoc), now);
      clearActivitySchedule(this.connection, newId);

      return this.getActivity(newId);
    });
  }

  getDraft(activityId: string): ActivityDraft | null {
    const row = this.connection.prepare(
      `SELECT activity_id, draft_version, document_json, base_content_revision_id, updated_at
       FROM activity_drafts WHERE activity_id = ?`
    ).get(activityId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      activityId: String(row.activity_id),
      draftVersion: Number(row.draft_version),
      document: JSON.parse(String(row.document_json)),
      baseContentRevisionId: row.base_content_revision_id ? String(row.base_content_revision_id) : null,
      updatedAt: String(row.updated_at),
    };
  }

  updateDraft(
    activityId: string,
    expectedDraftVersion: number,
    document: ContentDocument
  ): ActivityDraft {
    const now = nowIso();
    const newDraftVersion = expectedDraftVersion + 1;

    const res = this.connection.prepare(
      `UPDATE activity_drafts
       SET draft_version = ?, document_json = ?, updated_at = ?
       WHERE activity_id = ? AND draft_version = ?`
    ).run(newDraftVersion, JSON.stringify(document), now, activityId, expectedDraftVersion);

    if (res.changes === 0) {
      const err = new Error('Draft version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'draft_version_conflict';
      throw err;
    }

    return {
      activityId,
      draftVersion: newDraftVersion,
      document,
      baseContentRevisionId: null,
      updatedAt: now,
    };
  }

  commitDraft(
    activityId: string,
    expectedHeadVersion: number,
    expectedDraftVersion: number,
    options: { skipTransaction?: boolean } = {}
  ): { activity: Activity; contentRevisionId: string; mediaRevisionId: string } {
    const act = this.getActivity(activityId);
    if (!act) throw new Error('Activity not found');
    if (act.headVersion !== expectedHeadVersion) {
      const err = new Error('Activity head version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    const draft = this.getDraft(activityId);
    if (!draft) throw new Error('Draft not found');
    if (draft.draftVersion !== expectedDraftVersion) {
      const err = new Error('Draft version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    // Validation: must have at least two stages
    if (!draft.document.stages || draft.document.stages.length < 2) {
      const err = new Error('Activity must contain at least two stages');
      (err as unknown as { statusCode: number; code: string }).statusCode = 400;
      (err as unknown as { code: string }).code = 'stage_count_invalid';
      throw err;
    }

    const contentRevId = crypto.randomUUID();
    const mediaRevId = crypto.randomUUID();
    const now = nowIso();
    const docHash = hashDocument(draft.document);

    // Migrate existing slot bindings from current media revision based on slotId + slotFingerprint
    const currentMediaRev = act.currentMediaRevisionId ? this.getMediaRevision(activityId, act.currentMediaRevisionId) : null;
    const existingBindingsMap = new Map<string, Array<{ assetKey: string; order: number }>>();
    if (currentMediaRev?.slotBindings) {
      for (const b of currentMediaRev.slotBindings) {
        existingBindingsMap.set(`${b.slotId}:::${b.slotFingerprint}`, b.assets);
        if (!existingBindingsMap.has(b.slotId)) {
          existingBindingsMap.set(b.slotId, b.assets);
        }
      }
    }

    const migratedBindings: MediaRevisionDocument['slotBindings'] = draft.document.mediaSlots.map((s) => {
      const fp = hashDocument({ kind: s.kind, shot: s.shotDescription, actorIds: s.actorIds });
      const preservedAssets = existingBindingsMap.get(`${s.id}:::${fp}`) || existingBindingsMap.get(s.id) || [];
      return {
        slotId: s.id,
        slotFingerprint: fp,
        assets: preservedAssets,
      };
    });
    const mediaDoc: MediaRevisionDocument = { schemaVersion: 1, slotBindings: migratedBindings };
    const mediaHash = hashDocument(mediaDoc);

    const applyCommit = () => {
      // 1. Write ContentRevision
      this.connection.prepare(
        `INSERT INTO activity_content_revisions(id, activity_id, parent_id, document_json, schema_version, hash, created_source, created_at)
         VALUES (?, ?, ?, ?, 1, ?, 'draft_commit', ?)`
      ).run(contentRevId, activityId, act.currentContentRevisionId, JSON.stringify(draft.document), docHash, now);

      // 2. Write MediaRevision
      this.connection.prepare(
        `INSERT INTO activity_media_revisions(id, activity_id, content_revision_id, slot_bindings_json, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(mediaRevId, activityId, contentRevId, JSON.stringify(migratedBindings), mediaHash, now);

      // 3. Write Checkpoint
      const checkpointId = crypto.randomUUID();
      const newHeadVersion = act.headVersion + 1;
      this.connection.prepare(
        `INSERT INTO activity_checkpoints(id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`
      ).run(checkpointId, activityId, `草稿保存提交 (v${newHeadVersion})`, newHeadVersion, contentRevId, mediaRevId, now);

      // 4. Update Activity head pointers and increment head_version
      this.connection.prepare(
        `UPDATE activities
         SET head_version = ?, current_content_revision_id = ?, current_media_revision_id = ?, current_playback_revision_id = NULL, updated_at = ?, title = ?, theme = ?, location = ?, rules = ?
         WHERE id = ? AND head_version = ?`
      ).run(newHeadVersion, contentRevId, mediaRevId, now, draft.document.activity.title, draft.document.activity.theme, draft.document.activity.location, draft.document.activity.rules, activityId, expectedHeadVersion);

      // 5. Update draft base_content_revision_id and reset draft_version to 1
      this.connection.prepare(
        `UPDATE activity_drafts
         SET draft_version = 1, base_content_revision_id = ?, updated_at = ?
         WHERE activity_id = ?`
      ).run(contentRevId, now, activityId);

      syncActivitySchedule(this.connection, activityId, draft.document);
      const updatedAct = this.getActivity(activityId)!;
      return {
        activity: updatedAct,
        contentRevisionId: contentRevId,
        mediaRevisionId: mediaRevId,
      };
    };
    // 候选采用需要在同一个外层事务中完成，此时跳过内层事务避免嵌套 BEGIN。
    return options.skipTransaction ? applyCommit() : this.db.transaction(applyCommit);
  }

  listContentRevisions(activityId: string, limit = 100): Array<{
    id: string;
    activityId: string;
    parentId: string | null;
    document: ContentDocument;
    schemaVersion: number;
    hash: string;
    createdSource: string;
    createdAt: string;
  }> {
    const rows = this.connection.prepare(
      `SELECT id, activity_id, parent_id, document_json, schema_version, hash, created_source, created_at
       FROM activity_content_revisions
       WHERE activity_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(activityId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      activityId: String(r.activity_id),
      parentId: r.parent_id ? String(r.parent_id) : null,
      document: JSON.parse(String(r.document_json)),
      schemaVersion: Number(r.schema_version),
      hash: String(r.hash),
      createdSource: String(r.created_source),
      createdAt: String(r.created_at),
    }));
  }

  getContentRevision(activityId: string, revisionId: string): { id: string; activityId: string; document: ContentDocument; hash: string; createdAt: string } | null {
    const row = this.connection.prepare(
      `SELECT id, activity_id, document_json, hash, created_at
       FROM activity_content_revisions
       WHERE activity_id = ? AND id = ?`
    ).get(activityId, revisionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: String(row.id),
      activityId: String(row.activity_id),
      document: JSON.parse(String(row.document_json)),
      hash: String(row.hash),
      createdAt: String(row.created_at),
    };
  }

  listCheckpoints(activityId: string, limit = 50): ActivityCheckpoint[] {
    const rows = this.connection.prepare(
      `SELECT id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, image_config_revision_id, created_at
       FROM activity_checkpoints
       WHERE activity_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(activityId, limit) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      activityId: String(r.activity_id),
      name: String(r.name),
      headVersion: Number(r.head_version),
      contentRevisionId: String(r.content_revision_id),
      mediaRevisionId: r.media_revision_id ? String(r.media_revision_id) : null,
      playbackRevisionId: r.playback_revision_id ? String(r.playback_revision_id) : null,
      imageConfigRevisionId: r.image_config_revision_id ? String(r.image_config_revision_id) : null,
      createdAt: String(r.created_at),
    }));
  }

  createCheckpoint(activityId: string, name: string): ActivityCheckpoint {
    const act = this.getActivity(activityId);
    if (!act) throw new Error('Activity not found');
    if (!act.currentContentRevisionId) throw new Error('Activity has no content revision');

    const id = crypto.randomUUID();
    const now = nowIso();
    const mediaRevId = act.currentMediaRevisionId || null;
    const currentMediaRev = mediaRevId ? this.getMediaRevision(activityId, mediaRevId) : null;
    const imageConfigRevId = currentMediaRev?.imageConfigRevisionId || null;

    this.connection.prepare(
      `INSERT INTO activity_checkpoints(id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, image_config_revision_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      activityId,
      name,
      act.headVersion,
      act.currentContentRevisionId,
      mediaRevId,
      act.currentPlaybackRevisionId,
      imageConfigRevId,
      now
    );

    return {
      id,
      activityId,
      name,
      headVersion: act.headVersion,
      contentRevisionId: act.currentContentRevisionId,
      mediaRevisionId: mediaRevId,
      playbackRevisionId: act.currentPlaybackRevisionId,
      imageConfigRevisionId: imageConfigRevId,
      createdAt: now,
    };
  }

  restoreCheckpoint(activityId: string, checkpointId: string, expectedHeadVersion?: number): Activity {
    const act = this.getActivity(activityId);
    if (!act) throw new Error('Activity not found');
    if (expectedHeadVersion !== undefined && act.headVersion !== expectedHeadVersion) {
      const err = new Error('Activity head version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    const cp = this.connection.prepare(
      `SELECT id, name, content_revision_id, media_revision_id, playback_revision_id, image_config_revision_id
       FROM activity_checkpoints WHERE activity_id = ? AND id = ?`
    ).get(activityId, checkpointId) as Record<string, unknown> | undefined;

    if (!cp) throw new Error('Checkpoint not found');

    const contentRev = this.getContentRevision(activityId, String(cp.content_revision_id));
    if (!contentRev) throw new Error('Referenced content revision not found');

    const now = nowIso();
    const newHeadVersion = act.headVersion + 1;

    const targetHead = expectedHeadVersion !== undefined ? expectedHeadVersion : act.headVersion;

    return this.db.transaction(() => {
      // 1. Update activity pointers
      this.connection.prepare(
        `UPDATE activities
         SET head_version = ?, current_content_revision_id = ?, current_media_revision_id = ?, current_playback_revision_id = ?, updated_at = ?, title = ?, theme = ?, location = ?, rules = ?
         WHERE id = ? AND head_version = ?`
      ).run(
        newHeadVersion,
        String(cp.content_revision_id),
        cp.media_revision_id ? String(cp.media_revision_id) : null,
        cp.playback_revision_id ? String(cp.playback_revision_id) : null,
        now,
        contentRev.document.activity.title,
        contentRev.document.activity.theme,
        contentRev.document.activity.location,
        contentRev.document.activity.rules,
        activityId,
        targetHead
      );

      // 2. Overwrite draft with restored content
      this.connection.prepare(
        `UPDATE activity_drafts
         SET draft_version = draft_version + 1, document_json = ?, base_content_revision_id = ?, updated_at = ?
         WHERE activity_id = ?`
      ).run(JSON.stringify(contentRev.document), String(cp.content_revision_id), now, activityId);
      // 恢复旧版本时同步排期投影：文档里没有日期即视为未排期。
      syncActivitySchedule(this.connection, activityId, contentRev.document);

      // 3. Restore image config draft if checkpoint has image_config_revision_id
      if (cp.image_config_revision_id) {
        const imgCfgRev = this.connection.prepare(
          'SELECT document_json FROM activity_image_config_revisions WHERE activity_id = ? AND id = ?'
        ).get(activityId, String(cp.image_config_revision_id)) as { document_json: string } | undefined;
        if (imgCfgRev) {
          this.connection.prepare(
            `UPDATE activity_image_config_drafts
             SET draft_version = draft_version + 1, document_json = ?, base_revision_id = ?, updated_at = ?
             WHERE activity_id = ?`
          ).run(imgCfgRev.document_json, String(cp.image_config_revision_id), now, activityId);
        }
      }

      // 4. Add restoration checkpoint
      const newCpId = crypto.randomUUID();
      this.connection.prepare(
        `INSERT INTO activity_checkpoints(id, activity_id, name, head_version, content_revision_id, media_revision_id, playback_revision_id, image_config_revision_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newCpId,
        activityId,
        `恢复至「${String(cp.name)}」`,
        newHeadVersion,
        String(cp.content_revision_id),
        cp.media_revision_id ? String(cp.media_revision_id) : null,
        cp.playback_revision_id ? String(cp.playback_revision_id) : null,
        cp.image_config_revision_id ? String(cp.image_config_revision_id) : null,
        now
      );

      return this.getActivity(activityId)!;
    });
  }

  // --- Candidates ---
  createCandidate(input: {
    activityId: string;
    baseRevisionId?: string | null;
    draftVersion?: number | null;
    scope: Record<string, unknown>;
    payload: Record<string, unknown>;
    validation: Record<string, unknown>;
  }): ActivityCandidate {
    const id = crypto.randomUUID();
    const now = nowIso();

    this.connection.prepare(
      `INSERT INTO activity_candidates(id, activity_id, base_revision_id, draft_version, scope_json, payload_json, validation_json, adopted, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      input.activityId,
      input.baseRevisionId || null,
      input.draftVersion || null,
      JSON.stringify(input.scope),
      JSON.stringify(input.payload),
      JSON.stringify(input.validation),
      now
    );

    return {
      id,
      activityId: input.activityId,
      baseRevisionId: input.baseRevisionId || null,
      draftVersion: input.draftVersion || null,
      scope: input.scope,
      payload: input.payload,
      validation: input.validation,
      adopted: false,
      createdAt: now,
    };
  }

  getCandidate(activityId: string, candidateId: string): ActivityCandidate | null {
    const row = this.connection.prepare(
      `SELECT id, activity_id, base_revision_id, draft_version, scope_json, payload_json, validation_json, adopted, created_at
       FROM activity_candidates WHERE activity_id = ? AND id = ?`
    ).get(activityId, candidateId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: String(row.id),
      activityId: String(row.activity_id),
      baseRevisionId: row.base_revision_id ? String(row.base_revision_id) : null,
      draftVersion: row.draft_version ? Number(row.draft_version) : null,
      scope: JSON.parse(String(row.scope_json)),
      payload: JSON.parse(String(row.payload_json)),
      validation: JSON.parse(String(row.validation_json)),
      adopted: Boolean(row.adopted),
      createdAt: String(row.created_at),
    };
  }

  // --- Media Revisions & Assets ---
  getMediaRevision(activityId: string, mediaRevisionId: string): { id: string; contentRevisionId: string; imageConfigRevisionId?: string; slotBindings: MediaRevisionDocument['slotBindings'] } | null {
    const row = this.connection.prepare(
      `SELECT id, content_revision_id, image_config_revision_id, slot_bindings_json
       FROM activity_media_revisions WHERE activity_id = ? AND id = ?`
    ).get(activityId, mediaRevisionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: String(row.id),
      contentRevisionId: String(row.content_revision_id),
      imageConfigRevisionId: row.image_config_revision_id ? String(row.image_config_revision_id) : undefined,
      slotBindings: JSON.parse(String(row.slot_bindings_json)),
    };
  }

  getMediaRevisionById(mediaRevisionId: string): { id: string; activityId: string; contentRevisionId: string; imageConfigRevisionId?: string; slotBindings: MediaRevisionDocument['slotBindings'] } | null {
    const row = this.connection.prepare(
      `SELECT id, activity_id, content_revision_id, image_config_revision_id, slot_bindings_json
       FROM activity_media_revisions WHERE id = ?`
    ).get(mediaRevisionId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      id: String(row.id),
      activityId: String(row.activity_id),
      contentRevisionId: String(row.content_revision_id),
      imageConfigRevisionId: row.image_config_revision_id ? String(row.image_config_revision_id) : undefined,
      slotBindings: JSON.parse(String(row.slot_bindings_json)),
    };
  }

  saveMediaSelection(
    activityId: string,
    expectedHeadVersion: number,
    slotBindings: MediaRevisionDocument['slotBindings']
  ): { activity: Activity; mediaRevisionId: string } {
    const act = this.getActivity(activityId);
    if (!act) throw new Error('Activity not found');
    if (act.headVersion !== expectedHeadVersion) {
      const err = new Error('Activity head version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    if (!act.currentContentRevisionId) {
      throw new Error('Activity must have an adopted content revision before saving media selection');
    }

    const prevMediaRev = act.currentMediaRevisionId
      ? this.getMediaRevision(activityId, act.currentMediaRevisionId)
      : null;
    const imageConfigRevId = prevMediaRev?.imageConfigRevisionId || null;

    const newMediaRevId = crypto.randomUUID();
    const now = nowIso();
    const mediaDoc: MediaRevisionDocument = { schemaVersion: 1, slotBindings };
    const hash = hashDocument(mediaDoc);
    const newHeadVersion = act.headVersion + 1;

    return this.db.transaction(() => {
      this.connection.prepare(
        `INSERT INTO activity_media_revisions(id, activity_id, content_revision_id, image_config_revision_id, slot_bindings_json, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newMediaRevId, activityId, act.currentContentRevisionId, imageConfigRevId, JSON.stringify(slotBindings), hash, now);

      // Invalidate current_playback_revision_id because media revision has changed!
      this.connection.prepare(
        `UPDATE activities
         SET head_version = ?, current_media_revision_id = ?, current_playback_revision_id = NULL, updated_at = ?
         WHERE id = ? AND head_version = ?`
      ).run(newHeadVersion, newMediaRevId, now, activityId, expectedHeadVersion);

      return {
        activity: this.getActivity(activityId)!,
        mediaRevisionId: newMediaRevId,
      };
    });
  }

  savePlaybackRevision(
    activityId: string,
    expectedHeadVersion: number,
    document: PlaybackDocument
  ): { activity: Activity; playbackRevisionId: string } {
    const act = this.getActivity(activityId);
    if (!act) throw new Error('Activity not found');
    if (act.headVersion !== expectedHeadVersion) {
      const err = new Error('Activity head version conflict');
      (err as unknown as { statusCode: number; code: string }).statusCode = 409;
      (err as unknown as { code: string }).code = 'revision_conflict';
      throw err;
    }

    // Consistency check: contentRevisionId must exist in this activity
    const contentRev = this.getContentRevision(activityId, document.contentRevisionId);
    if (!contentRev) {
      const err = new Error(`Content revision '${document.contentRevisionId}' not found for this activity`);
      (err as unknown as { statusCode: number; code: string }).statusCode = 400;
      (err as unknown as { code: string }).code = 'content_revision_not_found';
      throw err;
    }

    // Consistency check: mediaRevisionId must exist in this activity and be linked to contentRevisionId
    if (document.mediaRevisionId && document.mediaRevisionId !== 'none') {
      const mediaRev = this.getMediaRevision(activityId, document.mediaRevisionId);
      if (!mediaRev) {
        const err = new Error(`Media revision '${document.mediaRevisionId}' not found for this activity`);
        (err as unknown as { statusCode: number; code: string }).statusCode = 400;
        (err as unknown as { code: string }).code = 'media_revision_not_found';
        throw err;
      }
      if (mediaRev.contentRevisionId !== document.contentRevisionId) {
        const err = new Error(`Media revision '${document.mediaRevisionId}' is linked to content revision '${mediaRev.contentRevisionId}', not '${document.contentRevisionId}'`);
        (err as unknown as { statusCode: number; code: string }).statusCode = 400;
        (err as unknown as { code: string }).code = 'revision_consistency_mismatch';
        throw err;
      }
    }

    const newPlaybackRevId = crypto.randomUUID();
    const now = nowIso();
    const hash = hashDocument(document);
    const newHeadVersion = act.headVersion + 1;

    return this.db.transaction(() => {
      this.connection.prepare(
        `INSERT INTO activity_playback_revisions(id, activity_id, content_revision_id, media_revision_id, document_json, hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newPlaybackRevId,
        activityId,
        document.contentRevisionId,
        document.mediaRevisionId,
        JSON.stringify(document),
        hash,
        now
      );

      this.connection.prepare(
        `UPDATE activities
         SET head_version = ?, current_playback_revision_id = ?, updated_at = ?
         WHERE id = ? AND head_version = ?`
      ).run(newHeadVersion, newPlaybackRevId, now, activityId, expectedHeadVersion);

      return {
        activity: this.getActivity(activityId)!,
        playbackRevisionId: newPlaybackRevId,
      };
    });
  }

  getPlaybackRevision(activityId: string, revisionId: string): PlaybackDocument | null {
    const row = this.connection.prepare(
      `SELECT document_json FROM activity_playback_revisions WHERE activity_id = ? AND id = ?`
    ).get(activityId, revisionId) as { document_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.document_json) as PlaybackDocument;
  }

  getPlaybackRevisionRecord(activityId: string, revisionId: string): PlaybackRevision | null {
    const row = this.connection.prepare('SELECT * FROM activity_playback_revisions WHERE activity_id = ? AND id = ?').get(activityId, revisionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { id: String(row.id), activityId: String(row.activity_id), contentRevisionId: String(row.content_revision_id),
      mediaRevisionId: String(row.media_revision_id), document: JSON.parse(String(row.document_json)), hash: String(row.hash), createdAt: String(row.created_at) };
  }

  getPlaybackRevisionById(revisionId: string): PlaybackDocument | null {
    const row = this.connection.prepare(
      `SELECT document_json FROM activity_playback_revisions WHERE id = ?`
    ).get(revisionId) as { document_json: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.document_json) as PlaybackDocument;
  }

  // --- Assets ---
  saveAsset(asset: ActivityAsset): ActivityAsset {
    const existing = this.connection.prepare(
      `SELECT artifact_id FROM activity_assets WHERE activity_id = ? AND asset_key = ?`
    ).get(asset.activityId, asset.assetKey) as { artifact_id: string } | undefined;

    if (existing) {
      if (existing.artifact_id !== asset.artifactId) {
        const err = new Error(`asset_key_immutable_conflict: Asset key '${asset.assetKey}' is already bound to artifact '${existing.artifact_id}' and cannot be overwritten.`);
        (err as unknown as { statusCode: number; code: string }).statusCode = 409;
        (err as unknown as { code: string }).code = 'asset_key_immutable_conflict';
        throw err;
      }
      return asset;
    }

    this.connection.prepare(
      `INSERT INTO activity_assets(activity_id, asset_key, artifact_id, source, type, width, height, duration_ms, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      asset.activityId,
      asset.assetKey,
      asset.artifactId,
      asset.source,
      asset.type,
      asset.width ?? null,
      asset.height ?? null,
      asset.durationMs ?? null,
      asset.hash || null,
      asset.createdAt
    );
    return asset;
  }

  getAsset(activityId: string, assetKey: string): ActivityAsset | null {
    const row = this.connection.prepare(
      `SELECT activity_id, asset_key, artifact_id, source, type, width, height, duration_ms, hash, created_at
       FROM activity_assets WHERE activity_id = ? AND asset_key = ?`
    ).get(activityId, assetKey) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      activityId: String(row.activity_id),
      assetKey: String(row.asset_key),
      artifactId: String(row.artifact_id),
      source: String(row.source),
      type: row.type as ActivityAsset['type'],
      width: row.width ? Number(row.width) : null,
      height: row.height ? Number(row.height) : null,
      durationMs: row.duration_ms ? Number(row.duration_ms) : null,
      hash: String(row.hash),
      createdAt: String(row.created_at),
    };
  }

  listAssets(activityId: string): ActivityAsset[] {
    const rows = this.connection.prepare(
      `SELECT activity_id, asset_key, artifact_id, source, type, width, height, duration_ms, hash, created_at
       FROM activity_assets WHERE activity_id = ? ORDER BY created_at DESC`
    ).all(activityId) as Record<string, unknown>[];

    return rows.map((row) => ({
      activityId: String(row.activity_id),
      assetKey: String(row.asset_key),
      artifactId: String(row.artifact_id),
      source: String(row.source),
      type: row.type as ActivityAsset['type'],
      width: row.width ? Number(row.width) : null,
      height: row.height ? Number(row.height) : null,
      durationMs: row.duration_ms ? Number(row.duration_ms) : null,
      hash: String(row.hash),
      createdAt: String(row.created_at),
    }));
  }

  // --- Background Jobs ---
  createJob(job: {
    activityId: string;
    kind: ActivityJob['kind'];
    mode: string;
    requestHash: string;
    idempotencyKey?: string | null;
    targetRevisionId?: string | null;
    /** 原始请求快照：重试时必须按原样恢复，不能用当前草稿替代。 */
    request?: Record<string, unknown> | null;
  }): { job: ActivityJob; isExisting: boolean } {
    const now = nowIso();

    if (job.idempotencyKey) {
      const existing = this.connection.prepare(
        `SELECT id, activity_id, kind, mode, status, request_hash, idempotency_key, target_revision_id,
                result_candidate_ids_json, error_message, model_metadata_json, created_at, updated_at
         FROM activity_jobs
         WHERE activity_id = ? AND kind = ? AND idempotency_key = ?`
      ).get(job.activityId, job.kind, job.idempotencyKey) as Record<string, unknown> | undefined;

      if (existing) {
        if (existing.request_hash !== job.requestHash) {
          const err = new Error('Idempotency key reused with different request payload');
          (err as unknown as { statusCode: number; code: string }).statusCode = 409;
          (err as unknown as { code: string }).code = 'idempotency_conflict';
          throw err;
        }
        return {
          job: this.mapJobRow(existing),
          isExisting: true,
        };
      }
    }

    const id = crypto.randomUUID();
    this.connection.prepare(
      `INSERT INTO activity_jobs(id, activity_id, kind, mode, status, request_hash, idempotency_key, target_revision_id, request_json, result_candidate_ids_json, error_message, model_metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, '[]', NULL, '{}', ?, ?)`
    ).run(
      id,
      job.activityId,
      job.kind,
      job.mode,
      job.requestHash,
      job.idempotencyKey || null,
      job.targetRevisionId || null,
      JSON.stringify(job.request || {}),
      now,
      now
    );

    const created: ActivityJob = {
      id,
      activityId: job.activityId,
      kind: job.kind,
      mode: job.mode,
      status: 'queued',
      requestHash: job.requestHash,
      idempotencyKey: job.idempotencyKey || null,
      targetRevisionId: job.targetRevisionId || null,
      resultCandidateIds: [],
      replayable: Boolean(job.request && Object.keys(job.request).length > 0),
      errorMessage: null,
      modelMetadata: {},
      createdAt: now,
      updatedAt: now,
    };

    return { job: created, isExisting: false };
  }

  getJob(activityId: string, jobId: string): ActivityJob | null {
    const row = this.connection.prepare(
      `SELECT id, activity_id, kind, mode, status, request_hash, idempotency_key, target_revision_id, request_json,
              result_candidate_ids_json, error_message, model_metadata_json, created_at, updated_at
       FROM activity_jobs WHERE activity_id = ? AND id = ?`
    ).get(activityId, jobId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.mapJobRow(row);
  }

  /** 任务原始请求快照：只有保存过快照的任务才能原样重试。 */
  getJobRequest(jobId: string): Record<string, unknown> | null {
    const row = this.connection.prepare('SELECT request_json FROM activity_jobs WHERE id = ?').get(jobId) as { request_json?: string } | undefined;
    if (!row?.request_json) return null;
    try {
      const parsed = JSON.parse(String(row.request_json)) as Record<string, unknown>;
      return Object.keys(parsed).length ? parsed : null;
    } catch { return null; }
  }

  updateJob(
    jobId: string,
    patch: {
      status?: ActivityJob['status'];
      resultCandidateIds?: string[];
      errorMessage?: string | null;
      modelMetadata?: Record<string, unknown>;
    }
  ): void {
    const now = nowIso();
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [now];

    if (patch.status) {
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.resultCandidateIds) {
      sets.push('result_candidate_ids_json = ?');
      params.push(JSON.stringify(patch.resultCandidateIds));
    }
    if (patch.errorMessage !== undefined) {
      sets.push('error_message = ?');
      params.push(patch.errorMessage);
    }
    if (patch.modelMetadata) {
      sets.push('model_metadata_json = ?');
      params.push(JSON.stringify(patch.modelMetadata));
    }

    params.push(jobId);
    this.connection.prepare(`UPDATE activity_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  appendJobEvent(jobId: string, activityId: string, type: string, payload: Record<string, unknown>): void {
    const now = nowIso();
    this.connection.prepare(
      `INSERT INTO activity_job_events(job_id, activity_id, type, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(jobId, activityId, type, JSON.stringify(payload), now);
  }

  linkMediaJob(input: {
    taskId: string;
    activityId: string;
    contentRevisionId: string;
    slotId: string;
    slotFingerprint: string;
  }): void {
    const now = nowIso();
    this.connection.prepare(
      `INSERT INTO activity_media_job_links(task_id, activity_id, content_revision_id, slot_id, slot_fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id, slot_id) DO UPDATE SET
         slot_fingerprint = excluded.slot_fingerprint`
    ).run(
      input.taskId,
      input.activityId,
      input.contentRevisionId,
      input.slotId,
      input.slotFingerprint,
      now
    );
  }

  recoverDanglingJobs(): number {
    const now = nowIso();
    const res = this.connection.prepare(
      `UPDATE activity_jobs
       SET status = 'result_unknown', error_message = 'server_restarted_result_unknown', updated_at = ?
       WHERE status IN ('running', 'queued')`
    ).run(now);
    return Number(res.changes);
  }

  /** 活动排期与参与者投影可以随时从已采用的内容版本重建。 */
  rebuildSchedules(): number {
    return rebuildActivitySchedules(this.connection);
  }

  cancelJob(activityId: string, jobId: string): ActivityJob | null {
    const job = this.getJob(activityId, jobId);
    if (!job) return null;
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job;
    }
    this.updateJob(jobId, { status: 'cancelled' as ActivityJob['status'], errorMessage: '用户手动取消' });
    this.appendJobEvent(jobId, activityId, 'cancelled', {});
    return this.getJob(activityId, jobId);
  }

  retryJob(activityId: string, jobId: string): ActivityJob | null {
    const job = this.getJob(activityId, jobId);
    if (!job) return null;
    this.updateJob(jobId, { status: 'queued', errorMessage: null });
    this.appendJobEvent(jobId, activityId, 'retried', {});
    return this.getJob(activityId, jobId);
  }

  private mapJobRow(r: Record<string, unknown>): ActivityJob {
    return {
      id: String(r.id),
      activityId: String(r.activity_id),
      kind: r.kind as ActivityJob['kind'],
      mode: String(r.mode),
      status: r.status as ActivityJob['status'],
      requestHash: String(r.request_hash),
      idempotencyKey: r.idempotency_key ? String(r.idempotency_key) : null,
      targetRevisionId: r.target_revision_id ? String(r.target_revision_id) : null,
      resultCandidateIds: JSON.parse(String(r.result_candidate_ids_json || '[]')),
      replayable: Boolean(String(r.request_json || '') && String(r.request_json) !== '{}'),
      errorMessage: r.error_message ? String(r.error_message) : null,
      modelMetadata: JSON.parse(String(r.model_metadata_json || '{}')),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }
}
