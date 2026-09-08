import type { ContentDocument } from '@sthstart/contracts';

/** Validate model output before it can be labelled valid or used as subsequent context. */
export function validateGeneratedOutput(output: unknown, document: ContentDocument, mode: string, stageId?: string): void {
  const fail = (message: string): never => { throw new Error(`invalid_ai_output: ${message}`); };
  const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : fail('expected object');
  const data = object(output);
  if (data.schemaVersion !== 1) fail('schemaVersion must be 1');
  const rows = (key: string): Record<string, any>[] => Array.isArray(data[key]) ? data[key].map(object) : fail(`${key} must be an array`);
  const text = (row: Record<string, any>, key: string) => { if (typeof row[key] !== 'string') fail(`${key} must be text`); };
  const actors = new Set(document.actors.map(a => a.id));
  const actor = (id: unknown) => { if (typeof id !== 'string' || !actors.has(id)) fail(`unknown actor ${String(id)}`); };
  const refs = (value: unknown, ids: Set<string>, label: string) => {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !ids.has(id))) fail(`invalid ${label} references`);
  };
  if (mode === 'plan') {
    const stages = rows('stages');
    if (stages.length < 2) fail('at least two stages required');
    for (const row of stages) {
      for (const key of ['clientId', 'title', 'location', 'description', 'endCondition']) text(row, key);
      refs(row.actorIds, actors, 'actor');
      if (!Array.isArray(row.requiredBeats) || row.requiredBeats.some((s: unknown) => typeof s !== 'string')) fail('requiredBeats must be text array');
    }
    return;
  }
  if (mode === 'rewrite-records') {
    for (const [key, records] of [['rewrittenMessages', document.messages], ['rewrittenPosts', document.posts]] as const) {
      const ids = new Set(records.map(r => r.id));
      for (const row of rows(key)) { if (!ids.has(row.id)) fail('unknown rewritten record'); text(row, 'text'); }
    }
    return;
  }
  if (data.stageId !== stageId || !document.stages.some(s => s.id === stageId)) fail('stageId mismatch');
  text(data, 'summary');
  const groups = Object.fromEntries(['messages', 'posts', 'comments', 'facts', 'mediaSlots'].map(key => [key, rows(key)]));
  const seen = new Set<string>();
  for (const records of Object.values(groups)) for (const row of records) {
    if (typeof row.clientId !== 'string' || !row.clientId || seen.has(row.clientId)) fail('missing/duplicate clientId');
    seen.add(row.clientId);
  }
  const ids = (key: string) => new Set(groups[key].map(r => String(r.clientId)));
  const media = ids('mediaSlots'), facts = ids('facts'), posts = ids('posts');
  const records = new Set([...ids('messages'), ...posts, ...ids('comments')]);
  for (const row of groups.messages) {
    actor(row.speakerActorId);
    if (!document.conversations.some(c => c.id === row.conversationId)) fail('unknown conversation');
  }
  for (const row of [...groups.posts, ...groups.comments]) actor(row.authorActorId);
  for (const row of [...groups.messages, ...groups.posts, ...groups.comments]) {
    text(row, 'text'); if (!Number.isFinite(row.order)) fail('invalid record order');
    refs(row.mediaClientIds || [], media, 'media');
  }
  for (const row of groups.comments) if (!posts.has(row.postClientId)) fail('unknown comment post');
  for (const row of groups.posts) refs(row.sourceFactClientIds || [], facts, 'fact');
  for (const row of groups.facts) {
    text(row, 'text'); if (row.status !== 'happened') fail('invalid fact status');
    refs(row.knownByActorIds, actors, 'actor'); refs(row.sourceRecordClientIds, records, 'record');
  }
  for (const row of groups.mediaSlots) {
    if (row.kind !== 'image' && row.kind !== 'video') fail('invalid media kind');
    text(row, 'caption'); text(row, 'shotDescription'); refs(row.actorIds, actors, 'actor'); refs(row.sourceFactClientIds, facts, 'fact');
  }
}
