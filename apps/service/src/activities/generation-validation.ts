import type { ContentDocument } from '@sthstart/contracts';

/** Validate model output before it can be labelled valid or used as subsequent context. */
export function validateGeneratedOutput(output: unknown, document: ContentDocument, mode: string, stageId?: string): void {
  const fail = (message: string): never => { throw new Error(`invalid_ai_output: ${message}`); };
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('expected object');
  const data = object(output);
  if (data.schemaVersion !== 1) fail('schemaVersion must be 1');
  const rows = (key: string): Record<string, unknown>[] => Array.isArray(data[key]) ? data[key].map(object) : fail(`${key} must be an array`);
  const text = (row: Record<string, unknown>, key: string) => { if (typeof row[key] !== 'string') fail(`${key} must be text`); };
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
      for (const row of rows(key)) { if (!ids.has(String(row.id))) fail('unknown rewritten record'); text(row, 'text'); }
    }
    return;
  }
  if (data.stageId !== stageId || !document.stages.some(s => s.id === stageId)) fail('stageId mismatch');
  text(data, 'summary');
  const groups = Object.fromEntries(['messages', 'posts', 'comments', 'facts', 'mediaSlots'].map(key => [key, rows(key)]));
  const seen = new Set<string>();
  for (const records of Object.values(groups)) for (const row of records) {
    if (typeof row.clientId !== 'string' || !row.clientId || seen.has(row.clientId)) fail('missing/duplicate clientId');
    seen.add(String(row.clientId));
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
  for (const row of groups.comments) if (!posts.has(String(row.postClientId))) fail('unknown comment post');
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

/**
 * 快捷文案入口（邀请 / 祝福 / 朋友圈 / 配图描述）的输出校验：
 * 复用阶段输出的引用规则，但允许除目标分组外的分组为空。
 */
export function validateSnippetOutput(
  output: unknown,
  document: ContentDocument,
  stageId: string,
  mode: 'invite' | 'wish' | 'moment' | 'shot' | 'continue-chat',
): void {
  const fail = (message: string): never => { throw new Error(`invalid_ai_output: ${message}`); };
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('expected object');
  const data = object(output);
  if (data.schemaVersion !== 1) fail('schemaVersion must be 1');
  if (data.stageId !== stageId || !document.stages.some((stage) => stage.id === stageId)) fail('stageId mismatch');

  const rows = (key: string): Record<string, unknown>[] => data[key] === undefined ? [] : Array.isArray(data[key]) ? data[key].map(object) : fail(`${key} must be an array`);
  const actors = new Set(document.actors.map((actor) => actor.id));
  const actor = (id: unknown) => { if (typeof id !== 'string' || !actors.has(id)) fail(`unknown actor ${String(id)}`); };
  const text = (row: Record<string, unknown>, key: string) => { if (typeof row[key] !== 'string' || !row[key].trim()) fail(`${key} must be text`); };

  const groups = Object.fromEntries(['messages', 'posts', 'facts', 'mediaSlots'].map((key) => [key, rows(key)]));
  const seen = new Set<string>();
  for (const records of Object.values(groups)) {
    for (const row of records) {
      if (typeof row.clientId !== 'string' || !row.clientId || seen.has(row.clientId)) fail('missing/duplicate clientId');
      seen.add(String(row.clientId));
    }
  }
  const ids = (key: string) => new Set(groups[key].map((row: Record<string, unknown>) => String(row.clientId)));
  const media = ids('mediaSlots'); const facts = ids('facts');
  const refs = (value: unknown, allowed: Set<string>, label: string) => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !allowed.has(id))) fail(`invalid ${label} references`);
  };

  for (const row of groups.messages) {
    actor(row.speakerActorId);
    if (!document.conversations.some((conversation) => conversation.id === row.conversationId)) fail('unknown conversation');
  }
  for (const row of groups.posts) actor(row.authorActorId);
  for (const row of [...groups.messages, ...groups.posts]) {
    text(row, 'text');
    refs(row.mediaClientIds, media, 'media');
    if (row.order !== undefined && !Number.isFinite(row.order)) fail('invalid record order');
  }
  for (const row of groups.posts) refs(row.sourceFactClientIds, facts, 'fact');
  for (const row of groups.facts) {
    text(row, 'text');
    if (row.status !== 'happened') fail('invalid fact status');
    refs(row.knownByActorIds, actors, 'actor');
  }
  for (const row of groups.mediaSlots) {
    if (row.kind !== 'image' && row.kind !== 'video') fail('invalid media kind');
    text(row, 'caption'); text(row, 'shotDescription');
    if (!Array.isArray(row.actorIds)) fail('actorIds must be an array');
    refs(row.actorIds, actors, 'actor');
  }

  // 目标分组必须有内容，否则这次生成没有任何可采用的产出。
  const target = mode === 'moment' ? groups.posts.length + groups.mediaSlots.length : mode === 'shot' ? groups.mediaSlots.length : groups.messages.length;
  if (!target) fail(`${mode} produced no records`);
}

/**
 * 真实模型输出的常见偏差归一化（仅做确定性的类型修复，不发明内容）：
 * - 数字/布尔形式的文本字段 → 字符串；schemaVersion "1" → 1；order "10" → 10
 * - caption 缺失时用 shotDescription 兜底，反之亦然
 * - 引用数组缺失 → 空数组；单对象分组 → 包成数组；缺失 clientId → 自动补号
 * - 角色引用误用 displayName 时映射回 actorId（唯一匹配才修复）
 * - facts.status 同义词 → 'happened'；mediaSlots.kind 中文 → image/video
 * 修复失败时保留原值，由后续校验给出明确错误。
 */
export function normalizeModelOutput<T>(input: T, document: ContentDocument, options?: { stageId?: string }): T {
  const clone = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const actorIds = new Set(document.actors.map((actor) => actor.id));
  const nameToId = new Map(document.actors.map((actor) => [actor.displayName, actor.id]));

  if (clone.schemaVersion !== undefined && Number(clone.schemaVersion) === 1) clone.schemaVersion = 1;
  // 阶段/快捷文案生成以请求的阶段为准：模型漏写或错写 stageId 时按请求值修复。
  if (options?.stageId) clone.stageId = options.stageId;

  const coerceText = (value: unknown): unknown =>
    typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;

  const fixActorRef = (value: unknown): unknown => {
    if (typeof value !== 'string' || actorIds.has(value)) return value;
    return nameToId.get(value) ?? value;
  };

  // 模型把单条记录写成对象而不是数组时包一层；缺失分组留给校验决定（snippet 允许省略）。
  const GROUP_KEYS = ['messages', 'posts', 'comments', 'facts', 'mediaSlots', 'stages', 'rewrittenMessages', 'rewrittenPosts', 'actorRoles'];
  for (const key of GROUP_KEYS) {
    const value = clone[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) clone[key] = [value];
  }

  const seenClientIds = new Set<string>();
  const ROW_PROFILES: Record<string, { prefix: string; textKeys: string[]; actorRefs: string[]; actorListRefs: string[]; refListKeys: string[] }> = {
    messages: { prefix: 'm', textKeys: ['text'], actorRefs: ['speakerActorId'], actorListRefs: [], refListKeys: ['mediaClientIds'] },
    posts: { prefix: 'p', textKeys: ['text'], actorRefs: ['authorActorId'], actorListRefs: [], refListKeys: ['mediaClientIds', 'sourceFactClientIds'] },
    comments: { prefix: 'c', textKeys: ['text'], actorRefs: ['authorActorId'], actorListRefs: [], refListKeys: [] },
    facts: { prefix: 'f', textKeys: ['text'], actorRefs: [], actorListRefs: ['knownByActorIds'], refListKeys: ['sourceRecordClientIds', 'knownByActorIds'] },
    mediaSlots: { prefix: 's', textKeys: ['caption', 'shotDescription'], actorRefs: [], actorListRefs: ['actorIds'], refListKeys: ['sourceFactClientIds'] },
    stages: { prefix: 'plan', textKeys: ['clientId', 'title', 'location', 'description', 'endCondition'], actorRefs: [], actorListRefs: ['actorIds'], refListKeys: [] },
    rewrittenMessages: { prefix: 'rm', textKeys: ['text'], actorRefs: [], actorListRefs: [], refListKeys: [] },
    rewrittenPosts: { prefix: 'rp', textKeys: ['text'], actorRefs: [], actorListRefs: [], refListKeys: [] },
  };

  for (const [groupKey, profile] of Object.entries(ROW_PROFILES)) {
    if (!Array.isArray(clone[groupKey])) continue;
    clone[groupKey] = (clone[groupKey] as unknown[]).map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const record = row as Record<string, unknown>;

      if (typeof record.clientId !== 'string' || !record.clientId || seenClientIds.has(record.clientId)) {
        record.clientId = `${profile.prefix}_${index + 1}`;
      }
      seenClientIds.add(String(record.clientId));

      // order 必须是有限数字：数字字符串直接转，缺失或非法时按数组顺序补位。
      const numericOrder = Number(record.order);
      if ((groupKey === 'messages' || groupKey === 'posts' || groupKey === 'comments') && !Number.isFinite(numericOrder)) {
        record.order = (index + 1) * 10;
      } else if (Number.isFinite(numericOrder) && record.order !== undefined) {
        record.order = numericOrder;
      }
      for (const textKey of profile.textKeys) {
        record[textKey] = coerceText(record[textKey]);
        if (record[textKey] === undefined || record[textKey] === null) {
          // 配图字段互相兜底，避免整批候选因一个空标题被拒。
          if (groupKey === 'mediaSlots' && textKey === 'caption') {
            record.caption = typeof record.shotDescription === 'string' && record.shotDescription ? record.shotDescription : '配图';
          } else if (groupKey === 'mediaSlots' && textKey === 'shotDescription') {
            record.shotDescription = typeof record.caption === 'string' ? record.caption : '';
          }
        }
      }
      for (const refKey of profile.actorRefs) record[refKey] = fixActorRef(record[refKey]);
      for (const listKey of profile.actorListRefs) {
        if (Array.isArray(record[listKey])) record[listKey] = (record[listKey] as unknown[]).map(fixActorRef);
      }
      for (const listKey of profile.refListKeys) {
        if (record[listKey] === undefined) record[listKey] = [];
      }
      if ((groupKey === 'mediaSlots' || groupKey === 'stages') && !Array.isArray(record.actorIds)) record.actorIds = [];
      if (groupKey === 'stages' && !Array.isArray(record.requiredBeats)) record.requiredBeats = [];
      if (groupKey === 'facts') {
        const synonyms: Record<string, string> = { '已发生': 'happened', '完成': 'happened', 'done': 'happened', 'completed': 'happened' };
        if (typeof record.status === 'string' && synonyms[record.status.toLowerCase()]) record.status = synonyms[record.status.toLowerCase()];
      }
      if (groupKey === 'mediaSlots' && typeof record.kind === 'string') {
        const kindMap: Record<string, string> = { '图片': 'image', 'img': 'image', '视频': 'video', '录影': 'video' };
        record.kind = kindMap[record.kind] ?? kindMap[record.kind.toLowerCase()] ?? record.kind;
      }
      if (groupKey === 'messages' && document.conversations.length === 1) {
        const onlyConversationId = document.conversations[0].id;
        if (record.conversationId !== onlyConversationId) record.conversationId = onlyConversationId;
      }
      return record;
    });
  }

  // 顶层 summary 兜底为字符串。
  if ('summary' in clone) clone.summary = coerceText(clone.summary);
  return clone as T;
}
