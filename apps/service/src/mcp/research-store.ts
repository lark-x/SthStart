import crypto from 'node:crypto';
import type { PlanningSelectionState, ResearchCharacterCandidate, ResearchEvidence, ResearchLocationCandidate, ResearchTask } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseInputSnapshot(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export class ResearchStore {
  constructor(private readonly database: ServiceDatabase) {}

  createTask(input: {
    sessionId: string;
    inputSnapshot: Record<string, unknown>;
    budgetToolCalls?: number;
  }): ResearchTask {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.database.connection.prepare(`INSERT INTO planning_research_tasks
      (id,session_id,status,input_snapshot_json,progress_label,used_tool_calls,budget_tool_calls,incomplete_reason,error_message,evidence_json,character_candidates_json,location_candidates_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.sessionId, 'queued', JSON.stringify(input.inputSnapshot), '等待开始', 0, input.budgetToolCalls ?? 12, null, null, '[]', '[]', '[]', now, now);
    return this.getTask(id)!;
  }

  getTask(id: string): ResearchTask | null {
    const row = this.database.connection.prepare('SELECT * FROM planning_research_tasks WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      status: String(row.status) as ResearchTask['status'],
      inputSnapshot: parseInputSnapshot(String(row.input_snapshot_json ?? '{}')),
      progressLabel: row.progress_label ? String(row.progress_label) : undefined,
      usedToolCalls: Number(row.used_tool_calls ?? 0),
      budgetToolCalls: Number(row.budget_tool_calls ?? 12),
      incompleteReason: row.incomplete_reason ? String(row.incomplete_reason) : undefined,
      errorMessage: row.error_message ? String(row.error_message) : undefined,
      evidence: parseJsonArray<ResearchEvidence>(String(row.evidence_json ?? '[]')),
      characterCandidates: parseJsonArray<ResearchCharacterCandidate>(String(row.character_candidates_json ?? '[]')),
      locationCandidates: parseJsonArray<ResearchLocationCandidate>(String(row.location_candidates_json ?? '[]')),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  listTasks(sessionId: string, limit = 20): ResearchTask[] {
    const rows = this.database.connection.prepare('SELECT * FROM planning_research_tasks WHERE session_id=? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit) as Record<string, unknown>[];
    return rows.map((row) => this.getTask(String(row.id))!).filter(Boolean);
  }

  updateTask(id: string, patch: Partial<{
    status: ResearchTask['status'];
    progressLabel: string | null;
    usedToolCalls: number;
    incompleteReason: string | null;
    errorMessage: string | null;
    evidence: ResearchEvidence[];
    characterCandidates: ResearchCharacterCandidate[];
    locationCandidates: ResearchLocationCandidate[];
  }>) {
    if (this.getTask(id)?.status === 'cancelled') return;
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number | null)[] = [nowIso()];
    const map: Record<string, string> = {
      status: 'status',
      progressLabel: 'progress_label',
      usedToolCalls: 'used_tool_calls',
      incompleteReason: 'incomplete_reason',
      errorMessage: 'error_message',
      evidence: 'evidence_json',
      characterCandidates: 'character_candidates_json',
      locationCandidates: 'location_candidates_json',
    };
    for (const [key, column] of Object.entries(map)) {
      const value = patch[key as keyof typeof patch];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(typeof value === 'string' || typeof value === 'number' || value === null ? value as string | number | null : JSON.stringify(value));
    }
    params.push(id);
    this.database.connection.prepare(`UPDATE planning_research_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  createRevision(input: { sessionId: string; taskId: string; version: number; inputSnapshot: Record<string, unknown> }): string {
    const id = crypto.randomUUID();
    this.database.connection.prepare(`INSERT INTO planning_research_revisions
      (id,session_id,task_id,version,input_snapshot_json,frozen,created_at) VALUES (?,?,?,?,?,1,?)`)
      .run(id, input.sessionId, input.taskId, input.version, JSON.stringify({ ...input.inputSnapshot, resultSnapshot: this.getTask(input.taskId) }), nowIso());
    return id;
  }

  getRevision(id: string): { id: string; sessionId: string; taskId: string; version: number; inputSnapshot: Record<string, unknown>; frozen: boolean; taskSnapshot?: ResearchTask } | null {
    const row = this.database.connection.prepare('SELECT * FROM planning_research_revisions WHERE id=?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      taskId: String(row.task_id),
      version: Number(row.version),
      inputSnapshot: parseInputSnapshot(String(row.input_snapshot_json ?? '{}')),
      frozen: Boolean(row.frozen),
      taskSnapshot: parseInputSnapshot(String(row.input_snapshot_json)).resultSnapshot as ResearchTask | undefined,
    };
  }

  setSessionResearchRevision(sessionId: string, revisionId: string) {
    this.database.connection.prepare('UPDATE activity_planning_sessions SET research_revision_id=?,updated_at=? WHERE id=?').run(revisionId, nowIso(), sessionId);
  }

  /** 读取企划会话保存的候选选择（与 form_json.selection 一致）。 */
  readSelection(sessionId: string): PlanningSelectionState | null {
    const row = this.database.connection.prepare('SELECT form_json FROM activity_planning_sessions WHERE id=?').get(sessionId) as { form_json?: string } | undefined;
    if (!row?.form_json) return null;
    try {
      const form = JSON.parse(String(row.form_json)) as Record<string, unknown>;
      const selection = form.selection;
      return selection && typeof selection === 'object' ? selection as unknown as PlanningSelectionState : null;
    } catch {
      return null;
    }
  }

  /** 把候选选择写回企划会话 form_json（只保存用户约束，不重建文档）。 */
  writeSelection(sessionId: string, selection: PlanningSelectionState) {
    const row = this.database.connection.prepare('SELECT form_json FROM activity_planning_sessions WHERE id=?').get(sessionId) as { form_json?: string } | undefined;
    const form = row?.form_json ? (JSON.parse(String(row.form_json)) as Record<string, unknown>) : {};
    form.selection = selection;
    this.database.connection.prepare('UPDATE activity_planning_sessions SET form_json=?,updated_at=?,version=version+1 WHERE id=? AND form_json<>?').run(JSON.stringify(form), nowIso(), sessionId, JSON.stringify(form));
  }

  /**
   * 按当前候选状态重算选择状态。
   * 待解析角色的移除/匹配会改变候选的采用状态，选择必须跟着更新，
   * 否则重新生成方案时已被移除的候选会再次出现。
   */
  buildSelectionFromTask(task: ResearchTask): PlanningSelectionState {
    return {
      requiredCharacterIds: task.characterCandidates.filter((item) => item.userStatus === 'required').map((item) => item.id),
      optionalCharacterIds: task.characterCandidates.filter((item) => item.userStatus === 'optional').map((item) => item.id),
      excludedCharacterIds: task.characterCandidates.filter((item) => item.userStatus === 'excluded').map((item) => item.id),
      requiredLocationIds: task.locationCandidates.filter((item) => item.userStatus === 'required').map((item) => item.id),
      optionalLocationIds: task.locationCandidates.filter((item) => item.userStatus === 'optional').map((item) => item.id),
      excludedLocationIds: task.locationCandidates.filter((item) => item.userStatus === 'excluded').map((item) => item.id),
      lockedLocationId: task.locationCandidates.find((item) => item.locked)?.id ?? null,
    };
  }

  setCandidateStatus(taskId: string, candidateId: string, status: ResearchCharacterCandidate['userStatus']): ResearchTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (!task.characterCandidates.some((item) => item.id === candidateId)) return task;
    this.updateTask(taskId, {
      characterCandidates: task.characterCandidates.map((item) => (item.id === candidateId ? { ...item, userStatus: status } : item)),
    });
    const updated = this.getTask(taskId)!;
    this.writeSelection(task.sessionId, this.buildSelectionFromTask(updated));
    return updated;
  }

  recoverDanglingTasks(): number {
    const result = this.database.connection.prepare(
      "UPDATE planning_research_tasks SET status='failed', error_message='server_restarted_result_unknown', updated_at=? WHERE status IN ('running','queued')"
    ).run(nowIso());
    return Number(result.changes);
  }
}
