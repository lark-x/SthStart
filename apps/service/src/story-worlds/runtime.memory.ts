import { createHash } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import { personalContext, type WorldSimulationSnapshot } from './simulation.js';
import type { WorldPersonalContext } from './memory.js';

export const memorySummaryLimits = { facts: 24, memories: 12, beliefs: 8, characters: 10000, lifetimeTicks: 120 } as const;
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Content, not event IDs, determines whether an already-known routine result
 * taught the actor something new. Provenance is still retained in every entry. */
export function knowledgeFingerprint(context: WorldPersonalContext): string {
  return fingerprint({ facts: [...new Set(context.facts.map((f) => f.content))].sort(),
    beliefs: [...new Set(context.beliefs.map((m) => JSON.stringify([m.kind, m.content])))].sort() });
}
export interface PersonalMemorySummary {
  worldId: string; branchId: string; actorId: string; atTick: number; validUntil: number;
  facts: WorldPersonalContext['facts']; memories: WorldPersonalContext['memories']; beliefs: WorldPersonalContext['beliefs'];
  omittedFacts: number; omittedMemories: number; omittedBeliefs: number;
}
/** An extractive, bounded personal digest. No model summarizer can invent a
 * fact, upgrade a belief, or read omniscient event prose. Revalidated on reuse. */
export class WorldMemorySummaries {
  constructor(private readonly database: ServiceDatabase) {}
  read(snapshot: WorldSimulationSnapshot, actorId: string): PersonalMemorySummary {
    const context = personalContext(snapshot, actorId);
    const unique = <T>(entries: T[], key: (entry: T) => string) => [...new Map(entries.map((entry) => [key(entry), entry])).values()];
    // Repeated, already-known routine facts do not require rebuilding the same
    // digest. Keep the earliest legal provenance for each distinct meaning.
    const facts = unique([...context.facts].sort((a, b) => b.tick - a.tick || b.id.localeCompare(a.id)), (f) => f.content);
    const rankedUnique = <T extends { kind: string; content: string; learnedAt: number; id: string }>(entries: T[]) => {
      const key = (entry: T) => JSON.stringify([entry.kind, entry.content]);
      const priority = new Map(entries.map((entry, index) => [key(entry), index] as const).reverse());
      return unique([...entries].sort((a, b) => b.learnedAt - a.learnedAt || b.id.localeCompare(a.id)), key)
        .sort((a, b) => priority.get(key(a))! - priority.get(key(b))!);
    };
    const memories = rankedUnique(context.memories); const beliefs = rankedUnique(context.beliefs);
    const key = fingerprint({ actor: context.actor, state: { ...context.state, updatedTick: 0 }, facts, memories, beliefs });
    const row = this.database.connection.prepare('SELECT * FROM sw_memory_summaries WHERE world_id=? AND branch_id=? AND actor_id=?')
      .get(snapshot.worldId, snapshot.branch.id, actorId) as { fingerprint: string; at_tick: number; valid_until: number; data_json: string } | undefined;
    if (row && row.fingerprint === key && row.at_tick <= context.tick && row.valid_until >= snapshot.toTick) {
      let saved: PersonalMemorySummary | undefined;
      try { saved = JSON.parse(row.data_json) as PersonalMemorySummary; } catch { /* Rebuild a corrupt cache from authorized context. */ }
      // Reject tampered/stale stored content even when its fingerprint matches.
      const legal = (entries: unknown[], allowed: unknown[]) => entries.every((entry) => allowed.some((value) => JSON.stringify(entry) === JSON.stringify(value)));
      if (saved && Array.isArray(saved.facts) && Array.isArray(saved.memories) && Array.isArray(saved.beliefs)
        && saved.worldId === snapshot.worldId && saved.branchId === snapshot.branch.id && saved.actorId === actorId
        && saved.atTick === row.at_tick && saved.validUntil === row.valid_until
        && saved.facts.length <= memorySummaryLimits.facts && saved.memories.length <= memorySummaryLimits.memories
        && saved.beliefs.length <= memorySummaryLimits.beliefs && JSON.stringify(saved).length <= memorySummaryLimits.characters
        && legal(saved.facts, context.facts) && legal(saved.memories, context.memories) && legal(saved.beliefs, context.beliefs)) {
        this.database.connection.prepare('UPDATE sw_memory_summaries SET reuse_count=reuse_count+1 WHERE branch_id=? AND actor_id=?').run(snapshot.branch.id, actorId);
        return structuredClone(saved);
      }
    }
    const summary: PersonalMemorySummary = { worldId: snapshot.worldId, branchId: snapshot.branch.id, actorId, atTick: context.tick,
      validUntil: context.tick + memorySummaryLimits.lifetimeTicks, facts: [], memories: [], beliefs: [],
      omittedFacts: facts.length, omittedMemories: memories.length, omittedBeliefs: beliefs.length };
    let size = JSON.stringify(summary).length;
    const append = <T>(target: T[], value: T) => { const length = JSON.stringify(value).length + 1; if (size + length > memorySummaryLimits.characters) return; target.push(structuredClone(value)); size += length; };
    // Retain high-ranked evidence first, then recent facts, while preserving the
    // original text/IDs/knowledge times. Omitted history is explicitly unknown.
    for (const memory of memories.slice(0, memorySummaryLimits.memories)) append(summary.memories, memory);
    for (const belief of beliefs.slice(0, memorySummaryLimits.beliefs)) append(summary.beliefs, belief);
    const referenced = new Set([...summary.memories, ...summary.beliefs].map((m) => m.sourceEventId));
    const ranked = [...facts].sort((a, b) => Number(referenced.has(b.eventId)) - Number(referenced.has(a.eventId)) || b.tick - a.tick || a.id.localeCompare(b.id));
    for (const fact of ranked.slice(0, memorySummaryLimits.facts)) append(summary.facts, fact);
    summary.omittedFacts -= summary.facts.length; summary.omittedMemories -= summary.memories.length; summary.omittedBeliefs -= summary.beliefs.length;
    this.database.connection.prepare(`INSERT INTO sw_memory_summaries(world_id,branch_id,actor_id,at_tick,valid_until,fingerprint,data_json) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(branch_id,actor_id) DO UPDATE SET world_id=excluded.world_id,at_tick=excluded.at_tick,valid_until=excluded.valid_until,
      fingerprint=excluded.fingerprint,data_json=excluded.data_json,rebuilds=sw_memory_summaries.rebuilds+1`)
      .run(snapshot.worldId, snapshot.branch.id, actorId, summary.atTick, summary.validUntil, key, JSON.stringify(summary));
    return summary;
  }
  context(snapshot: WorldSimulationSnapshot, actorId: string) {
    const { clock: _uncheckedClock, ...original } = personalContext(snapshot, actorId) as WorldPersonalContext & { clock?: { day: number; minuteOfDay: number } };
    const summary = this.read(snapshot, actorId);
    const candidate = _uncheckedClock;
    const clock = candidate && Number.isInteger(candidate.day) && candidate.day >= 0 && Number.isInteger(candidate.minuteOfDay)
      && candidate.minuteOfDay >= 0 && candidate.minuteOfDay < 1440 ? { day: candidate.day, minuteOfDay: candidate.minuteOfDay } : undefined;
    return { ...original, facts: summary.facts, memories: summary.memories, beliefs: summary.beliefs, memorySummary: summary,
      ...(clock ? { clock } : {}),
      time: { relativeMinute: snapshot.branch.currentTick, untilRelativeMinute: snapshot.toTick, spanMinutes: snapshot.toTick - snapshot.branch.currentTick,
        localMinuteOfDay: clock?.minuteOfDay ?? null, dayNightDefined: Boolean(clock) } };
  }
}
