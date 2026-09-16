import crypto from 'node:crypto';
import type {
  KnowledgeSourceRef, NoteAuthorship, NoteCategory, NoteKnowledge, NoteNature, NoteUsage,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

const NATURES: NoteNature[] = ['canon', 'community', 'personal', 'unconfirmed'];
const AUTHORSHIPS: NoteAuthorship[] = ['handwritten', 'excerpt', 'ai-organized', 'ai-inferred'];
const USAGES: NoteUsage[] = ['record', 'pending', 'reference'];
const CATEGORIES: NoteCategory[] = ['relation', 'personality', 'preference', 'location', 'plot', 'inspiration', 'other'];
const SOURCE_KINDS = ['manual', 'note', 'narrative', 'collection', 'topic', 'web'] as const;

function asText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/** 内容 hash：只覆盖“实际可参考的正文”，用于判断来源是否内容更新。 */
export function contentHashOf(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * 把一篇资料编译成“可参考正文”。
 * 只取文本、链接、原文摘录与图片说明；图片像素不会被模型读取，所以只冻结说明与出处。
 */
export function noteReferenceText(note: { title: string; summary: string; content: unknown[] }): string {
  const lines: string[] = [];
  for (const rawBlock of note.content ?? []) {
    if (!rawBlock || typeof rawBlock !== 'object') continue;
    const block = rawBlock as Record<string, unknown>;
    if (block.type === 'text') {
      const text = String(block.text ?? '').trim();
      if (text) lines.push(text);
    } else if (block.type === 'link') {
      const label = String(block.label ?? '').trim();
      const url = String(block.url ?? '').trim();
      const note = String(block.note ?? '').trim();
      if (label || url) lines.push('[链接] ' + (label || url) + (url ? '：' + url : '') + (note ? '（' + note + '）' : ''));
    } else if (block.type === 'archive-reference') {
      const quote = String(block.quote ?? '').trim();
      const locator = String(block.locator ?? '').trim();
      if (quote) lines.push('[原文摘录] ' + quote + (locator ? '（' + locator + '）' : ''));
    } else if (block.type === 'image') {
      const caption = String(block.caption ?? '').trim();
      lines.push('[图片说明] ' + (caption || '（无说明；图片本身不会被模型读取）'));
    }
  }
  const summary = String(note.summary ?? '').trim();
  return [summary, ...lines].filter(Boolean).join('\n').trim();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function normalizeWorkRefs(value: unknown): NoteKnowledge['works'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NoteKnowledge['works'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const name = asText(source.name, 80);
    const key = asText(source.key, 80) || name;
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const aliases = Array.isArray(source.aliases)
      ? [...new Set(source.aliases.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())).map((a) => a.trim()).slice(0, 10))]
      : [];
    out.push({ key, name, ...(aliases.length ? { aliases } : {}) });
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeCharacterRefs(value: unknown): NoteKnowledge['characters'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NoteKnowledge['characters'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const name = asText(source.name, 80);
    const work = asText(source.work, 80);
    if (!name) continue;
    // 同名角色不能跨作品自动合并：键必须带作品。
    const key = work + '|' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    const characterId = asText(source.characterId, 80);
    out.push({ work, name, ...(characterId ? { characterId } : {}) });
    if (out.length >= 50) break;
  }
  return out;
}

function normalizeLocationRefs(value: unknown): NoteKnowledge['locations'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: NoteKnowledge['locations'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const name = asText(source.name, 80);
    const work = asText(source.work, 80);
    if (!name) continue;
    const key = work + '|' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ work, name });
    if (out.length >= 30) break;
  }
  return out;
}

export function normalizeSourceRef(value: unknown): KnowledgeSourceRef | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const kind = SOURCE_KINDS.includes(source.kind as typeof SOURCE_KINDS[number]) ? source.kind as typeof SOURCE_KINDS[number] : 'manual';
  const title = asText(source.title, 200);
  const excerpt = asText(source.excerpt, 4_000);
  if (!title && !excerpt) return null;
  const locator = source.locator && typeof source.locator === 'object' && !Array.isArray(source.locator)
    ? source.locator as Record<string, unknown>
    : undefined;
  return {
    id: asText(source.id, 80) || crypto.randomUUID(),
    kind,
    ...(asText(source.providerId, 80) ? { providerId: asText(source.providerId, 80) } : {}),
    ...(asText(source.work, 80) ? { work: asText(source.work, 80) } : {}),
    ...(asText(source.externalKey, 300) ? { externalKey: asText(source.externalKey, 300) } : {}),
    ...(asText(source.url, 500) ? { url: asText(source.url, 500) } : {}),
    title: title || excerpt.slice(0, 60),
    excerpt,
    ...(locator ? { locator } : {}),
    ...(asText(source.publishedAt, 40) ? { publishedAt: asText(source.publishedAt, 40) } : {}),
    ...(asText(source.retrievedAt, 40) ? { retrievedAt: asText(source.retrievedAt, 40) } : {}),
    ...(NATURES.includes(source.nature as NoteNature) ? { nature: source.nature as NoteNature } : {}),
    ...(source.truncated === true ? { truncated: true } : {}),
    ...(asText(source.contentHash, 80) ? { contentHash: asText(source.contentHash, 80) } : {}),
  };
}

/** 元数据归一化：仅记录 + 手写是默认值，不要求用户先做任何维护。 */
export function normalizeKnowledge(value: unknown, options: { fallback?: NoteKnowledge | null } = {}): NoteKnowledge {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const fallback = options.fallback ?? null;
  const nature = NATURES.includes(source.nature as NoteNature) ? source.nature as NoteNature : fallback?.nature ?? 'unconfirmed';
  const authorship = AUTHORSHIPS.includes(source.authorship as NoteAuthorship) ? source.authorship as NoteAuthorship : fallback?.authorship ?? 'handwritten';
  const usage = USAGES.includes(source.usage as NoteUsage) ? source.usage as NoteUsage : fallback?.usage ?? 'record';
  const category = CATEGORIES.includes(source.category as NoteCategory) ? source.category as NoteCategory : fallback?.category;
  const sources = Array.isArray(source.sources)
    ? source.sources.map(normalizeSourceRef).filter((item): item is KnowledgeSourceRef => Boolean(item)).slice(0, 30)
    : fallback?.sources ?? [];
  const origin = source.origin && typeof source.origin === 'object'
    ? (() => {
        const raw = source.origin as Record<string, unknown>;
        const kind = ['activity', 'collection', 'topic', 'import'].includes(String(raw.kind)) ? String(raw.kind) as 'activity' | 'collection' | 'topic' | 'import' : null;
        const refId = asText(raw.refId, 80);
        if (!kind || !refId) return fallback?.origin;
        return {
          kind,
          refId,
          label: asText(raw.label, 200),
          ...(asText(raw.note, 500) ? { note: asText(raw.note, 500) } : {}),
          createdAt: asText(raw.createdAt, 40) || nowIso(),
        };
      })()
    : fallback?.origin;
  return {
    schemaVersion: 1,
    works: normalizeWorkRefs(source.works ?? fallback?.works ?? []),
    characters: normalizeCharacterRefs(source.characters ?? fallback?.characters ?? []),
    locations: normalizeLocationRefs(source.locations ?? fallback?.locations ?? []),
    ...(category ? { category } : {}),
    nature,
    authorship,
    usage,
    sources,
    ...(origin ? { origin } : {}),
    ...(Number.isFinite(Number(source.contentRevision)) ? { contentRevision: Math.trunc(Number(source.contentRevision)) } : fallback?.contentRevision !== undefined ? { contentRevision: fallback.contentRevision } : {}),
    ...(asText(source.contentHash, 80) ? { contentHash: asText(source.contentHash, 80) } : fallback?.contentHash !== undefined && fallback.contentHash !== null ? { contentHash: fallback.contentHash } : {}),
  };
}

/**
 * 内容更新检查只比较这个标记：收藏星标之类变化不算内容更新。
 */
export function knowledgeContentHash(note: { title: string; summary: string; content: unknown[] }): string {
  return contentHashOf(noteReferenceText(note));
}

export class KnowledgeStore {
  constructor(private readonly database: ServiceDatabase) {}

  private get connection() {
    return this.database.connection;
  }

  readKnowledge(noteId: string): NoteKnowledge | null {
    const row = this.connection.prepare('SELECT * FROM note_knowledge WHERE note_id=?').get(noteId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      schemaVersion: 1,
      works: parseJson<NoteKnowledge['works']>(row.works_json, []),
      characters: parseJson<NoteKnowledge['characters']>(row.characters_json, []),
      locations: parseJson<NoteKnowledge['locations']>(row.locations_json, []),
      ...(row.category ? { category: String(row.category) as NoteCategory } : {}),
      nature: String(row.nature) as NoteNature,
      authorship: String(row.authorship) as NoteAuthorship,
      usage: String(row.usage) as NoteUsage,
      sources: parseJson<KnowledgeSourceRef[]>(row.sources_json, []),
      ...(row.origin_json ? { origin: parseJson<NonNullable<NoteKnowledge['origin']>>(row.origin_json, undefined as never) } : {}),
      ...(row.content_hash ? { contentHash: String(row.content_hash) } : {}),
      ...(row.content_revision === null || row.content_revision === undefined ? {} : { contentRevision: Number(row.content_revision) }),
    };
  }

  /** 写入元数据；缺省字段回落到已有值，显式空数组才代表清空。 */
  writeKnowledge(noteId: string, knowledge: NoteKnowledge): void {
    const now = nowIso();
    this.connection.prepare(`INSERT INTO note_knowledge
      (note_id,nature,authorship,usage,category,works_json,characters_json,locations_json,sources_json,origin_json,content_hash,content_revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(note_id) DO UPDATE SET
        nature=excluded.nature,authorship=excluded.authorship,usage=excluded.usage,category=excluded.category,
        works_json=excluded.works_json,characters_json=excluded.characters_json,locations_json=excluded.locations_json,
        sources_json=excluded.sources_json,origin_json=excluded.origin_json,content_hash=excluded.content_hash,
        content_revision=excluded.content_revision,updated_at=excluded.updated_at`)
      .run(
        noteId, knowledge.nature, knowledge.authorship, knowledge.usage, knowledge.category ?? null,
        JSON.stringify(knowledge.works), JSON.stringify(knowledge.characters), JSON.stringify(knowledge.locations),
        JSON.stringify(knowledge.sources), knowledge.origin ? JSON.stringify(knowledge.origin) : null,
        knowledge.contentHash ?? null, knowledge.contentRevision ?? null, now, now,
      );
  }

  /** 把可参考正文的 hash 与 revision 同步到元数据，供更新检查使用。 */
  syncContentMarker(noteId: string, note: { title: string; summary: string; content: unknown[] }, revision: number): void {
    const knowledge = this.readKnowledge(noteId);
    if (!knowledge) return;
    const hash = knowledgeContentHash(note);
    if (knowledge.contentHash === hash && knowledge.contentRevision === revision) return;
    this.writeKnowledge(noteId, { ...knowledge, contentHash: hash, contentRevision: revision });
  }

  deleteKnowledge(noteId: string): void {
    this.connection.prepare('DELETE FROM note_knowledge WHERE note_id=?').run(noteId);
  }

  listKnowledge(noteIds: string[]): Map<string, NoteKnowledge> {
    const map = new Map<string, NoteKnowledge>();
    if (!noteIds.length) return map;
    const placeholders = noteIds.map(() => '?').join(',');
    const rows = this.connection.prepare('SELECT * FROM note_knowledge WHERE note_id IN (' + placeholders + ')').all(...noteIds as never[]) as Array<{ note_id: string }>;
    for (const row of rows) {
      const knowledge = this.readKnowledge(String((row as Record<string, unknown>).note_id));
      if (knowledge) map.set(String((row as Record<string, unknown>).note_id), knowledge);
    }
    return map;
  }

  // ------------------------------------------------------------ 来源身份与版本

  /**
   * 找或建来源身份。同一来源身份 + 相同内容只更新最后检查时间。
   */
  upsertSource(input: {
    kind: KnowledgeSourceRef['kind'];
    providerId?: string;
    work?: string;
    externalKey?: string;
    url?: string;
    title: string;
    sourceName?: string;
    nature?: NoteNature;
  }): string {
    const kind = input.kind;
    const providerId = (input.providerId ?? '').slice(0, 80);
    const externalKey = (input.externalKey ?? '').slice(0, 300);
    const url = (input.url ?? '').slice(0, 500);
    const row = this.connection.prepare(`SELECT id FROM knowledge_sources
      WHERE kind=? AND ifnull(provider_id,'')=? AND ifnull(external_key,'')=? AND ifnull(url,'')=?`)
      .get(kind, providerId, externalKey, url) as { id?: string } | undefined;
    const now = nowIso();
    if (row?.id) {
      this.connection.prepare('UPDATE knowledge_sources SET title=?,work=COALESCE(?,work),source_name=?,updated_at=? WHERE id=?')
        .run(input.title.slice(0, 300), input.work ?? null, (input.sourceName ?? '').slice(0, 200), now, row.id);
      return row.id;
    }
    const id = crypto.randomUUID();
    this.connection.prepare(`INSERT INTO knowledge_sources
      (id,kind,provider_id,work,external_key,url,title,source_name,nature,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, kind, providerId || null, input.work ?? null, externalKey || null, url || null,
        input.title.slice(0, 300), (input.sourceName ?? '').slice(0, 200), input.nature ?? null, now, now,
      );
    return id;
  }

  /**
   * 记录一个来源版本。
   * 同源同内容：更新最后检查时间，不新增版本；内容变化：保留新旧版本。
   */
  recordSourceVersion(sourceId: string, input: {
    title: string;
    excerpt: string;
    publishedAt?: string;
    truncated?: boolean;
    organizedText?: string;
    contentHash?: string;
  }): { versionId: string; changeType: 'new' | 'unchanged' | 'changed'; hash: string } {
    const hash = input.contentHash ?? contentHashOf(input.excerpt);
    const now = nowIso();
    const existing = this.connection.prepare('SELECT id,content_hash,excerpt FROM knowledge_source_versions WHERE source_id=? AND content_hash=?')
      .get(sourceId, hash) as { id?: string } | undefined;
    if (existing?.id) {
      this.connection.prepare('UPDATE knowledge_source_versions SET last_checked_at=?,title=?,truncated=? WHERE id=?')
        .run(now, input.title.slice(0, 300), input.truncated ? 1 : 0, existing.id);
      return { versionId: existing.id, changeType: 'unchanged', hash };
    }
    const previous = this.connection.prepare('SELECT id FROM knowledge_source_versions WHERE source_id=? ORDER BY retrieved_at DESC LIMIT 1')
      .get(sourceId) as { id?: string } | undefined;
    const id = crypto.randomUUID();
    this.connection.prepare(`INSERT INTO knowledge_source_versions
      (id,source_id,title,excerpt,content_hash,published_at,retrieved_at,last_checked_at,truncated,organized_text,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id, sourceId, input.title.slice(0, 300), input.excerpt.slice(0, 8_000), hash,
        input.publishedAt ?? null, now, now, input.truncated ? 1 : 0, input.organizedText?.slice(0, 8_000) ?? null, now,
      );
    return { versionId: id, changeType: previous?.id ? 'changed' : 'new', hash };
  }

  getSourceVersion(versionId: string): {
    id: string; sourceId: string; title: string; excerpt: string; contentHash: string;
    publishedAt?: string; retrievedAt: string; truncated?: boolean; organizedText?: string;
    kind: string; url?: string; work?: string; sourceName: string; externalKey?: string; providerId?: string; nature?: NoteNature;
  } | null {
    const row = this.connection.prepare(`SELECT v.*, s.kind, s.url, s.work, s.source_name, s.external_key, s.provider_id, s.nature
      FROM knowledge_source_versions v JOIN knowledge_sources s ON s.id=v.source_id WHERE v.id=?`)
      .get(versionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sourceId: String(row.source_id),
      title: String(row.title ?? ''),
      excerpt: String(row.excerpt ?? ''),
      contentHash: String(row.content_hash),
      ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
      retrievedAt: String(row.retrieved_at),
      ...(row.truncated ? { truncated: true } : {}),
      ...(row.organized_text ? { organizedText: String(row.organized_text) } : {}),
      kind: String(row.kind ?? 'manual'),
      ...(row.provider_id ? { providerId: String(row.provider_id) } : {}),
      ...(row.nature ? { nature: String(row.nature) as NoteNature } : {}),
      ...(row.url ? { url: String(row.url) } : {}),
      ...(row.work ? { work: String(row.work) } : {}),
      sourceName: String(row.source_name ?? ''),
      ...(row.external_key ? { externalKey: String(row.external_key) } : {}),
    };
  }

  // ------------------------------------------------------------ 引用记录

  logReference(input: {
    sourceKind: string;
    sourceId: string;
    sourceVersion?: string;
    title: string;
    sessionId?: string;
    activityId?: string;
    contentHash: string;
  }): void {
    this.connection.prepare(`INSERT INTO knowledge_reference_log
      (id,source_kind,source_id,source_version,title,session_id,activity_id,content_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(
        crypto.randomUUID(), input.sourceKind, input.sourceId, input.sourceVersion ?? null,
        input.title.slice(0, 300), input.sessionId ?? null, input.activityId ?? null, input.contentHash, nowIso(),
      );
  }

  /** 某篇资料被哪些企划/活动引用过。 */
  listReferencesFor(sourceKind: string, sourceId: string, limit = 50) {
    return (this.connection.prepare(`SELECT id,source_kind sourceKind,source_id sourceId,source_version sourceVersion,
      title,session_id sessionId,activity_id activityId,created_at createdAt
      FROM knowledge_reference_log WHERE source_kind=? AND source_id=? ORDER BY created_at DESC LIMIT ?`)
      .all(sourceKind, sourceId, limit) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      sourceKind: String(row.sourceKind),
      sourceId: String(row.sourceId),
      sourceVersion: row.sourceVersion ? String(row.sourceVersion) : undefined,
      title: String(row.title ?? ''),
      sessionId: row.sessionId ? String(row.sessionId) : undefined,
      activityId: row.activityId ? String(row.activityId) : undefined,
      createdAt: String(row.createdAt),
    }));
  }
}
