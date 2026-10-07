import { randomUUID, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import {Buffer} from 'node:buffer';
import { existsSync } from 'node:fs';
import { Value } from '@sinclair/typebox/value';
import { PublicationDocumentSchema, SpeechProfileSchema, type PublicationDocument, type PublicationDraft,
  type PublicationApproval, type PublicationApprovalRequest, type PublicationRun, type PublicationTask,
  type SpeechProfile, type PublicationSourceBundle, type PublicationHistory } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { StoryStore } from '../story/store.js';
import { ActivityStore } from '../activities/store.js';
import { createArtifactReference, resolveArtifactStoragePath } from '../artifacts.js';
import { hashVisualPlan } from '../activities/image-render-common.js';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
export const fingerprint = hashVisualPlan;
export function publicationError(code: string, message: string, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function shotFingerprint(doc: PublicationDocument, shotId: string) {
  const shot = doc.shots.find(s => s.id === shotId);
  return fingerprint({ shot: shot ? { ...shot, selectedImage: undefined, utterances: undefined, presentation: undefined } : null,
    actors: doc.actors.filter(a => shot?.actorIds.includes(a.id)).map(a => ({ ...a, voiceBindingId: undefined })) });
}
export function utteranceFingerprint(doc: PublicationDocument, id: string) {
  const utterance = doc.shots.flatMap(s => s.utterances).find(u => u.id === id);
  const actor = doc.actors.find(a => a.id === utterance?.speakerActorId);
  return fingerprint({ text: utterance?.text, voice: utterance?.voiceBindingId ?? actor?.voiceBindingId ?? null });
}
export function contentFingerprint(doc: PublicationDocument) {
  return fingerprint({ ...doc, shots: doc.shots.map(s => ({ ...s, selectedImage: null,
    utterances: s.utterances.map(u => ({ ...u, selectedAudioArtifactId: null })) })) });
}

/** Independent from legacy activity drafts and all canonical Story writers. */
export class PublicationStore {
  private story: StoryStore;
  constructor(readonly db: ServiceDatabase, readonly artifactDirectory: string) { this.story = new StoryStore(db); }
  private get(sql: string, ...args: (string | number)[]): Row | undefined { return this.db.connection.prepare(sql).get(...args) as Row | undefined; }
  private all(sql: string, ...args: (string | number)[]): Row[] { return this.db.connection.prepare(sql).all(...args) as Row[]; }
  sourceBundle(projectId: string, ids: string[]): PublicationSourceBundle {
    this.story.requireProject(projectId);
    if (!ids.length || new Set(ids).size !== ids.length) throw publicationError('publication_source_invalid', '请选择不重复的已保存章节版本。');
    const revisions = ids.map(id => {
      const revision = this.story.getEntryRevision(projectId, id);
      if (!revision || revision.entryKind !== 'chapter') throw publicationError('publication_source_invalid', `来源版本 ${id} 不属于本项目章节。`);
      return revision;
    });
    return { revisions, sourceHash: fingerprint(revisions) };
  }
  validate(doc: PublicationDocument, expectedProjectId?: string) {
    if (!Value.Check(PublicationDocumentSchema, doc)) {
      const issue = [...Value.Errors(PublicationDocumentSchema, doc)][0];
      throw publicationError('publication_document_invalid', `制作文档 ${issue?.path ?? '/'} 格式错误。`);
    }
    if (expectedProjectId && doc.source.storyProjectId !== expectedProjectId) throw publicationError('publication_source_changed', '不能替换制作项目来源。', 409);
    const source = this.sourceBundle(doc.source.storyProjectId, doc.source.entryRevisionIds);
    if (doc.source.sourceHash !== source.sourceHash) throw publicationError('publication_source_changed', '章节版本指纹不一致。', 409);
    const ids = new Set<string>();
    const unique = (id: string, path: string) => { if (ids.has(id)) throw publicationError('publication_duplicate_id', `${path} ID 重复：${id}`); ids.add(id); };
    for (const actor of doc.actors) {
      unique(actor.id, 'actors');
      if (actor.entryRevisionId && this.story.getEntryRevision(doc.source.storyProjectId, actor.entryRevisionId)?.entryKind !== 'character') {
        throw publicationError('publication_actor_invalid', `角色 ${actor.name} 的正式来源版本无效。`);
      }
    }
    for (const shot of doc.shots) {
      unique(shot.id, 'shots');
      if (new Set(shot.actorIds).size !== shot.actorIds.length || shot.actorIds.some(id => !doc.actors.some(a => a.id === id))) throw publicationError('publication_actor_invalid', `镜头 ${shot.id} 引用了未知或重复角色。`);
      if (shot.sourceRefs.some(id => !doc.source.entryRevisionIds.includes(id))) throw publicationError('publication_source_invalid', `镜头 ${shot.id} 的来源不在冻结章节中。`);
      if (new Set(shot.structuredPrompt.actors.map(a => a.actorId)).size !== shot.structuredPrompt.actors.length || shot.structuredPrompt.actors.some(a => !shot.actorIds.includes(a.actorId))) {
        throw publicationError('publication_prompt_actor_invalid', `镜头 ${shot.id} 的结构化提示词角色不匹配。`);
      }
      for (const u of shot.utterances) {
        unique(u.id, 'utterances');
        if (u.speakerActorId && !shot.actorIds.includes(u.speakerActorId)) throw publicationError('publication_speaker_invalid', `对白 ${u.id} 的发言人不在本镜头中。`);
      }
    }
  }
  create(projectId: string, revisionIds: string[]): PublicationDraft {
    const source = this.sourceBundle(projectId, revisionIds);
    const project = this.story.requireProject(projectId);
    const doc: PublicationDocument = { schemaVersion: 1, source: { storyProjectId: projectId, entryRevisionIds: revisionIds, sourceHash: source.sourceHash },
      title: project.title, synopsis: project.summary, orientation: 'portrait',
      actors: this.story.listCharacters(projectId).map(c => ({ id: c.id, name: c.name, universe: '',
        entryRevisionId: this.story.listEntryRevisions(projectId, 'character', c.id)[0]?.id ?? null,
        visualDescription: c.notes, characterId: c.sourceCharacterId, loras: [], referenceArtifactId: null, voiceBindingId: null })),
      shots: [], publishingCopy: { title: project.title, description: '', tags: [] } };
    this.validate(doc);
    return this.db.transaction(() => {
      const { activity } = new ActivityStore(this.db).createActivity({ title: project.title, type: 'publication', skipTransaction: true });
      this.db.connection.prepare('INSERT INTO publication_drafts VALUES (?,?,?,?,?)').run(activity.id, projectId, 1, JSON.stringify(doc), now());
      return this.requireDraft(activity.id);
    });
  }
  getDraft(activityId: string): PublicationDraft | null {
    const row = this.get('SELECT * FROM publication_drafts WHERE activity_id=?', activityId);
    return row ? { activityId, draftVersion: Number(row.draft_version), document: parse(row.document_json), updatedAt: String(row.updated_at) } : null;
  }
  requireDraft(id: string): PublicationDraft {
    const draft = this.getDraft(id);
    if (!draft) throw publicationError('publication_not_found', '制作作品不存在。', 404);
    return draft;
  }
  assertVersion(id: string, expected: number) {
    const draft = this.requireDraft(id);
    if (draft.draftVersion !== expected) throw Object.assign(publicationError('publication_draft_conflict', '制作内容已在其他窗口更新。本地输入保留，请检查服务器版本。', 409), { currentVersion: draft.draftVersion });
    return draft;
  }
  private imageIds(doc: PublicationDocument) { return doc.shots.flatMap(s => s.selectedImage ? [s.selectedImage.artifactId] : []); }
  private audioIds(doc: PublicationDocument) { return doc.shots.flatMap(s => s.utterances.flatMap(u => u.selectedAudioArtifactId ? [u.selectedAudioArtifactId] : [])); }
  artifact(id: string, kind: 'image' | 'audio' | 'video' | 'file'): Row & { path: string } {
    const row = this.get('SELECT * FROM artifacts WHERE id=? AND app_id=? AND media_type=? AND file_status=?', id, 'activities', kind === 'file' ? 'binary' : kind, 'ready');
    if (!row) throw publicationError('publication_artifact_missing', `产物 ${id} 不可读取。`, 409);
    const path = resolveArtifactStoragePath(this.db, id, this.artifactDirectory);
    if (!path || !existsSync(path)) throw publicationError('publication_artifact_missing', `产物 ${id} 不可读取。`, 409);
    return { ...row, path };
  }
  canSelect(activityId: string, id: string) {
    const allowed = this.get(`SELECT 1 FROM artifact_references WHERE artifact_id=? AND app_id='activities'
      AND ref_type IN ('publication_history','publication_upload','publication_draft','publication_revision')
      AND (ref_id=? OR substr(ref_id,1,length(?))=?)`, id, `publication:${activityId}`, `publication:${activityId}:`, `publication:${activityId}:`);
    if (!allowed) throw publicationError('publication_artifact_forbidden', '图片或音频不属于本制作作品。', 403);
  }
  reference(id: string, type: string, refId: string) { createArtifactReference(this.db, { artifactId: id, appId: 'activities', refType: type, refId }); }
  private draftRefs(activityId: string, doc: PublicationDocument) {
    const refId = `publication:${activityId}`;
    this.db.connection.prepare('DELETE FROM artifact_references WHERE app_id=? AND ref_type=? AND ref_id=?').run('activities', 'publication_draft', refId);
    for (const id of [...this.imageIds(doc), ...this.audioIds(doc), ...doc.actors.flatMap(a => a.referenceArtifactId ? [a.referenceArtifactId] : [])]) this.reference(id, 'publication_draft', refId);
  }
  save(id: string, expected: number, input: PublicationDocument): PublicationDraft {
    const current = this.assertVersion(id, expected);
    const doc = structuredClone(input);
    this.validate(doc, current.document.source.storyProjectId);
    if (fingerprint(doc.source) !== fingerprint(current.document.source)) throw publicationError('publication_source_changed', '制作来源已冻结；更换章节请创建另一份作品。', 409);
    for (const shot of doc.shots) {
      const previous = current.document.shots.find(s => s.id === shot.id);
      if (previous && shotFingerprint(current.document, shot.id) !== shotFingerprint(doc, shot.id) && shot.selectedImage?.artifactId === previous.selectedImage?.artifactId) shot.selectedImage = null;
      for (const u of shot.utterances) {
        const old = previous?.utterances.find(x => x.id === u.id);
        if (old && utteranceFingerprint(current.document, u.id) !== utteranceFingerprint(doc, u.id) && u.selectedAudioArtifactId === old.selectedAudioArtifactId) u.selectedAudioArtifactId = null;
      }
    }
    for (const artifactId of this.imageIds(doc)) { this.canSelect(id, artifactId); this.artifact(artifactId, 'image'); }
    for (const artifactId of this.audioIds(doc)) { this.canSelect(id, artifactId); this.artifact(artifactId, 'audio'); }
    for (const actor of doc.actors) if (actor.referenceArtifactId) { this.canSelect(id, actor.referenceArtifactId); this.artifact(actor.referenceArtifactId, 'image'); }
    for (const shot of doc.shots) if (shot.renderSettings.referenceAssetKey) { this.canSelect(id, shot.renderSettings.referenceAssetKey); this.artifact(shot.renderSettings.referenceAssetKey, 'image'); }
    return this.db.transaction(() => {
      const result = this.db.connection.prepare('UPDATE publication_drafts SET document_json=?,draft_version=draft_version+1,updated_at=? WHERE activity_id=? AND draft_version=?')
        .run(JSON.stringify(doc), now(), id, expected);
      if (result.changes !== 1) throw publicationError('publication_draft_conflict', '制作草稿版本冲突。', 409);
      this.draftRefs(id, doc);
      this.db.connection.prepare('UPDATE activities SET title=?,updated_at=? WHERE id=?').run(doc.title, now(), id);
      return this.requireDraft(id);
    });
  }
  revision(activityId: string, doc: PublicationDocument): string {
    const hash = fingerprint(doc);
    const existing = this.get('SELECT id FROM publication_revisions WHERE activity_id=? AND document_hash=?', activityId, hash);
    if (existing) return String(existing.id);
    const id = randomUUID();
    this.db.connection.prepare('INSERT INTO publication_revisions VALUES (?,?,?,?,?)').run(id, activityId, JSON.stringify(doc), hash, now());
    for (const asset of [...this.imageIds(doc), ...this.audioIds(doc), ...doc.actors.flatMap(a => a.referenceArtifactId ? [a.referenceArtifactId] : [])]) this.reference(asset, 'publication_revision', `publication:${activityId}:${id}`);
    return id;
  }
  revisionDocument(activityId: string, id: string): PublicationDocument {
    const row = this.get('SELECT document_json FROM publication_revisions WHERE activity_id=? AND id=?', activityId, id);
    if (!row) throw publicationError('publication_revision_missing', '制作版本不存在。', 404);
    return parse(row.document_json);
  }
  approve(activityId: string, input: PublicationApprovalRequest, config: unknown): PublicationApproval {
    const draft = this.assertVersion(activityId, input.expectedDraftVersion);
    if (draft.document.shots.length < 6 || draft.document.shots.length > 12) throw publicationError('publication_shot_count', '首版请准备 6–12 个关键镜头。');
    if (input.imageBudget < draft.document.shots.length || input.imageBudget > draft.document.shots.length + 3) throw publicationError('publication_budget_invalid', '图片额度须为镜头数到镜头数＋3。');
    return this.db.transaction(() => {
      this.assertVersion(activityId, input.expectedDraftVersion);
      const revisionId = this.revision(activityId, draft.document), id = randomUUID();
      this.db.connection.prepare('INSERT INTO publication_approvals VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, activityId, draft.draftVersion, revisionId, JSON.stringify(config), fingerprint(config), input.imageBudget, input.speechCharacterBudget, input.makeVideo ? 1 : 0, input.speechProfileId, now());
      return this.approval(activityId, id);
    });
  }
  approval(activityId: string, id: string): PublicationApproval {
    const row = this.get(`SELECT a.*,r.document_hash FROM publication_approvals a JOIN publication_revisions r ON r.id=a.revision_id WHERE a.id=? AND a.activity_id=?`, id, activityId);
    if (!row) throw publicationError('publication_approval_missing', '人工确认记录不存在。', 404);
    return { id, activityId, draftVersion: Number(row.draft_version), revisionId: String(row.revision_id), documentHash: String(row.document_hash),
      configHash: String(row.config_hash), imageBudget: Number(row.image_budget), speechCharacterBudget: Number(row.speech_budget),
      makeVideo: Boolean(row.make_video), speechProfileId: row.speech_profile_id ? String(row.speech_profile_id) : null, createdAt: String(row.created_at) };
  }
  approvedConfig<T>(approvalId: string): T { const row = this.get('SELECT config_json FROM publication_approvals WHERE id=?', approvalId); if (!row) throw publicationError('publication_approval_missing', '确认记录不存在。', 404); return parse(row.config_json); }
  latestApproval(activityId:string):PublicationApproval|null { const row=this.get('SELECT id FROM publication_approvals WHERE activity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',activityId);return row?this.approval(activityId,String(row.id)):null; }
  createRun(activityId: string, approvalId: string, key: string): PublicationRun {
    return this.db.transaction(() => {
      const hash = fingerprint({ approvalId });
      const sameKey = this.get('SELECT * FROM publication_runs WHERE activity_id=? AND idempotency_key=?', activityId, key);
      if (sameKey) { if (sameKey.request_hash !== hash) throw publicationError('publication_idempotency_conflict', '同一个提交键对应不同内容。', 409); return this.run(activityId, String(sameKey.id)); }
      const approval = this.approval(activityId, approvalId), doc = this.revisionDocument(activityId, approval.revisionId);
      const draft = this.requireDraft(activityId);
      if (contentFingerprint(doc) !== contentFingerprint(draft.document)) throw publicationError('publication_approval_stale', '方案已改变，请重新人工确认。', 409);
      const existing = this.get('SELECT id FROM publication_runs WHERE approval_id=?', approvalId);
      if (existing) return this.run(activityId, String(existing.id));
      const id = randomUUID(), time = now();
      this.db.connection.prepare('INSERT INTO publication_runs VALUES (?,?,?,?,?,?,0,0,?,?)').run(id, activityId, approvalId, 'queued', key, hash, time, time);
      return this.run(activityId, id);
    });
  }
  run(activityId: string, id: string): PublicationRun {
    const row = this.get('SELECT * FROM publication_runs WHERE activity_id=? AND id=?', activityId, id);
    if (!row) throw publicationError('publication_run_missing', '制作任务不存在。', 404);
    return { id, activityId, approvalId: String(row.approval_id), status: row.status as PublicationRun['status'], imagesUsed: Number(row.images_used),
      speechCharactersUsed: Number(row.speech_used), tasks: this.all('SELECT * FROM publication_tasks WHERE run_id=? ORDER BY created_at,rowid', id).map(row => this.taskRow(row)), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
  listRuns(activityId: string) { this.requireDraft(activityId); return this.all('SELECT id FROM publication_runs WHERE activity_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50', activityId).map(row => this.run(activityId, String(row.id))); }
  private taskRow(row: Row): PublicationTask {
    return { id: String(row.id), runId: String(row.run_id), kind: row.kind as PublicationTask['kind'], targetId: String(row.target_id), status: row.status as PublicationTask['status'],
      generationTaskId: row.generation_task_id ? String(row.generation_task_id) : null, callId: row.call_id ? String(row.call_id) : null,
      artifactIds: parse(row.output_json), error: row.error ? String(row.error) : null, inputHash: String(row.input_hash), updatedAt: String(row.updated_at) };
  }
  task(id: string): PublicationTask { const row = this.get('SELECT * FROM publication_tasks WHERE id=?', id); if (!row) throw publicationError('publication_task_missing', '子任务不存在。', 404); return this.taskRow(row); }
  taskInput<T>(id: string): T { return parse(this.get('SELECT input_json FROM publication_tasks WHERE id=?', id)?.input_json); }
  createTask(runId: string, kind: PublicationTask['kind'], targetId: string, input: unknown, key: string): PublicationTask {
    const hash = fingerprint(input), existing = this.get('SELECT * FROM publication_tasks WHERE run_id=? AND idempotency_key=?', runId, key);
    if (existing) { if (existing.input_hash !== hash) throw publicationError('publication_idempotency_conflict', '子任务重复键与内容不一致。', 409); return this.taskRow(existing); }
    const id = randomUUID(), time = now();
    this.db.connection.prepare(`INSERT INTO publication_tasks (id,run_id,kind,target_id,status,input_hash,input_json,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, runId, kind, targetId, 'queued', hash, JSON.stringify(input), key, time, time);
    return this.task(id);
  }
  claim(id: string): boolean { return this.db.connection.prepare("UPDATE publication_tasks SET status='preparing',updated_at=? WHERE id=? AND status='queued'").run(now(), id).changes === 1; }
  reserve(taskId: string, amount: number) {
    return this.db.transaction(() => {
      const task = this.task(taskId);
      if (task.status !== 'preparing') throw publicationError('publication_task_not_claimed', '任务未取得执行资格。', 409);
      const row = this.get('SELECT r.*,a.image_budget,a.speech_budget FROM publication_runs r JOIN publication_approvals a ON a.id=r.approval_id WHERE r.id=?', task.runId)!;
      if (row.status === 'stopped') throw publicationError('publication_stopped', '制作已停止。', 409);
      const image = task.kind === 'image', used = Number(image ? row.images_used : row.speech_used), budget = Number(image ? row.image_budget : row.speech_budget);
      if (used + amount > budget) throw publicationError('publication_budget_exceeded', image ? '图片额度已用完，请重新确认额外额度。' : '配音字数额度已用完。', 409);
      this.db.connection.prepare(`UPDATE publication_runs SET ${image ? 'images_used' : 'speech_used'}=?,updated_at=? WHERE id=?`).run(used + amount, now(), task.runId);
      this.updateTask(taskId, { status: 'running' });
    });
  }
  updateTask(id: string, patch: Partial<Pick<PublicationTask, 'status' | 'generationTaskId' | 'callId' | 'error' | 'artifactIds'>>) {
    const task = { ...this.task(id), ...patch };
    this.db.connection.prepare('UPDATE publication_tasks SET status=?,generation_task_id=?,call_id=?,error=?,output_json=?,updated_at=? WHERE id=?')
      .run(task.status, task.generationTaskId, task.callId, task.error, JSON.stringify(task.artifactIds), now(), id);
  }
  updateRun(id: string, status: PublicationRun['status']) { this.db.connection.prepare('UPDATE publication_runs SET status=?,updated_at=? WHERE id=?').run(status, now(), id); }
  taskHistory(id: string, assets: string[]) {
    const task = this.task(id), row = this.get('SELECT activity_id FROM publication_runs WHERE id=?', task.runId)!;
    for (const asset of assets) this.reference(asset, 'publication_history', `publication:${row.activity_id}:${id}`);
    this.updateTask(id, { artifactIds: assets, status: 'succeeded', error: null });
  }
  history(activityId: string, shotId: string): PublicationHistory {
    const current = this.requireDraft(activityId).document.shots.find(s => s.id === shotId);
    const rows = this.all(`SELECT t.* FROM publication_tasks t JOIN publication_runs r ON t.run_id=r.id
      WHERE r.activity_id=? AND t.kind='image' AND t.target_id=? ORDER BY t.created_at DESC LIMIT 100`, activityId, shotId);
    return { items: rows.flatMap(row => parse<string[]>(row.output_json).map(artifactId => {
      let available = false;
      try { this.artifact(artifactId, 'image'); available = true; } catch { /* Preserve unavailable history without offering selection. */ }
      return { artifactId, taskId: String(row.id), shotId, available, current: artifactId === current?.selectedImage?.artifactId,
        callId: row.call_id ? String(row.call_id) : null, createdAt: String(row.created_at) };
    })) };
  }
  selectImage(activityId: string, expected: number, shotId: string, artifactId: string, allowStale = false): PublicationDraft {
    const draft = this.assertVersion(activityId, expected), doc = structuredClone(draft.document), shot = doc.shots.find(s => s.id === shotId);
    if (!shot) throw publicationError('publication_shot_missing', '关键镜头已删除。', 404);
    this.canSelect(activityId, artifactId); this.artifact(artifactId, 'image');
    if (shot.selectedImage?.artifactId === artifactId) return draft;
    const item = this.history(activityId, shotId).items.find(i => i.artifactId === artifactId);
    if (!item) throw publicationError('publication_artifact_forbidden', '图片不属于此镜头历史。', 403);
    const input = this.taskInput<{ sourceFingerprint: string }>(item.taskId);
    if (input.sourceFingerprint !== shotFingerprint(doc, shotId) && !allowStale) throw publicationError('publication_source_changed', '镜头描述已变化，请确认使用旧描述图片。', 409);
    shot.selectedImage = { artifactId, renderTaskId: item.taskId };
    return this.save(activityId, expected, doc);
  }
  selectAudio(activityId: string, expected: number, utteranceId: string, artifactId: string): PublicationDraft {
    const draft = this.assertVersion(activityId, expected), doc = structuredClone(draft.document), u = doc.shots.flatMap(s => s.utterances).find(u => u.id === utteranceId);
    if (!u) throw publicationError('publication_utterance_missing', '对白已删除。', 404);
    this.canSelect(activityId, artifactId);
    const asset = this.artifact(artifactId, 'audio');
    if (Number(asset.duration_ms) <= 0 || !Number.isFinite(Number(asset.duration_ms))) throw publicationError('publication_audio_invalid', '音频缺少可验证的实际时长。');
    if (u.selectedAudioArtifactId === artifactId) return draft;
    u.selectedAudioArtifactId = artifactId;
    return this.save(activityId, expected, doc);
  }
  audioHistory(activityId:string,utteranceId:string):import('@sthstart/contracts').PublicationAudioHistory {
    const doc=this.requireDraft(activityId).document,u=doc.shots.flatMap(s=>s.utterances).find(u=>u.id===utteranceId);
    if(!u) throw publicationError('publication_utterance_missing','对白不存在。',404);
    const taskRows=this.all(`SELECT t.* FROM publication_tasks t JOIN publication_runs r ON t.run_id=r.id WHERE r.activity_id=? AND t.kind='speech' AND t.target_id=? ORDER BY t.created_at DESC,t.rowid DESC`,activityId,utteranceId);
    const candidates=taskRows.flatMap(row=>parse<string[]>(row.output_json).map(id=>({id,callId:row.call_id?String(row.call_id):null,source:parse<{sourceFingerprint?:string}>(row.input_json).sourceFingerprint})));
    for(const row of this.all(`SELECT a.id,a.metadata_json FROM artifacts a JOIN artifact_references r ON a.id=r.artifact_id WHERE r.ref_type='publication_upload' AND r.ref_id=? ORDER BY a.created_at DESC`,`publication:${activityId}:${utteranceId}`)) {
      candidates.push({id:String(row.id),callId:null,source:parse<{sourceFingerprint?:string}>(row.metadata_json).sourceFingerprint});
    }
    return {items:[...new Map(candidates.map(c=>[c.id,c])).values()].map(c=>{
      const row=this.get('SELECT duration_ms,created_at,file_status FROM artifacts WHERE id=?',c.id),path=resolveArtifactStoragePath(this.db,c.id,this.artifactDirectory);
      return {artifactId:c.id,available:Boolean(path&&existsSync(path)&&row?.file_status==='ready'),current:c.id===u.selectedAudioArtifactId,staleSource:c.source!==utteranceFingerprint(doc,u.id),durationMs:Number(row?.duration_ms??0),createdAt:String(row?.created_at??now()),callId:c.callId};
    })};
  }
  grant(projectId: string) {
    this.story.requireProject(projectId);
    const token = `pub_${Buffer.from(randomBytes(32)).toString('hex')}`;
    this.db.connection.prepare('INSERT INTO publication_bridge_grants VALUES (?,?,?,NULL) ON CONFLICT(project_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,last_used_at=NULL')
      .run(projectId, createHash('sha256').update(token).digest('hex'), now());
    return { projectId, token };
  }
  grantStatus(projectId: string) { this.story.requireProject(projectId); const row = this.get('SELECT last_used_at FROM publication_bridge_grants WHERE project_id=?', projectId); return { paired: Boolean(row), lastUsedAt: row?.last_used_at ? String(row.last_used_at) : null }; }
  revoke(projectId: string) { this.db.connection.prepare('DELETE FROM publication_bridge_grants WHERE project_id=?').run(projectId); }
  authorize(projectId: string, token: string) {
    const row = this.get('SELECT token_hash FROM publication_bridge_grants WHERE project_id=?', projectId);
    const hash = createHash('sha256').update(token).digest(), expected = Buffer.from(String(row?.token_hash ?? '0'.repeat(64)), 'hex');
    const ok = timingSafeEqual(hash, expected) && Boolean(row);
    if (ok) this.db.connection.prepare('UPDATE publication_bridge_grants SET last_used_at=? WHERE project_id=?').run(now(), projectId);
    return ok;
  }
  speechProfiles(): SpeechProfile[] { return this.all('SELECT profile_json FROM publication_speech_profiles').map(r => parse(r.profile_json)); }
  speechProfile(id: string): SpeechProfile { const p = this.speechProfiles().find(p => p.id === id); if (!p) throw publicationError('publication_speech_missing', '请选择独立配音配置。', 409); return p; }
  saveSpeechProfile(expected: number, profile: SpeechProfile): SpeechProfile {
    if (!Value.Check(SpeechProfileSchema, profile)) throw publicationError('publication_speech_invalid', '配音配置格式错误。');
    const url = new URL(profile.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !profile.voices.includes(profile.defaultVoice)) throw publicationError('publication_speech_invalid', '配音地址或默认声音无效。');
    return this.db.transaction(() => {
      const previous = this.get('SELECT revision FROM publication_speech_profiles WHERE id=?', profile.id);
      if (Number(previous?.revision ?? 0) !== expected) throw publicationError('publication_speech_conflict', '配音配置已改变。', 409);
      const value = { ...profile, revision: expected + 1 };
      this.db.connection.prepare('INSERT INTO publication_speech_profiles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,profile_json=excluded.profile_json').run(value.id, value.revision, JSON.stringify(value));
      return value;
    });
  }
}
