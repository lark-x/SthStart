import type { KnowledgeRecommendation, KnowledgeSearchItem, KnowledgeSearchResponse, NoteKnowledge } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import { noteReferenceText } from './store.js';

/** 检索结果总上限：界面按实际返回说明是否截断。 */
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
  query: { q?: string; works?: string[]; characters?: string[]; usage?: string; nature?: string; category?: string; limit?: number; includeRecord?: boolean },
): { items: KnowledgeSearchItem[]; total: number; truncated: boolean } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const q = String(query.q ?? '').trim();
  const escape = '\\';
  if (q) {
    const like = '%' + escapeLike(q) + '%';
    clauses.push("(n.title LIKE ? ESCAPE '" + escape + "' OR n.summary LIKE ? ESCAPE '" + escape + "' OR n.content_json LIKE ? ESCAPE '" + escape + "')");
    params.push(like, like, like);
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
  const sql = 'SELECT n.*, k.works_json, k.characters_json, k.locations_json, k.category, k.nature, k.authorship, k.usage, k.sources_json'
    + ' FROM creative_notes n LEFT JOIN note_knowledge k ON k.note_id=n.id '
    + where + ' ORDER BY n.updated_at DESC LIMIT ?';
  const rows = database.connection.prepare(sql).all(...params as never[], limit) as NoteRow[];
  const items = rows.map((row) => noteToItem(row, knowledgeOfRow(row), q || null));
  return { items, total: items.length, truncated: items.length >= limit };
}

interface NarrativeHit {
  workId: string; kind: string; refId: string; nodeId?: string | null;
  title?: string | null; excerpt?: string | null; speaker?: string | null;
  sourceLine?: number | null; pathHash?: string | null;
}

function likeSearch(narrativeDatabase: NarrativeDatabase, like: string, workId: string | null, limit: number): NarrativeHit[] {
  const escape = '\\';
  const sql = 'SELECT * FROM ('
    + " SELECT n.work_id workId,'utterance' kind,u.id refId,n.id nodeId,COALESCE(u.speaker,'') title,u.body excerpt,"
    + " json_extract(u.metadata_json,'$.sourceLine') sourceLine, json_extract(u.metadata_json,'$.pathHash') pathHash, u.speaker speaker"
    + ' FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id'
    + " WHERE u.body LIKE ? ESCAPE '" + escape + "'"
    + " UNION ALL SELECT e.work_id,'entity',e.id,NULL,e.name,e.description,NULL,NULL,NULL FROM narrative_entities e"
    + " WHERE e.name LIKE ? ESCAPE '" + escape + "' OR e.description LIKE ? ESCAPE '" + escape + "'"
    + " UNION ALL SELECT n.work_id,'node',n.id,n.id,n.title,n.summary,NULL,NULL,NULL FROM narrative_nodes n"
    + " WHERE n.title LIKE ? ESCAPE '" + escape + "' OR n.summary LIKE ? ESCAPE '" + escape + "'"
    + ') WHERE (? IS NULL OR workId=?) LIMIT ?';
  return narrativeDatabase.connection.prepare(sql).all(like, like, like, like, like, workId, workId, limit) as unknown as NarrativeHit[];
}

function ftsSearch(database: NarrativeDatabase, q: string, workId: string | null, limit: number): NarrativeHit[] | null {
  const match = q.split(/\s+/).filter(Boolean).map((word) => '"' + word.replaceAll('"', '""') + '"*').join(' AND ');
  if (!match) return null;
  try {
    const sql = 'SELECT narrative_fts.work_id workId,narrative_fts.kind,narrative_fts.ref_id refId,'
      + ' CASE narrative_fts.kind WHEN "node" THEN narrative_fts.ref_id WHEN "utterance" THEN s.node_id ELSE NULL END nodeId,'
      + " narrative_fts.title, snippet(narrative_fts,4,'','','…',24) excerpt,"
      + " json_extract(u.metadata_json,'$.sourceLine') sourceLine, json_extract(u.metadata_json,'$.pathHash') pathHash, u.speaker speaker"
      + ' FROM narrative_fts'
      + " LEFT JOIN narrative_utterances u ON narrative_fts.kind='utterance' AND narrative_fts.ref_id=u.id"
      + ' LEFT JOIN narrative_scenes s ON u.scene_id=s.id'
      + ' WHERE narrative_fts MATCH ? AND (? IS NULL OR narrative_fts.work_id=?) LIMIT ?';
    return database.connection.prepare(sql).all(match, workId, workId, limit) as unknown as NarrativeHit[];
  } catch {
    return null;
  }
}

/**
 * 叙事片段检索：复用叙事库已有的实体别名与原文索引。
 * 两个数据库分别查询再汇总，不假设跨库外键或 JOIN。
 * 行号标记为本地行号：Akasha 原文按去空行后重新编号，不能当作远端真实行号。
 */
export function searchNarrative(
  narrativeDatabase: NarrativeDatabase | null,
  query: { q?: string; workId?: string; limit?: number },
): { items: KnowledgeSearchItem[]; truncated: boolean } {
  const q = String(query.q ?? '').trim();
  if (!narrativeDatabase || !q) return { items: [], truncated: false };
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
  const workTitles = new Map<string, string>(
    (narrativeDatabase.connection.prepare('SELECT id,title FROM narrative_works').all() as Array<{ id: string; title: string }>)
      .map((row) => [String(row.id), String(row.title)]),
  );
  const like = '%' + escapeLike(q) + '%';
  const workId = query.workId ?? null;
  try {
    const short = Array.from(q).length < 3;
    const rows = short ? likeSearch(narrativeDatabase, like, workId, limit)
      : (ftsSearch(narrativeDatabase, q, workId, limit) ?? likeSearch(narrativeDatabase, like, workId, limit));
    const items: KnowledgeSearchItem[] = rows.map((row) => ({
      kind: 'narrative' as const,
      id: String(row.refId),
      title: String(row.title ?? '').trim() || String(row.speaker ?? '') || '叙事片段',
      excerpt: makeExcerpt(String(row.excerpt ?? ''), q),
      ...(workTitles.get(String(row.workId)) ? { work: workTitles.get(String(row.workId))! } : {}),
      nature: 'canon',
      authorship: 'excerpt',
      sourceKind: 'narrative',
      sourceTitle: workTitles.get(String(row.workId)) ?? '叙事档案',
      locator: {
        workId: String(row.workId),
        kind: String(row.kind ?? 'utterance'),
        ...(row.nodeId ? { nodeId: String(row.nodeId) } : {}),
        ...(row.speaker ? { speaker: String(row.speaker) } : {}),
        ...(row.sourceLine ? { sourceLine: Number(row.sourceLine), lineKind: 'local' } : {}),
        ...(row.pathHash ? { pathHash: String(row.pathHash) } : {}),
      },
    }));
    return { items, truncated: items.length >= limit };
  } catch {
    return { items: [], truncated: false };
  }
}

/** 一起查两个库：资料 + 本地叙事摘录。只读，不触发联网。 */
export function searchKnowledge(
  dependencies: { database: ServiceDatabase; narrativeDatabase: NarrativeDatabase | null },
  query: { q?: string; workId?: string; works?: string[]; characters?: string[]; kinds?: string[]; limit?: number },
): KnowledgeSearchResponse {
  const wantNotes = !query.kinds?.length || query.kinds.includes('note');
  const wantNarrative = !query.kinds?.length || query.kinds.includes('narrative');
  const notes = wantNotes
    ? searchNotes(dependencies.database, { q: query.q, works: query.works, characters: query.characters, limit: query.limit })
    : { items: [] as KnowledgeSearchItem[], total: 0, truncated: false };
  const narrative = wantNarrative
    ? searchNarrative(dependencies.narrativeDatabase, { q: query.q, workId: query.workId, limit: query.limit ?? 30 })
    : { items: [] as KnowledgeSearchItem[], truncated: false };
  const items = [...notes.items, ...narrative.items];
  return { items, total: items.length, truncated: notes.truncated || narrative.truncated };
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
