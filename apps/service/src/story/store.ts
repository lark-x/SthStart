import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CreateNativeStoryProposal, CreateStoryCharacter, CreateStoryDocument, CreateStoryProject, CreateStoryProposal,
  StoryCharacter, StoryContextSettings, StoryDocument, StoryDocumentKind, StoryEntryRevision, StoryEntrySnapshot,
  StoryMessage, StoryProject, StoryProposal, StoryProposalKind, StorySession, StorySearchResult,
  UpdateStoryCharacter, UpdateStoryDocument, UpdateStoryProject,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

export const DEFAULT_STORY_CONTEXT: StoryContextSettings = {
  contextWindow: 32768, outputTokens: 4096, compactThreshold: 0.75, retainTokens: 2048,
};

export class StoryError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) { super(message); }
}

export function validateContextSettings(settings: StoryContextSettings) {
  const trigger = Math.floor(Math.min(settings.contextWindow * settings.compactThreshold,
    settings.contextWindow - settings.outputTokens - 4096));
  if (!Number.isFinite(trigger) || trigger <= settings.retainTokens || settings.outputTokens + 4096 >= settings.contextWindow) {
    throw new StoryError('invalid_context_settings', 400, '上下文窗口须大于输出上限、4096 token 余量与近期保留量。');
  }
}

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => String(row[key]);
const num = (row: Row, key: string) => Number(row[key]);
function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new StoryError('story_required_text', 400, `${label}不能为空。`);
  return trimmed;
}

function project(row: Row): StoryProject {
  return { id: str(row, 'id'), title: str(row, 'title'), summary: str(row, 'summary'), revision: num(row, 'revision'),
    contextSettings: JSON.parse(str(row, 'context_settings_json')) as StoryContextSettings,
    createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') };
}
function document(row: Row): StoryDocument {
  return { id: str(row, 'id'), projectId: str(row, 'project_id'), kind: str(row, 'kind') as StoryDocument['kind'],
    title: str(row, 'title'), body: str(row, 'body'), position: num(row, 'position'), revision: num(row, 'revision'),
    createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') };
}
function character(row: Row): StoryCharacter {
  return { id: str(row, 'id'), projectId: str(row, 'project_id'), name: str(row, 'name'), notes: str(row, 'notes'),
    sourceCharacterId: row.source_character_id === null ? null : str(row, 'source_character_id'),
    sourceVersion: row.source_version === null ? null : num(row, 'source_version'), revision: num(row, 'revision'),
    createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') };
}
function session(row: Row): StorySession {
  return { id: str(row, 'id'), projectId: str(row, 'project_id'), title: str(row, 'title'),
    runtimeSessionId: str(row, 'runtime_session_id'), status: str(row, 'status') as StorySession['status'],
    createdAt: str(row, 'created_at'), updatedAt: str(row, 'updated_at') };
}
function message(row: Row): StoryMessage {
  return { id: str(row, 'id'), sessionId: str(row, 'session_id'), role: str(row, 'role') as StoryMessage['role'],
    content: str(row, 'content'), status: str(row, 'status') as StoryMessage['status'], createdAt: str(row, 'created_at') };
}
function proposal(row: Row): StoryProposal {
  return { id: str(row, 'id'), projectId: str(row, 'project_id'),
    sessionId: row.session_id === null ? null : str(row, 'session_id'),
    operation: str(row, 'operation') as StoryProposal['operation'], origin: str(row, 'origin') as StoryProposal['origin'],
    kind: str(row, 'kind') as StoryProposal['kind'], targetId: row.target_id === null ? null : str(row, 'target_id'),
    baseRevision: row.base_revision === null ? null : num(row, 'base_revision'),
    resultEntryId: row.result_entry_id === null ? null : str(row, 'result_entry_id'),
    proposedTitle: str(row, 'proposed_title'), proposedBody: str(row, 'proposed_body'), reason: str(row, 'reason'),
    status: str(row, 'status') as StoryProposal['status'], createdAt: str(row, 'created_at'),
    decidedAt: row.decided_at === null ? null : str(row, 'decided_at') };
}

function entryRevision(row: Row): StoryEntryRevision {
  return { id: str(row, 'id'), projectId: str(row, 'project_id'),
    entryKind: str(row, 'entry_kind') as StoryEntryRevision['entryKind'], entryId: str(row, 'entry_id'),
    revision: num(row, 'revision'), snapshot: JSON.parse(str(row, 'snapshot_json')) as StoryEntrySnapshot,
    source: str(row, 'source') as StoryEntryRevision['source'],
    proposalId: row.proposal_id === null ? null : str(row, 'proposal_id'), createdAt: str(row, 'created_at') };
}

function snapshotOf(item: StoryDocument | StoryCharacter): StoryEntrySnapshot {
  return 'name' in item
    ? { kind: 'character', name: item.name, notes: item.notes, sourceCharacterId: item.sourceCharacterId, sourceVersion: item.sourceVersion }
    : { kind: item.kind, title: item.title, body: item.body };
}

export class StoryStore {
  constructor(private readonly db: ServiceDatabase) {}
  private get(sql: string, ...args: unknown[]) { return this.db.connection.prepare(sql).get(...args as []) as Row | undefined; }
  private all(sql: string, ...args: unknown[]) { return this.db.connection.prepare(sql).all(...args as []) as Row[]; }
  private recordRevision(projectId: string, item: StoryDocument | StoryCharacter, source: StoryEntryRevision['source'], proposalId: string | null = null) {
    const snapshot = snapshotOf(item);
    const kind = snapshot.kind;
    this.db.connection.prepare(`INSERT INTO story_entry_revisions
      (id,project_id,entry_kind,entry_id,revision,snapshot_json,source,proposal_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), projectId, kind, item.id, item.revision, JSON.stringify(snapshot), source, proposalId, item.updatedAt);
  }

  listProjects(): StoryProject[] { return this.all('SELECT * FROM story_projects ORDER BY updated_at DESC,id').map(project); }
  getProject(id: string): StoryProject | null { const row = this.get('SELECT * FROM story_projects WHERE id=?', id); return row ? project(row) : null; }
  requireProject(id: string): StoryProject {
    const item = this.getProject(id); if (!item) throw new StoryError('story_project_not_found', 404, '剧情项目不存在。'); return item;
  }
  createProject(input: CreateStoryProject): StoryProject {
    const id = randomUUID(); const now = nowIso();
    this.db.transaction(() => {
      this.db.connection.prepare('INSERT INTO story_projects VALUES (?,?,?,?,?,?,?)')
        .run(id, requiredText(input.title, '项目名称'), input.summary?.trim() ?? '', 1, JSON.stringify(DEFAULT_STORY_CONTEXT), now, now);
      const outlineId = randomUUID();
      this.db.connection.prepare('INSERT INTO story_documents VALUES (?,?,?,?,?,?,?,?,?)')
        .run(outlineId, id, 'outline', '主线大纲', '', 0, 1, now, now);
      this.recordRevision(id, this.getDocument(id, outlineId)!, 'manual');
    });
    return this.requireProject(id);
  }
  updateProject(id: string, input: UpdateStoryProject): StoryProject {
    const old = this.requireProject(id);
    if (input.contextSettings) validateContextSettings(input.contextSettings);
    const result = this.db.connection.prepare(`UPDATE story_projects SET title=?,summary=?,context_settings_json=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(input.title === undefined ? old.title : requiredText(input.title, '项目名称'), input.summary?.trim() ?? old.summary,
      JSON.stringify(input.contextSettings ?? old.contextSettings), nowIso(), id, input.expectedRevision);
    if (result.changes !== 1) throw new StoryError('story_revision_conflict', 409, '项目已被其他操作修改，请刷新后重试。');
    return this.requireProject(id);
  }

  listDocuments(projectId: string): StoryDocument[] {
    this.requireProject(projectId);
    return this.all("SELECT * FROM story_documents WHERE project_id=? ORDER BY CASE kind WHEN 'outline' THEN 0 WHEN 'world' THEN 1 WHEN 'scene' THEN 2 ELSE 3 END,position,id", projectId).map(document);
  }
  getDocument(projectId: string, id: string): StoryDocument | null {
    const row = this.get('SELECT * FROM story_documents WHERE project_id=? AND id=?', projectId, id); return row ? document(row) : null;
  }
  createDocument(projectId: string, input: CreateStoryDocument): StoryDocument {
    this.requireProject(projectId);
    if (input.kind === 'outline') throw new StoryError('story_outline_exists', 409, '项目已有主线大纲。');
    const id = randomUUID(); const now = nowIso();
    const position = Number((this.get('SELECT COALESCE(MAX(position),-1)+1 AS next FROM story_documents WHERE project_id=? AND kind=?', projectId, input.kind))?.next ?? 0);
    return this.db.transaction(() => {
      this.db.connection.prepare('INSERT INTO story_documents VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, projectId, input.kind, requiredText(input.title, '条目标题'), input.body ?? '', position, 1, now, now);
      const created = this.getDocument(projectId, id)!;
      this.recordRevision(projectId, created, 'manual');
      return created;
    });
  }
  updateDocument(projectId: string, id: string, input: UpdateStoryDocument): StoryDocument {
    return this.db.transaction(() => {
      const result = this.db.connection.prepare(`UPDATE story_documents SET title=?,body=?,revision=revision+1,updated_at=?
        WHERE project_id=? AND id=? AND revision=?`).run(requiredText(input.title, '条目标题'), input.body, nowIso(), projectId, id, input.expectedRevision);
      if (result.changes !== 1) throw new StoryError('story_revision_conflict', 409, '内容已变化，请刷新后重试。');
      const updated = this.getDocument(projectId, id)!;
      this.recordRevision(projectId, updated, 'manual');
      return updated;
    });
  }

  listCharacters(projectId: string): StoryCharacter[] {
    this.requireProject(projectId);
    return this.all('SELECT * FROM story_characters WHERE project_id=? ORDER BY name,id', projectId).map(character);
  }
  getCharacter(projectId: string, id: string): StoryCharacter | null {
    const row = this.get('SELECT * FROM story_characters WHERE project_id=? AND id=?', projectId, id); return row ? character(row) : null;
  }
  getCharacterSourceSnapshot(item: StoryCharacter): unknown | null {
    if (!item.sourceCharacterId || item.sourceVersion === null) return null;
    const row = this.get('SELECT data_json FROM character_versions WHERE character_id=? AND version=?', item.sourceCharacterId, item.sourceVersion);
    return row ? JSON.parse(str(row, 'data_json')) as unknown : null;
  }
  createCharacter(projectId: string, input: CreateStoryCharacter): StoryCharacter {
    this.requireProject(projectId);
    if (Boolean(input.sourceCharacterId) !== Boolean(input.sourceVersion)) throw new StoryError('story_character_source_invalid', 400, '来源角色与版本必须同时提供。');
    if (input.sourceCharacterId && !this.get('SELECT 1 FROM character_versions WHERE character_id=? AND version=?', input.sourceCharacterId, input.sourceVersion)) {
      throw new StoryError('story_character_source_missing', 400, '角色资料库中找不到指定版本。');
    }
    const id = randomUUID(); const now = nowIso();
    return this.db.transaction(() => {
      this.db.connection.prepare('INSERT INTO story_characters VALUES (?,?,?,?,?,?,?,?,?)')
        .run(id, projectId, requiredText(input.name, '角色名称'), input.notes ?? '', input.sourceCharacterId ?? null, input.sourceVersion ?? null, 1, now, now);
      const created = this.getCharacter(projectId, id)!;
      this.recordRevision(projectId, created, 'manual');
      return created;
    });
  }
  updateCharacter(projectId: string, id: string, input: UpdateStoryCharacter): StoryCharacter {
    return this.db.transaction(() => {
      const result = this.db.connection.prepare(`UPDATE story_characters SET name=?,notes=?,revision=revision+1,updated_at=?
        WHERE project_id=? AND id=? AND revision=?`).run(requiredText(input.name, '角色名称'), input.notes, nowIso(), projectId, id, input.expectedRevision);
      if (result.changes !== 1) throw new StoryError('story_revision_conflict', 409, '角色设定已变化，请刷新后重试。');
      const updated = this.getCharacter(projectId, id)!;
      this.recordRevision(projectId, updated, 'manual');
      return updated;
    });
  }

  listEntryRevisions(projectId: string, kind: StoryDocumentKind | 'character', entryId: string): StoryEntryRevision[] {
    this.requireEntry(projectId, kind, entryId);
    return this.all('SELECT * FROM story_entry_revisions WHERE project_id=? AND entry_kind=? AND entry_id=? ORDER BY revision DESC',
      projectId, kind, entryId).map(entryRevision);
  }
  getEntryRevision(projectId: string, revisionId: string): StoryEntryRevision | null {
    const row = this.get('SELECT * FROM story_entry_revisions WHERE project_id=? AND id=?', projectId, revisionId);
    return row ? entryRevision(row) : null;
  }
  private requireEntry(projectId: string, kind: StoryDocumentKind | 'character', entryId: string): StoryDocument | StoryCharacter {
    this.requireProject(projectId);
    if (kind === 'character') {
      const item = this.getCharacter(projectId, entryId);
      if (!item) throw new StoryError('story_target_not_found', 404, '项目角色不存在。');
      return item;
    }
    const item = this.getDocument(projectId, entryId);
    if (!item || item.kind !== kind) throw new StoryError('story_target_not_found', 404, '剧情条目不存在或类型不匹配。');
    return item;
  }
  restoreEntryRevision(projectId: string, kind: StoryDocumentKind | 'character', entryId: string,
    revisionId: string, expectedRevision: number): StoryDocument | StoryCharacter {
    return this.db.transaction(() => {
      const current = this.requireEntry(projectId, kind, entryId);
      const old = this.getEntryRevision(projectId, revisionId);
      if (!old || old.entryKind !== kind || old.entryId !== entryId) throw new StoryError('story_revision_not_found', 404, '找不到该条目的指定版本。');
      if (old.snapshot.kind === 'character') {
        if (kind !== 'character' || !('name' in current)) throw new StoryError('story_revision_kind_mismatch', 409, '版本类型与当前条目不匹配。');
        const sourceId = old.snapshot.sourceCharacterId;
        const sourceVersion = old.snapshot.sourceVersion;
        if (sourceId && sourceVersion !== null && !this.get('SELECT 1 FROM character_versions WHERE character_id=? AND version=?', sourceId, sourceVersion)) {
          throw new StoryError('story_revision_source_unavailable', 409, '该版本引用的角色来源已不可用，不能直接恢复。');
        }
        const changed = this.db.connection.prepare(`UPDATE story_characters SET name=?,notes=?,source_character_id=?,source_version=?,
          revision=revision+1,updated_at=? WHERE project_id=? AND id=? AND revision=?`)
          .run(old.snapshot.name, old.snapshot.notes, sourceId, sourceVersion, nowIso(), projectId, entryId, expectedRevision);
        if (changed.changes !== 1) throw new StoryError('story_revision_conflict', 409, '角色内容已变化，请刷新后重试。');
        const updated = this.getCharacter(projectId, entryId)!;
        this.recordRevision(projectId, updated, 'restore');
        return updated;
      }
      if (kind === 'character' || !('title' in current) || old.snapshot.kind !== kind) {
        throw new StoryError('story_revision_kind_mismatch', 409, '版本类型与当前条目不匹配。');
      }
      const changed = this.db.connection.prepare(`UPDATE story_documents SET title=?,body=?,revision=revision+1,updated_at=?
        WHERE project_id=? AND id=? AND kind=? AND revision=?`)
        .run(old.snapshot.title, old.snapshot.body, nowIso(), projectId, entryId, kind, expectedRevision);
      if (changed.changes !== 1) throw new StoryError('story_revision_conflict', 409, '内容已变化，请刷新后重试。');
      const updated = this.getDocument(projectId, entryId)!;
      this.recordRevision(projectId, updated, 'restore');
      return updated;
    });
  }
  reorderChapters(projectId: string, expectedProjectRevision: number, chapterIds: string[]): StoryProject {
    return this.db.transaction(() => {
      const currentProject = this.requireProject(projectId);
      if (currentProject.revision !== expectedProjectRevision) throw new StoryError('story_revision_conflict', 409, '项目已变化，请刷新章节列表后重试。');
      const currentIds = this.all("SELECT id FROM story_documents WHERE project_id=? AND kind='chapter' ORDER BY position,id", projectId)
        .map((row) => str(row, 'id'));
      if (new Set(chapterIds).size !== chapterIds.length || chapterIds.length !== currentIds.length
        || currentIds.some((id) => !chapterIds.includes(id))) {
        throw new StoryError('story_chapter_order_invalid', 400, '排序必须完整且仅包含当前项目的章节。');
      }
      const changed = this.db.connection.prepare('UPDATE story_projects SET revision=revision+1,updated_at=? WHERE id=? AND revision=?')
        .run(nowIso(), projectId, expectedProjectRevision);
      if (changed.changes !== 1) throw new StoryError('story_revision_conflict', 409, '项目已变化，请刷新章节列表后重试。');
      const update = this.db.connection.prepare("UPDATE story_documents SET position=? WHERE project_id=? AND id=? AND kind='chapter'");
      chapterIds.forEach((id, position) => update.run(position, projectId, id));
      return this.requireProject(projectId);
    });
  }
  searchEntries(projectId: string, query: string, kind?: StoryProposalKind, limit = 20, cursor = 0): { items: StorySearchResult[]; nextCursor: number | null } {
    this.requireProject(projectId);
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || needle.length > 120) throw new StoryError('story_search_query_invalid', 400, '搜索词须为 1 到 120 个字符。');
    const documents = kind === 'character' ? [] : this.all('SELECT * FROM story_documents WHERE project_id=?', projectId).map(document);
    const characters = kind && kind !== 'character' ? [] : this.listCharacters(projectId);
    const matches: StorySearchResult[] = [];
    for (const item of [...documents, ...characters]) {
      const isCharacter = 'name' in item;
      const entryKind: StoryProposalKind = isCharacter ? 'character' : item.kind;
      if (kind && kind !== entryKind) continue;
      const title = isCharacter ? item.name : item.title;
      const body = isCharacter ? item.notes : item.body;
      const text = `${title}\n${body}`;
      const at = text.toLocaleLowerCase().indexOf(needle);
      if (at < 0) continue;
      const excerptStart = Math.max(0, at - 160);
      matches.push({ kind: entryKind, id: item.id, title, revision: item.revision,
        excerpt: text.slice(excerptStart, excerptStart + 520) });
    }
    const start = Math.max(0, cursor);
    const page = matches.slice(start, start + Math.min(20, Math.max(1, limit)));
    return { items: page, nextCursor: start + page.length < matches.length ? start + page.length : null };
  }

  createBridgeGrant(projectId: string): { token: string; createdAt: string } {
    this.requireProject(projectId);
    const token = Buffer.from(randomBytes(32)).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const createdAt = nowIso();
    this.db.connection.prepare(`INSERT INTO story_bridge_grants(project_id,token_hash,created_at,last_used_at) VALUES (?,?,?,NULL)
      ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,last_used_at=NULL`)
      .run(projectId, tokenHash, createdAt);
    return { token, createdAt };
  }
  revokeBridgeGrant(projectId: string): void {
    this.requireProject(projectId);
    this.db.connection.prepare('DELETE FROM story_bridge_grants WHERE project_id=?').run(projectId);
  }
  getBridgeGrantStatus(projectId: string, presence: { running: boolean; lastHeartbeatAt: string | null } = { running: false, lastHeartbeatAt: null }) {
    this.requireProject(projectId);
    const row = this.get('SELECT created_at,last_used_at FROM story_bridge_grants WHERE project_id=?', projectId);
    return { projectId, paired: Boolean(row), createdAt: row ? str(row, 'created_at') : null,
      lastUsedAt: row?.last_used_at == null ? null : str(row, 'last_used_at'), ...presence };
  }
  authorizeBridge(projectId: string, token: string): boolean {
    if (!token || token.length > 256) return false;
    const row = this.get('SELECT token_hash FROM story_bridge_grants WHERE project_id=?', projectId);
    if (!row) return false;
    const expected = Buffer.from(str(row, 'token_hash'), 'hex');
    const supplied = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    this.db.connection.prepare('UPDATE story_bridge_grants SET last_used_at=? WHERE project_id=?').run(nowIso(), projectId);
    return true;
  }

  listSessions(projectId: string): StorySession[] {
    this.requireProject(projectId);
    return this.all('SELECT * FROM story_agent_sessions WHERE project_id=? ORDER BY updated_at DESC,id', projectId).map(session);
  }
  getSession(id: string): StorySession | null {
    const row = this.get('SELECT * FROM story_agent_sessions WHERE id=?', id); return row ? session(row) : null;
  }
  requireSession(projectId: string, id: string): StorySession {
    const item = this.getSession(id); if (!item || item.projectId !== projectId) throw new StoryError('story_session_not_found', 404, 'AI 会话不存在。'); return item;
  }
  getSessionByRuntimeId(projectId: string, runtimeSessionId: string): StorySession | null {
    const row = this.get('SELECT * FROM story_agent_sessions WHERE project_id=? AND runtime_session_id=?', projectId, runtimeSessionId);
    return row ? session(row) : null;
  }
  createSession(projectId: string, title: string): StorySession {
    this.requireProject(projectId);
    const id = randomUUID(); const now = nowIso();
    this.db.connection.prepare('INSERT INTO story_agent_sessions VALUES (?,?,?,?,?,?,?)')
      .run(id, projectId, requiredText(title, '会话标题'), `session-${randomUUID().replaceAll('-', '')}`, 'idle', now, now);
    return this.requireSession(projectId, id);
  }
  listMessages(projectId: string, sessionId: string): StoryMessage[] {
    this.requireSession(projectId, sessionId);
    return this.all('SELECT * FROM story_agent_messages WHERE session_id=? ORDER BY rowid', sessionId).map(message);
  }
  beginMessage(projectId: string, sessionId: string, content: string, key: string): { item: StoryMessage; created: boolean } {
    this.requireSession(projectId, sessionId);
    return this.db.transaction(() => {
      const existing = this.get('SELECT * FROM story_agent_messages WHERE session_id=? AND idempotency_key=?', sessionId, key);
      if (existing) {
        if (str(existing, 'content') !== content) throw new StoryError('story_idempotency_conflict', 409, '同一请求键不能提交不同内容。');
        return { item: message(existing), created: false };
      }
      const now = nowIso();
      const claimed = this.db.connection.prepare("UPDATE story_agent_sessions SET status='running',updated_at=? WHERE id=? AND project_id=? AND status='idle'")
        .run(now, sessionId, projectId);
      if (claimed.changes !== 1) throw new StoryError('story_session_busy', 409, '此会话已有任务，或上次调用状态尚未确认。');
      const id = randomUUID();
      this.db.connection.prepare('INSERT INTO story_agent_messages VALUES (?,?,?,?,?,?,?)')
        .run(id, sessionId, 'user', content, 'pending', key, now);
      return { item: message(this.get('SELECT * FROM story_agent_messages WHERE id=?', id)!), created: true };
    });
  }
  completeMessage(projectId: string, sessionId: string, userMessageId: string, response: string): StoryMessage {
    this.requireSession(projectId, sessionId);
    return this.db.transaction(() => {
      const now = nowIso(); const id = randomUUID();
      const updated = this.db.connection.prepare("UPDATE story_agent_messages SET status='completed' WHERE id=? AND session_id=? AND role='user' AND status='pending'")
        .run(userMessageId, sessionId);
      if (updated.changes !== 1) throw new StoryError('story_message_not_pending', 409, '该消息已处理，不能重复写入回复。');
      this.db.connection.prepare('INSERT INTO story_agent_messages VALUES (?,?,?,?,?,?,?)')
        .run(id, sessionId, 'assistant', response, 'completed', null, now);
      this.db.connection.prepare("UPDATE story_agent_sessions SET status='idle',updated_at=? WHERE id=?").run(now, sessionId);
      return message(this.get('SELECT * FROM story_agent_messages WHERE id=?', id)!);
    });
  }
  interruptMessage(projectId: string, sessionId: string, userMessageId: string): void {
    this.requireSession(projectId, sessionId);
    this.db.transaction(() => {
      this.db.connection.prepare("UPDATE story_agent_messages SET status='interrupted' WHERE id=? AND session_id=? AND status='pending'").run(userMessageId, sessionId);
      this.db.connection.prepare("UPDATE story_agent_sessions SET status='interrupted',updated_at=? WHERE id=?").run(nowIso(), sessionId);
    });
  }
  recoverInterruptedSessions(): number {
    return this.db.transaction(() => {
      this.db.connection.prepare("UPDATE story_agent_messages SET status='interrupted' WHERE status='pending'").run();
      return Number(this.db.connection.prepare("UPDATE story_agent_sessions SET status='interrupted',updated_at=? WHERE status='running'").run(nowIso()).changes);
    });
  }
  acknowledgeInterruptedSession(projectId: string, sessionId: string): StorySession {
    this.requireSession(projectId, sessionId);
    this.db.connection.prepare("UPDATE story_agent_sessions SET status='idle',updated_at=? WHERE id=? AND status='interrupted'").run(nowIso(), sessionId);
    return this.requireSession(projectId, sessionId);
  }

  listProposals(projectId: string): StoryProposal[] {
    this.requireProject(projectId);
    return this.all('SELECT * FROM story_proposals WHERE project_id=? ORDER BY created_at DESC,id', projectId).map(proposal);
  }
  getProposal(projectId: string, id: string): StoryProposal | null {
    const row = this.get('SELECT * FROM story_proposals WHERE project_id=? AND id=?', projectId, id); return row ? proposal(row) : null;
  }
  private proposalTarget(projectId: string, kind: StoryProposal['kind'], targetId: string | null): StoryDocument | StoryCharacter {
    if (!targetId) throw new StoryError('story_target_not_found', 404, '提案目标不存在。');
    if (kind === 'character') {
      const target = this.getCharacter(projectId, targetId);
      if (!target) throw new StoryError('story_target_not_found', 404, '项目角色不存在。');
      return target;
    }
    const target = this.getDocument(projectId, targetId);
    if (!target || target.kind !== kind) throw new StoryError('story_target_not_found', 404, '目标剧情条目不存在或类型不匹配。');
    return target;
  }
  createProposal(projectId: string, input: CreateStoryProposal): StoryProposal {
    this.requireSession(projectId, input.sessionId);
    const target = this.proposalTarget(projectId, input.kind, input.targetId);
    if (target.revision !== input.baseRevision) throw new StoryError('story_revision_conflict', 409, '提案依据的版本已变化。');
    const id = randomUUID(); const now = nowIso();
    this.db.connection.prepare(`INSERT INTO story_proposals
      (id,project_id,session_id,operation,origin,kind,target_id,base_revision,result_entry_id,proposed_title,proposed_body,reason,status,created_at,decided_at)
      VALUES (?,?,?,'update','legacy',?,?,?,NULL,?,?,?,'pending',?,NULL)`)
      .run(id, projectId, input.sessionId, input.kind, input.targetId, input.baseRevision,
        requiredText(input.proposedTitle, '提案标题'), input.proposedBody, requiredText(input.reason, '提案原因'), now);
    return this.getProposal(projectId, id)!;
  }
  createNativeProposal(projectId: string, input: CreateNativeStoryProposal): { proposal: StoryProposal; created: boolean } {
    this.requireProject(projectId);
    if (input.operation === 'update') {
      const target = this.proposalTarget(projectId, input.kind, input.targetId);
      if (target.revision !== input.baseRevision) throw new StoryError('story_revision_conflict', 409, '提案依据的版本已变化，请重新读取目标后再提交。');
    } else {
      if (input.targetId !== null || input.baseRevision !== null) throw new StoryError('story_proposal_shape_invalid', 400, '新建提案不能指定目标或基准版本。');
    }
    const title = requiredText(input.proposedTitle, '提案标题');
    const reason = requiredText(input.reason, '提案原因');
    const id = randomUUID(); const now = nowIso();
    this.db.connection.prepare(`INSERT INTO story_proposals
      (id,project_id,session_id,operation,origin,kind,target_id,base_revision,result_entry_id,proposed_title,proposed_body,reason,status,created_at,decided_at)
      VALUES (?,?,NULL,?,'native_dsh',?,?,?,NULL,?,?,?,'pending',?,NULL)`)
      .run(id, projectId, input.operation, input.kind,
        input.operation === 'update' ? input.targetId : null, input.operation === 'update' ? input.baseRevision : null,
        title, input.proposedBody, reason, now);
    return { proposal: this.getProposal(projectId, id)!, created: true };
  }
  decideProposal(projectId: string, id: string, decision: 'accepted' | 'rejected'): StoryProposal {
    return this.db.transaction(() => {
      const item = this.getProposal(projectId, id);
      if (!item) throw new StoryError('story_proposal_not_found', 404, '提案不存在。');
      if (item.status === decision) return item;
      if (item.status !== 'pending') throw new StoryError('story_proposal_decided', 409, '提案已处理，不能改为另一种结果。');
      let resultEntryId: string | null = null;
      if (decision === 'accepted') {
        if (item.operation === 'update') {
          if (item.baseRevision === null || !item.targetId) throw new StoryError('story_proposal_shape_invalid', 409, '更新提案缺少目标版本。');
          const current = this.proposalTarget(projectId, item.kind, item.targetId);
          const now = nowIso();
          const result = item.kind === 'character'
            ? this.db.connection.prepare(`UPDATE story_characters SET name=?,notes=?,revision=revision+1,updated_at=?
                WHERE id=? AND project_id=? AND revision=?`).run(item.proposedTitle, item.proposedBody, now, item.targetId, projectId, item.baseRevision)
            : this.db.connection.prepare(`UPDATE story_documents SET title=?,body=?,revision=revision+1,updated_at=?
                WHERE id=? AND project_id=? AND revision=? AND kind=?`).run(item.proposedTitle, item.proposedBody, now, item.targetId, projectId, item.baseRevision, item.kind);
          if (result.changes !== 1) throw new StoryError('story_proposal_stale', 409, '目标内容已变化，提案未应用；请重新审阅。');
          const updated = item.kind === 'character' ? this.getCharacter(projectId, item.targetId)! : this.getDocument(projectId, item.targetId)!;
          this.recordRevision(projectId, updated, 'proposal', item.id);
          resultEntryId = current.id;
        } else {
          if (item.kind === 'outline') throw new StoryError('story_proposal_shape_invalid', 409, '大纲不能通过新建提案创建。');
          resultEntryId = randomUUID();
          const now = nowIso();
          if (item.kind === 'character') {
            this.db.connection.prepare(`INSERT INTO story_characters
              (id,project_id,name,notes,source_character_id,source_version,revision,created_at,updated_at) VALUES (?,?,?, ?,NULL,NULL,1,?,?)`)
              .run(resultEntryId, projectId, item.proposedTitle, item.proposedBody, now, now);
            this.recordRevision(projectId, this.getCharacter(projectId, resultEntryId)!, 'proposal', item.id);
          } else {
            const position = Number((this.get('SELECT COALESCE(MAX(position),-1)+1 AS next FROM story_documents WHERE project_id=? AND kind=?', projectId, item.kind))?.next ?? 0);
            this.db.connection.prepare(`INSERT INTO story_documents
              (id,project_id,kind,title,body,position,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`)
              .run(resultEntryId, projectId, item.kind, item.proposedTitle, item.proposedBody, position, now, now);
            this.recordRevision(projectId, this.getDocument(projectId, resultEntryId)!, 'proposal', item.id);
          }
        }
      }
      this.db.connection.prepare('UPDATE story_proposals SET status=?,result_entry_id=?,decided_at=? WHERE id=? AND status=\'pending\'')
        .run(decision, resultEntryId, nowIso(), id);
      return this.getProposal(projectId, id)!;
    });
  }
}
