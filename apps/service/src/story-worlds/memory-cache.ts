import type { ServiceDatabase } from '../database.js';
import type { WorldEvent, WorldMemory } from '@sthstart/contracts';

interface History { tick: number; eventSequence: number; memorySequence: number; events: WorldEvent[]; memories: WorldMemory[] }
/** Immutable event/memory rows are append-only within a branch. Forks use distinct
 * branch IDs, and a backwards clock invalidates the cache. Rowid is only a read
 * cursor, never a domain ID. Bounded to sixteen recently simulated branches. */
export class WorldHistoryCache {
  private readonly branches = new Map<string, History>();
  private metrics = { eventRowsRead: 0, memoryRowsRead: 0, incrementalReads: 0, fullReads: 0 };
  constructor(private readonly database: ServiceDatabase, private readonly capacity = 16) {}
  read(worldId: string, branchId: string, tick: number): { events: WorldEvent[]; memories: WorldMemory[] } {
    const key = JSON.stringify([worldId, branchId]);
    let history = this.branches.get(key);
    if (!history || tick < history.tick) {
      history = { tick, eventSequence: 0, memorySequence: 0, events: [], memories: [] }; this.metrics.fullReads++;
    } else { this.metrics.incrementalReads++; }
    const events = this.database.connection.prepare('SELECT rowid AS sequence,data_json FROM sw_events WHERE world_id=? AND branch_id=? AND rowid>? AND tick<=? ORDER BY rowid')
      .all(worldId, branchId, history.eventSequence, tick) as { sequence: number; data_json: string }[];
    const memories = this.database.connection.prepare('SELECT rowid AS sequence,data_json FROM sw_memories WHERE world_id=? AND branch_id=? AND rowid>? AND learned_at<=? ORDER BY rowid')
      .all(worldId, branchId, history.memorySequence, tick) as { sequence: number; data_json: string }[];
    this.metrics.eventRowsRead += events.length; this.metrics.memoryRowsRead += memories.length;
    history.events.push(...events.map((row) => JSON.parse(row.data_json) as WorldEvent));
    history.memories.push(...memories.map((row) => JSON.parse(row.data_json) as WorldMemory));
    if (events.length) history.eventSequence = events[events.length - 1].sequence;
    if (memories.length) history.memorySequence = memories[memories.length - 1].sequence;
    history.tick = tick; history.events.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    this.branches.delete(key); this.branches.set(key, history);
    if (this.branches.size > this.capacity) this.branches.delete(this.branches.keys().next().value!);
    return { events: structuredClone(history.events), memories: structuredClone(history.memories) };
  }
  stats() { return { ...this.metrics, branches: this.branches.size }; }
  clear() { this.branches.clear(); }
}
