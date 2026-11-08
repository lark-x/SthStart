import type { KnowledgeRecommendation, KnowledgeSearchItem, KnowledgeSearchQuery, KnowledgeSearchResponse, NoteKnowledge } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import { noteReferenceText } from './store.js';

/** 单页默认容量；offset 可访问完整匹配集合。 */
export const KNOWLEDGE_SEARCH_LIMIT = 60;
const EXCERPT_LENGTH = 260;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function makeExcerpt(text: string, needle: string | null): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!needle) return clean.slice(0, EXCERPT_LENGTH);
  const index = clean.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return clean.slice(0, EXCERPT_LENGTH);
  const start = Math.max(0, index - 60);
  return (start > 0 ? '…' : '') + clean.slice(start, start + EXCERPT_LENGTH);
}

interface NoteRow extends Record<string, unknown> {
  id: string;
  title: string;
  summary: string;
  content_json: string;
  revision: number;
  updated_at: string;
}

function blocksOf(contentJson: unknown): Parameters<typeof noteReferenceText>[0]['content'] {
  try {
    const parsed = JSON.parse(String(contentJson ?? '[]')) as unknown;
    return Array.isArray(parsed) ? parsed as Parameters<typeof noteReferenceText>[0]['content'] : [];
  } catch {
    return [];
  }
}

function knowledgeOfRow(row: Record<string, unknown>): NoteKnowledge | null {
  if (row.usage === undefined || row.usage === null) return null;
  return {
    schemaVersion: 1,
    works: JSON.parse(String(row.works_json ?? '[]')) as NoteKnowledge['works'],
    characters: JSON.parse(String(row.characters_json ?? '[]')) as NoteKnowledge['characters'],
    locations: JSON.parse(String(row.locations_json ?? '[]')) as NoteKnowledge['locations'],
    ...(row.category ? { category: String(row.category) as NoteKnowledge['category'] } : {}),
    nature: String(row.nature ?? 'unconfirmed') as NoteKnowledge['nature'],
    authorship: String(row.authorship ?? 'handwritten') as NoteKnowledge['authorship'],
    usage: String(row.usage) as NoteKnowledge['usage'],
    sources: JSON.parse(String(row.sources_json ?? '[]')) as NoteKnowledge['sources'],
  };
}

function noteToItem(row: NoteRow, knowledge: NoteKnowledge | null, needle: string | null): KnowledgeSearchItem {
  const text = noteReferenceText({
    title: String(row.title),
    summary: String(row.summary ?? ''),
    content: blocksOf(row.content_json),
  });
  const primaryWork = knowledge?.works[0]?.name;
  return {
    kind: 'note',
    id: String(row.id),
    title: String(row.title),
    excerpt: makeExcerpt(text, needle),
    ...(primaryWork ? { work: primaryWork } : {}),
    ...(knowledge?.works.length ? { works: knowledge.works.map((work) => work.name) } : {}),
    ...(knowledge?.category ? { category: knowledge.category } : {}),
    nature: knowledge?.nature ?? 'unconfirmed',
    authorship: knowledge?.authorship ?? 'handwritten',
    usage: knowledge?.usage ?? 'record',
    revision: Number(row.revision ?? 1),
    updatedAt: String(row.updated_at ?? ''),
    sourceKind: 'note',
    sourceTitle: String(row.title),
  };
}

/**
 * 资料检索：服务端筛选与分页，不只在首批 300 条里过滤。
 * 中文一两个字的名称不能只依赖 trigram FTS，所以正文命中走 LIKE 回退。
 */
export function searchNotes(
  database: ServiceDatabase,
  query: { q?: string; works?: string[]; characters?: string[]; usage?: string; nature?: string; category?: string; limit?: number; offset?: number; includeRecord?: boolean },
): { items: KnowledgeSearchItem[]; total: number; truncated: boolean } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const q = String(query.q ?? '').trim();
  const escape = '\\';
  if (q) {
    const like = '%' + escapeLike(q) + '%';
    clauses.push("(n.title LIKE ? ESCAPE '" + escape + "' OR n.summary LIKE ? ESCAPE '" + escape + "' OR n.content_json LIKE ? ESCAPE '" + escape + "' OR k.works_json LIKE ? ESCAPE '" + escape + "' OR k.characters_json LIKE ? ESCAPE '" + escape + "')");
    params.push(like, like, like, like, like);
  }
  for (const work of query.works ?? []) {
    clauses.push("k.works_json LIKE ? ESCAPE '" + escape + "'");
    params.push('%' + escapeLike(work) + '%');
  }
  for (const character of query.characters ?? []) {
    clauses.push("k.characters_json LIKE ? ESCAPE '" + escape + "'");
    params.push('%"' + escapeLike(character) + '"%');
  }
  if (query.category) { clauses.push('k.category=?'); params.push(query.category); }
  if (query.nature) { clauses.push('k.nature=?'); params.push(query.nature); }
  if (query.usage) { clauses.push('k.usage=?'); params.push(query.usage); }
  // 默认只在“可参考”范围里检索；显式要求时才带上仅记录内容。
  if (!query.usage && !query.includeRecord) clauses.push("ifnull(k.usage,'record')='reference'");
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const limit = Math.min(Math.max(query.limit ?? KNOWLEDGE_SEARCH_LIMIT, 1), 200);
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const from = ' FROM creative_notes n LEFT JOIN note_knowledge k ON k.note_id=n.id ' + where;
  const total = Number((database.connection.prepare('SELECT count(*) total' + from).get(...params as never[]) as { total: number }).total);
  const sql = 'SELECT n.*, k.works_json, k.characters_json, k.locations_json, k.category, k.nature, k.authorship, k.usage, k.sources_json'
    + from + ' ORDER BY n.updated_at DESC, n.id DESC LIMIT ? OFFSET ?';
  const rows = database.connection.prepare(sql).all(...params as never[], limit, offset) as NoteRow[];
  const items = rows.map((row) => noteToItem(row, knowledgeOfRow(row), q || null));
  return { items, total, truncated: offset + items.length < total };
}

interface NarrativeHit {
  workId: string; kind: string; refId: string; nodeId?: string | null;
  title?: string | null; excerpt?: string | null; speaker?: string | null;
  sourceLine?: number | null; pathHash?: string | null;
}

function narrativeQuery(q: string, workId: string | null, fts: boolean) {
  const match = q.split(/\s+/).filter(Boolean).map(word => '"' + word.replaceAll('"', '""') + '"*').join(' AND ');
  const like = '%' + escapeLike(q) + '%';
  const sql = fts
    ? "SELECT f.work_id workId,f.kind,f.ref_id refId, CASE f.kind WHEN 'node' THEN f.ref_id WHEN 'utterance' THEN s.node_id ELSE NULL END nodeId,"
      + " f.title,f.body excerpt,json_extract(u.metadata_json,'$.sourceLine') sourceLine,json_extract(u.metadata_json,'$.pathHash') pathHash,u.speaker"
      + ' FROM narrative_fts f LEFT JOIN narrative_utterances u ON f.kind=\'utterance\' AND f.ref_id=u.id'
      + ' LEFT JOIN narrative_scenes s ON u.scene_id=s.id WHERE narrative_fts MATCH ? AND (? IS NULL OR f.work_id=?)'
    : "SELECT * FROM (SELECT n.work_id workId,'utterance' kind,u.id refId,n.id nodeId,COALESCE(u.speaker,'') title,u.body excerpt,"
      + " json_extract(u.metadata_json,'$.sourceLine') sourceLine,json_extract(u.metadata_json,'$.pathHash') pathHash,u.speaker"
      + ' FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id'
      + " WHERE u.body LIKE ? ESCAPE '\\'"
      + " UNION ALL SELECT e.work_id,'entity',e.id,NULL,e.name,e.description,NULL,NULL,NULL FROM narrative_entities e"
      + " WHERE e.name LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\'"
      + " UNION ALL SELECT n.work_id,'node',n.id,n.id,n.title,n.summary,NULL,NULL,NULL FROM narrative_nodes n"
      + " WHERE n.title LIKE ? ESCAPE '\\' OR n.summary LIKE ? ESCAPE '\\') WHERE (? IS NULL OR workId=?)";
  return { sql, params: fts ? [match, workId, workId] : [like, like, like, like, like, workId, workId] };
}

/** Full-text ranking is not needed for pagination: use stable source/kind/id ordering. */
export function searchNarrative(
  database: NarrativeDatabase | null,
  query: { q?: string; workId?: string; limit?: number; offset?: number },
): { items: KnowledgeSearchItem[]; total: number; truncated: boolean } {
  const q = String(query.q ?? '').trim();
  if (!database || !q) return { items: [], total: 0, truncated: false };
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 200);
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const read = (fts: boolean) => {
    const { sql, params } = narrativeQuery(q, query.workId ?? null, fts);
    const total = Number((database.connection.prepare('SELECT count(*) total FROM (' + sql + ')').get(...params as never[]) as { total: number }).total);
    const rows = database.connection.prepare('SELECT * FROM (' + sql + ') ORDER BY workId ASC,kind ASC,refId ASC LIMIT ? OFFSET ?')
      .all(...params as never[], limit, offset) as unknown as NarrativeHit[];
    return { rows, total };
  };
  let result: ReturnType<typeof read>;
  if (Array.from(q).length < 3) result = read(false);
  else {
    try { result = read(true); } catch { result = read(false); }
    // An unavailable/stale FTS index must not hide searchable original text.
    if (!result.total) result = read(false);
  }
  const titles = new Map((database.connection.prepare('SELECT id,title FROM narrative_works').all() as Array<{ id: string; title: string }>).map(row => [row.id, row.title]));
  const items: KnowledgeSearchItem[] = result.rows.map(row => ({
    kind: 'narrative', id: String(row.refId),
    title: String(row.title ?? '').trim() || String(row.speaker ?? '') || '叙事片段',
    excerpt: makeExcerpt(String(row.excerpt ?? ''), q),
    ...(titles.get(row.workId) ? { work: titles.get(row.workId)! } : {}),
    nature: 'canon', authorship: 'excerpt', sourceKind: 'narrative',
    sourceTitle: titles.get(row.workId) ?? '叙事档案',
    locator: {
      workId: row.workId, kind: row.kind,
      ...(row.nodeId ? { nodeId: row.nodeId } : {}),
      ...(row.speaker ? { speaker: row.speaker } : {}),
      ...(row.sourceLine ? { sourceLine: Number(row.sourceLine), lineKind: 'local' } : {}),
      ...(row.pathHash ? { pathHash: row.pathHash } : {}),
    },
  }));
  return { items, total: result.total, truncated: offset + items.length < result.total };
}

/** Topics and collected source VERSIONS keep the ids accepted by resolveReference. */
function searchOtherSources(database: ServiceDatabase, kind: 'topic' | 'collection', query: KnowledgeSearchQuery) {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const q = query.q?.trim() ?? '';
  const limit = query.limit ?? KNOWLEDGE_SEARCH_LIMIT;
  const offset = query.offset ?? 0;
  let from: string;
  let columns: string;
  let order: string;
  if (kind === 'topic') {
    from = ' FROM topics t';
    clauses.push('t.ignored=0');
    if (q) {
      clauses.push("(t.title LIKE ? ESCAPE '\\' OR t.summary LIKE ? ESCAPE '\\' OR t.works_json LIKE ? ESCAPE '\\' OR t.characters_json LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM topic_sources ts WHERE ts.topic_id=t.id AND (ts.title LIKE ? ESCAPE '\\' OR ts.excerpt LIKE ? ESCAPE '\\')))" );
      params.push(...Array(6).fill('%' + escapeLike(q) + '%'));
    }
    for (const work of query.works ?? []) { clauses.push("t.works_json LIKE ? ESCAPE '\\'"); params.push('%' + escapeLike(work) + '%'); }
    for (const character of query.characters ?? []) { clauses.push("t.characters_json LIKE ? ESCAPE '\\'"); params.push('%' + escapeLike(character) + '%'); }
    columns = 't.id,t.title,t.summary excerpt,t.works_json,t.info_nature,t.updated_at';
    order = 't.updated_at DESC,t.id DESC';
  } else {
    from = ' FROM knowledge_source_versions v JOIN knowledge_sources s ON s.id=v.source_id';
    // Only actual collection findings are exposed; ignored results stay excluded.
    clauses.push("EXISTS (SELECT 1 FROM knowledge_pending_items p WHERE p.source_version_id=v.id AND p.state!='ignored')");
    if (q) {
      clauses.push("(v.title LIKE ? ESCAPE '\\' OR v.excerpt LIKE ? ESCAPE '\\' OR v.organized_text LIKE ? ESCAPE '\\' OR s.work LIKE ? ESCAPE '\\' OR s.source_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM knowledge_pending_items p WHERE p.source_version_id=v.id AND p.state!='ignored' AND p.characters_json LIKE ? ESCAPE '\\'))");
      params.push(...Array(6).fill('%' + escapeLike(q) + '%'));
    }
    for (const work of query.works ?? []) { clauses.push("s.work LIKE ? ESCAPE '\\'"); params.push('%' + escapeLike(work) + '%'); }
    for (const character of query.characters ?? []) {
      clauses.push("EXISTS (SELECT 1 FROM knowledge_pending_items p WHERE p.source_version_id=v.id AND p.state!='ignored' AND p.characters_json LIKE ? ESCAPE '\\')");
      params.push('%' + escapeLike(character) + '%');
    }
    columns = "v.id,v.title,COALESCE(NULLIF(v.organized_text,''),v.excerpt) excerpt,v.organized_text,v.retrieved_at updated_at,s.work,s.source_name,s.nature";
    order = 'v.retrieved_at DESC,v.id DESC';
  }
  const where = ' WHERE ' + clauses.join(' AND ');
  const total = Number((database.connection.prepare('SELECT count(*) total' + from + where).get(...params as never[]) as { total: number }).total);
  const rows = database.connection.prepare('SELECT ' + columns + from + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?')
    .all(...params as never[], limit, offset) as Array<Record<string, unknown>>;
  const items: KnowledgeSearchItem[] = rows.map(row => {
    const works = kind === 'topic' ? JSON.parse(String(row.works_json ?? '[]')) as string[] : row.work ? [String(row.work)] : [];
    return {
      kind, id: String(row.id), title: String(row.title || row.source_name || '搜集来源'),
      excerpt: makeExcerpt(String(row.excerpt ?? ''), q || null),
      ...(works.length ? { works, work: works[0] } : {}),
      nature: kind === 'topic' ? row.info_nature === 'official' ? 'canon' : 'community' : String(row.nature ?? 'unconfirmed'),
      authorship: row.organized_text ? 'ai-organized' : 'excerpt',
      updatedAt: String(row.updated_at), sourceKind: kind,
      sourceTitle: kind === 'topic' ? '灵感素材' : String(row.source_name || '搜集来源'),
    };
  });
  return { items, total, truncated: offset + items.length < total };
}

/** Combined pagination: notes, narrative, topics, collection versions, each stably ordered.
 * Sequential source segments permit true SQL OFFSET without fetching every prior page. */
export function searchKnowledge(
  dependencies: { database: ServiceDatabase; narrativeDatabase: NarrativeDatabase | null },
  query: KnowledgeSearchQuery,
): KnowledgeSearchResponse {
  const limit = Math.min(200, Math.max(1, Math.trunc(query.limit ?? KNOWLEDGE_SEARCH_LIMIT)));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const kinds = ['note', 'narrative', 'topic', 'collection'] as const;
  const selected = kinds.filter(kind => !query.kinds?.length || query.kinds.includes(kind));
  let skip = offset;
  let total = 0;
  const items: KnowledgeSearchItem[] = [];
  for (const kind of selected) {
    const page = { ...query, limit: Math.max(1, limit - items.length), offset: skip };
    const result = kind === 'note' ? searchNotes(dependencies.database, page)
      : kind === 'narrative' ? searchNarrative(dependencies.narrativeDatabase, page)
      : searchOtherSources(dependencies.database, kind, page);
    total += result.total;
    if (items.length < limit) items.push(...result.items.slice(0, limit - items.length));
    skip = Math.max(0, skip - result.total);
  }
  const hasMore = offset + items.length < total;
  return { items, total, offset, limit, hasMore, truncated: hasMore };
}

/**
 * 本地推荐：按作品、角色、地点与主题推荐已有资料。
 * 优先级：明确关联角色 > 同作品同地点/同主题 > 标题或摘要命中 > 正文命中。
 * 只做本地查询，不触发联网；没有命中时说明“资料库中暂未找到”。
 */
export function recommendNotes(
  database: ServiceDatabase,
  input: { works?: string[]; characters?: string[]; locations?: string[]; theme?: string; keywords?: string[]; limit?: number; includePending?: boolean },
): KnowledgeRecommendation[] {
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 30);
  const works = (input.works ?? []).map((work) => work.trim()).filter(Boolean);
  const characters = (input.characters ?? []).map((name) => name.trim()).filter(Boolean);
  const locations = (input.locations ?? []).map((name) => name.trim()).filter(Boolean);
  const themeWords = [input.theme ?? '', ...(input.keywords ?? [])].join(' ').trim();
  const usageFilter = input.includePending ? "IN ('reference','pending')" : "= 'reference'";
  const rows = database.connection.prepare(
    'SELECT n.id,n.title,n.summary,n.content_json,n.updated_at,'
    + ' k.works_json,k.characters_json,k.locations_json,k.category,k.nature,k.authorship,k.usage,k.sources_json'
    + ' FROM creative_notes n LEFT JOIN note_knowledge k ON k.note_id=n.id'
    + " WHERE ifnull(k.usage,'record') " + usageFilter
    + ' ORDER BY n.updated_at DESC',
  ).all() as Record<string, unknown>[];

  const scored: KnowledgeRecommendation[] = [];
  for (const row of rows) {
    const noteWorks = JSON.parse(String(row.works_json ?? '[]')) as NoteKnowledge['works'];
    const noteCharacters = JSON.parse(String(row.characters_json ?? '[]')) as NoteKnowledge['characters'];
    const noteLocations = JSON.parse(String(row.locations_json ?? '[]')) as NoteKnowledge['locations'];
    const reasons: string[] = [];
    let score = 0;

    const workMatch = works.length > 0 && noteWorks.some((work) => works.some((candidate) => work.name === candidate || work.key === candidate || (work.aliases ?? []).includes(candidate)));
    if (works.length && noteWorks.length && !workMatch) continue;
    const characterHits = characters.filter((name) => noteCharacters.some((ref) => ref.name === name));
    // 同名角色必须同作品才算命中，避免跨作品混用。
    const characterMatches = characters.filter((name) => noteCharacters.some((ref) => ref.name === name && (!works.length || !ref.work || works.includes(ref.work))));
    const locationMatches = locations.filter((name) => noteLocations.some((ref) => ref.name === name));
    const title = String(row.title ?? '');
    const summary = String(row.summary ?? '');

    if (characterMatches.length) { score += 60 + characterMatches.length * 5; reasons.push('关联主角：' + characterMatches.join('、')); }
    if (workMatch) {
      score += 25;
      const matchedWorks = noteWorks.filter((work) => works.includes(work.name)).map((work) => work.name);
      reasons.push('同作品：' + (matchedWorks.length ? matchedWorks.join('、') : works.join('、')));
    }
    if (locationMatches.length) { score += 20; reasons.push('包含地点资料：' + locationMatches.join('、')); }
    if (themeWords) {
      const words = themeWords.split(/\s+/).filter((word) => word.length >= 2);
      if (words.some((word) => (title + ' ' + summary).includes(word))) { score += 12; reasons.push('标题或摘要匹配本次主题'); }
      else if (words.length && String(row.content_json ?? '').includes(words[0])) { score += 6; reasons.push('正文提到相关主题'); }
    }
    if (row.usage === 'pending') reasons.push('待整理：内容尚未确认');
    if (String(row.nature ?? '') === 'personal') reasons.push('个人设定，仅供参考');
    if (!score) continue;

    scored.push({
      noteId: String(row.id),
      title,
      excerpt: makeExcerpt(noteReferenceText({ title, summary, content: blocksOf(row.content_json) }), characterHits[0] ?? null),
      ...(noteWorks[0]?.name ? { work: noteWorks[0].name } : {}),
      usage: String(row.usage ?? 'record'),
      nature: String(row.nature ?? 'unconfirmed'),
      reasons: [...new Set(reasons)].slice(0, 4),
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh'));
  return scored.slice(0, limit);
}
