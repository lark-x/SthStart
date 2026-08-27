import { EventEmitter } from 'node:events';
import type { GenerationEvent } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

export const generationEventBus = new EventEmitter();
export const activeGenerationExecutions = new Set<Promise<void>>();
const stoppedDatabases = new WeakSet<ServiceDatabase>();

export function resumeGenerationExecutions(database: ServiceDatabase) {
  stoppedDatabases.delete(database);
}

export function stopGenerationExecutions(database: ServiceDatabase) {
  stoppedDatabases.add(database);
}

export function generationExecutionsStopped(database: ServiceDatabase) {
  return stoppedDatabases.has(database);
}

export function recordGenerationEvent(
  database: ServiceDatabase,
  input: { taskId: string; appId: string; eventType: string; payload: Record<string, unknown> },
): GenerationEvent {
  const now = nowIso();
  const result = database.connection.prepare(
    'INSERT INTO generation_events(task_id, app_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(input.taskId, input.appId, input.eventType, JSON.stringify(input.payload), now);
  const event: GenerationEvent = {
    id: Number(result.lastInsertRowid), taskId: input.taskId, appId: input.appId,
    eventType: input.eventType, payload: input.payload, createdAt: now,
  };
  generationEventBus.emit(`event:${input.appId}`, event);
  return event;
}

export function subscribeGenerationEvents(
  database: ServiceDatabase,
  appId: string,
  listener: (event: GenerationEvent) => void,
  afterId?: number | null,
): () => void {
  const seenIds = new Set<number>();
  const handler = (event: GenerationEvent) => {
    if (!seenIds.has(event.id)) { seenIds.add(event.id); listener(event); }
  };
  generationEventBus.on(`event:${appId}`, handler);
  if (afterId != null && Number.isFinite(afterId)) {
    const rows = database.connection.prepare(
      'SELECT * FROM generation_events WHERE app_id = ? AND id > ? ORDER BY id ASC',
    ).all(appId, afterId) as Array<{ id: number; task_id: string; app_id: string; event_type: string; payload_json: string; created_at: string }>;
    for (const row of rows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      listener({ id: row.id, taskId: row.task_id, appId: row.app_id, eventType: row.event_type, payload: JSON.parse(row.payload_json), createdAt: row.created_at });
    }
  }
  return () => generationEventBus.off(`event:${appId}`, handler);
}
