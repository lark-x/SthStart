import type { DatabaseSync } from 'node:sqlite';
import type { ContentDocument } from '@sthstart/contracts';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 排期是纯日期（YYYY-MM-DD），不做时区换算；非法或缺失一律视为未排期。 */
export function normalizeScheduledDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = DATE_PATTERN.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) return null;
  return trimmed;
}

export function normalizeBirthdayActorIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim()))].slice(0, 50) : [];
}

const UPSERT_SCHEDULE = 'UPDATE activities SET scheduled_date=? WHERE id=?';
const DELETE_ACTORS = 'DELETE FROM activity_actor_characters WHERE activity_id=?';
const INSERT_ACTOR = 'INSERT OR REPLACE INTO activity_actor_characters(activity_id,actor_id,source_character_id) VALUES (?,?,?)';

/**
 * 活动排期与参与者投影：始终由内容文档推导，提交版本或创建活动时同步，可以随时重建。
 */
export function syncActivitySchedule(connection: DatabaseSync, activityId: string, document: ContentDocument) {
  const scheduledDate = normalizeScheduledDate(document?.activity?.scheduledDate);
  connection.prepare(UPSERT_SCHEDULE).run(scheduledDate, activityId);
  connection.prepare(DELETE_ACTORS).run(activityId);
  const insert = connection.prepare(INSERT_ACTOR);
  for (const actor of document?.actors || []) {
    if (!actor?.sourceCharacterId) continue;
    insert.run(activityId, String(actor.id), String(actor.sourceCharacterId));
  }
  return scheduledDate;
}

export function rebuildActivitySchedules(connection: DatabaseSync): number {
  const rows = connection.prepare(
    `SELECT a.id, r.document_json FROM activities a
     JOIN activity_content_revisions r ON r.id = a.current_content_revision_id`
  ).all() as { id: string; document_json: string }[];
  for (const row of rows) {
    try {
      syncActivitySchedule(connection, String(row.id), JSON.parse(String(row.document_json)) as ContentDocument);
    } catch { /* 历史文档损坏时保持未排期，不影响其他活动 */ }
  }
  return rows.length;
}

export function clearActivitySchedule(connection: DatabaseSync, activityId: string) {
  connection.prepare(DELETE_ACTORS).run(activityId);
  connection.prepare(UPSERT_SCHEDULE).run(null, activityId);
}
