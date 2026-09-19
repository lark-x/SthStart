import { createHash } from 'node:crypto';
import type { NarrativeDatabase } from '../narrative-database.js';

/**
 * 统一语料提供者：研究引擎只依赖这层接口，不直接读表。
 * 将来接入 MCP 时新增一个实现即可，研究专题、结论与资料库结构都不用改。
 */
export interface CorpusProviderStatus {
  id: string;
  name: string;
  kind: 'local' | 'mcp';
  status: 'ready' | 'empty' | 'unavailable';
  message: string;
  workCount: number;
}

/** 研究范围：第一版一个专题只属于一个作品，避免同名实体跨作品互相污染。 */
export interface ResearchScope {
  workId: string;
  nodeIds?: string[];
  nodeKinds?: string[];
  entityIds?: string[];
  keywords?: string[];
}

export interface CorpusVersion {
  providerId: string;
  workId: string;
  workUpdatedAt: string;
  nodeCount: number;
  utteranceCount: number;
  contentHash: string;
}

export interface CatalogQuery {
  workId: string;
  nodeIds?: string[];
  nodeKinds?: string[];
  limit?: number;
}

export interface CatalogEntry {
  nodeId: string;
  parentId: string | null;
  kind: string;
  title: string;
  summary: string;
  sortOrder: number;
  utteranceCount: number;
}

export interface CorpusSearchQuery {
  workId: string;
  text: string;
  limit?: number;
  /** 只在这些节点内检索，用于「选定章节」的范围。 */
  nodeIds?: string[];
  nodeKinds?: string[];
}

export interface CorpusSearchHit {
  targetType: 'utterance' | 'node' | 'document';
  targetId: string;
  nodeId: string | null;
  sceneId: string | null;
  title: string;
  excerpt: string;
  speaker: string | null;
  sourceLine: number | null;
  locator: string;
}

export interface CorpusSearchPage {
  items: CorpusSearchHit[];
  truncated: boolean;
  /** 检索方式：短中文词走 LIKE 回退，命中率与排序都不同，需要如实告知。 */
  strategy: 'fts' | 'like';
}

export interface CorpusReadQuery {
  targetType: 'utterance' | 'node' | 'document';
  targetId: string;
  /** 前后各取多少条上下文，用于证据扩展。 */
  contextSize?: number;
}

export interface CorpusDocument {
  targetType: 'utterance' | 'node' | 'document';
  targetId: string;
  workId: string;
  nodeId: string | null;
  sceneId: string | null;
  nodeTitle: string;
  sceneTitle: string;
  speaker: string | null;
  text: string;
  contextBefore: string;
  contextAfter: string;
  locator: string;
  contentHash: string;
  sourceVersion: CorpusVersion;
}

export interface RelatedQuery {
  workId: string;
  /** 从命中内容里提取的实体名，用于二跳检索。 */
  terms: string[];
  limit?: number;
  excludeIds?: string[];
}

export interface NarrativeCorpusProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'local' | 'mcp';
  status(): Promise<CorpusProviderStatus>;
  version(scope: ResearchScope): Promise<CorpusVersion>;
  catalog(input: CatalogQuery): Promise<{ items: CatalogEntry[]; truncated: boolean }>;
  search(input: CorpusSearchQuery): Promise<CorpusSearchPage>;
  read(input: CorpusReadQuery): Promise<CorpusDocument | null>;
  related?(input: RelatedQuery): Promise<CorpusSearchPage>;
}

const CONTEXT_SIZE_DEFAULT = 3;

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** 范围里的 nodeIds 可能只选了父节点，子节点也要算在内。 */
function scopeNodeIds(database: NarrativeDatabase, scope: ResearchScope): string[] | null {
  if (!scope.nodeIds?.length && !scope.nodeKinds?.length) return null;
  const all = database.connection.prepare('SELECT id,parent_id parentId,kind FROM narrative_nodes WHERE work_id=?').all(scope.workId) as Array<{ id: string; parentId: string | null; kind: string }>;
  const selected = new Set<string>();
  if (scope.nodeIds?.length) {
    const wanted = new Set(scope.nodeIds);
    for (const node of all) if (wanted.has(node.id)) selected.add(node.id);
    // 逐层把子节点并入，直到不再新增。
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of all) if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) { selected.add(node.id); grew = true; }
    }
  }
  if (scope.nodeKinds?.length) {
    const kinds = new Set(scope.nodeKinds);
    for (const node of all) if (kinds.has(node.kind)) selected.add(node.id);
  }
  return [...selected];
}

export class LocalNarrativeCorpusProvider implements NarrativeCorpusProvider {
  readonly id = 'local-narrative';
  readonly name = '本地叙事档案';
  readonly kind = 'local' as const;

  constructor(private readonly database: NarrativeDatabase) {}

  async status(): Promise<CorpusProviderStatus> {
    const row = this.database.connection.prepare('SELECT COUNT(*) works FROM narrative_works').get() as { works: number };
    const workCount = Number(row?.works ?? 0);
    return {
      id: this.id, name: this.name, kind: this.kind,
      status: workCount > 0 ? 'ready' : 'empty',
      message: workCount > 0 ? `本地已导入 ${workCount} 部作品。` : '本地还没有叙事原文，请先导入规范化 JSON。',
      workCount,
    };
  }

  async version(scope: ResearchScope): Promise<CorpusVersion> {
    const work = this.database.connection.prepare('SELECT id,updated_at updatedAt FROM narrative_works WHERE id=?').get(scope.workId) as { id: string; updatedAt: string } | undefined;
    const counts = this.database.connection.prepare(`SELECT
      (SELECT COUNT(*) FROM narrative_nodes WHERE work_id=?) nodeCount,
      (SELECT COUNT(*) FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id WHERE n.work_id=?) utteranceCount`).get(scope.workId, scope.workId) as { nodeCount: number; utteranceCount: number };
    const nodeCount = Number(counts?.nodeCount ?? 0);
    const utteranceCount = Number(counts?.utteranceCount ?? 0);
    /*
     * 版本由「作品更新时间 + 规模 + 内容摘要」组合而成：
     * 只比时间会在同秒内多次导入时漏判，只比规模会在等量替换时漏判。
     */
    const digest = this.database.connection.prepare(`SELECT COALESCE(SUM(LENGTH(u.body)),0) bodyBytes,
      COALESCE(MAX(u.updated_at),'') lastUtteranceAt
      FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id WHERE n.work_id=?`).get(scope.workId) as { bodyBytes: number; lastUtteranceAt: string };
    return {
      providerId: this.id, workId: scope.workId,
      workUpdatedAt: work?.updatedAt ?? '',
      nodeCount, utteranceCount,
      contentHash: hash({ workId: scope.workId, updatedAt: work?.updatedAt ?? '', nodeCount, utteranceCount, bodyBytes: Number(digest?.bodyBytes ?? 0), lastUtteranceAt: digest?.lastUtteranceAt ?? '' }),
    };
  }

  async catalog(input: CatalogQuery): Promise<{ items: CatalogEntry[]; truncated: boolean }> {
    const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
    const allowed = scopeNodeIds(this.database, { workId: input.workId, nodeIds: input.nodeIds, nodeKinds: input.nodeKinds });
    const rows = this.database.connection.prepare(`SELECT n.id nodeId,n.parent_id parentId,n.kind,n.title,n.summary,n.sort_order sortOrder,
      (SELECT COUNT(*) FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id WHERE s.node_id=n.id) utteranceCount
      FROM narrative_nodes n WHERE n.work_id=? ORDER BY n.sort_order,n.title`).all(input.workId) as unknown as CatalogEntry[];
    const filtered = allowed ? rows.filter((row) => allowed.includes(row.nodeId)) : rows;
    return { items: filtered.slice(0, limit), truncated: filtered.length > limit };
  }

  async search(input: CorpusSearchQuery): Promise<CorpusSearchPage> {
    const text = String(input.text ?? '').trim();
    if (!text) return { items: [], truncated: false, strategy: 'fts' };
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const allowed = scopeNodeIds(this.database, { workId: input.workId, nodeIds: input.nodeIds, nodeKinds: input.nodeKinds });
    // 中文一两个字不能依赖 trigram FTS，短词直接走 LIKE 回退。
    const short = Array.from(text).length < 3;
    const like = '%' + escapeLike(text) + '%';
    const ftsRows = short ? null : this.ftsHits(input.workId, text, limit * 3);
    const rows = ftsRows ?? this.likeHits(input.workId, like, limit * 3);
    const strategy: 'fts' | 'like' = ftsRows ? 'fts' : 'like';
    /*
     * 同一场景命中只留第一条：同一段对白里反复出现关键词时，
     * 保留整段重复证据会挤掉其它场景。
     */
    const seen = new Set<string>();
    const deduped: CorpusSearchHit[] = [];
    for (const row of rows) {
      if (allowed && (!row.nodeId || !allowed.includes(row.nodeId))) continue;
      const key = row.sceneId ? `scene:${row.sceneId}` : `${row.targetType}:${row.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= limit) break;
    }
    return { items: deduped, truncated: rows.length > deduped.length, strategy };
  }

  private likeHits(workId: string, like: string, limit: number): CorpusSearchHit[] {
    return this.database.connection.prepare(`SELECT * FROM (
      SELECT 'utterance' targetType,u.id targetId,n.id nodeId,u.scene_id sceneId,
        COALESCE(u.speaker,'') title,u.body excerpt,u.speaker speaker,
        json_extract(u.metadata_json,'$.sourceLine') sourceLine,
        w.title || ' / ' || n.title locator
      FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id JOIN narrative_works w ON w.id=n.work_id
      WHERE u.body LIKE ? ESCAPE '\\' AND n.work_id=?
      UNION ALL SELECT 'node',n.id,n.id,NULL,n.title,n.summary,NULL,NULL,w.title || ' / ' || n.title
      FROM narrative_nodes n JOIN narrative_works w ON w.id=n.work_id
      WHERE (n.title LIKE ? ESCAPE '\\' OR n.summary LIKE ? ESCAPE '\\') AND n.work_id=?
    ) LIMIT ?`).all(like, workId, like, like, workId, limit) as unknown as CorpusSearchHit[];
  }

  private ftsHits(workId: string, text: string, limit: number): CorpusSearchHit[] | null {
    const match = text.split(/\s+/).filter(Boolean).map((word) => `"${word.replaceAll('"', '""')}"*`).join(' AND ');
    if (!match) return null;
    try {
      return this.database.connection.prepare(`SELECT
        CASE narrative_fts.kind WHEN 'utterance' THEN 'utterance' ELSE 'node' END targetType,
        narrative_fts.ref_id targetId,
        CASE narrative_fts.kind WHEN 'node' THEN narrative_fts.ref_id ELSE s.node_id END nodeId,
        u.scene_id sceneId, narrative_fts.title,
        snippet(narrative_fts,4,'','','…',24) excerpt,
        u.speaker speaker, json_extract(u.metadata_json,'$.sourceLine') sourceLine,
        w.title || ' / ' || n.title locator
        FROM narrative_fts
        LEFT JOIN narrative_utterances u ON narrative_fts.kind='utterance' AND narrative_fts.ref_id=u.id
        LEFT JOIN narrative_scenes s ON u.scene_id=s.id
        LEFT JOIN narrative_nodes n ON (narrative_fts.kind='node' AND n.id=narrative_fts.ref_id) OR (narrative_fts.kind='utterance' AND n.id=s.node_id)
        LEFT JOIN narrative_works w ON w.id=narrative_fts.work_id
        WHERE narrative_fts MATCH ? AND narrative_fts.work_id=? AND narrative_fts.kind IN ('utterance','node') LIMIT ?`).all(match, workId, limit) as unknown as CorpusSearchHit[];
    } catch {
      return null;
    }
  }

  async read(input: CorpusReadQuery): Promise<CorpusDocument | null> {
    const contextSize = Math.min(Math.max(input.contextSize ?? CONTEXT_SIZE_DEFAULT, 0), 10);
    if (input.targetType === 'node') return this.readNode(input.targetId, contextSize);
    return this.readUtterance(input.targetId, contextSize);
  }

  private readNode(nodeId: string, contextSize: number): CorpusDocument | null {
    const node = this.database.connection.prepare(`SELECT n.id,n.work_id workId,n.title,n.summary,w.title workTitle,w.updated_at workUpdatedAt
      FROM narrative_nodes n JOIN narrative_works w ON w.id=n.work_id WHERE n.id=?`).get(nodeId) as { id: string; workId: string; title: string; summary: string; workTitle: string; workUpdatedAt: string } | undefined;
    if (!node) return null;
    const lines = this.database.connection.prepare(`SELECT u.speaker,u.body FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id
      WHERE s.node_id=? ORDER BY s.sort_order,u.sort_order LIMIT ?`).all(nodeId, Math.max(contextSize, 40)) as Array<{ speaker: string | null; body: string }>;
    const text = lines.map((line) => `${line.speaker ? `${line.speaker}：` : ''}${line.body}`).join('\n');
    return {
      targetType: 'node', targetId: node.id, workId: node.workId, nodeId: node.id, sceneId: null,
      nodeTitle: node.title, sceneTitle: '', speaker: null, text: node.summary || text,
      contextBefore: '', contextAfter: '',
      locator: `${node.workTitle} / ${node.title}`,
      contentHash: hash({ targetId: node.id, text: node.summary || text }),
      sourceVersion: { providerId: this.id, workId: node.workId, workUpdatedAt: node.workUpdatedAt, nodeCount: 0, utteranceCount: 0, contentHash: '' },
    };
  }

  private async readUtterance(utteranceId: string, contextSize: number): Promise<CorpusDocument | null> {
    const row = this.database.connection.prepare(`SELECT u.id,u.scene_id sceneId,u.speaker,u.body,s.node_id nodeId,s.title sceneTitle,
      n.title nodeTitle,n.work_id workId,w.title workTitle
      FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id JOIN narrative_works w ON w.id=n.work_id
      WHERE u.id=?`).get(utteranceId) as { id: string; sceneId: string; speaker: string | null; body: string; nodeId: string; sceneTitle: string; nodeTitle: string; workId: string; workTitle: string } | undefined;
    if (!row) return null;
    // 上下文取同场景内相邻条目：跨场景会把不相干的段落并进来。
    const siblings = this.database.connection.prepare('SELECT id,speaker,body FROM narrative_utterances WHERE scene_id=? ORDER BY sort_order,id').all(row.sceneId) as Array<{ id: string; speaker: string | null; body: string }>;
    const index = siblings.findIndex((item) => item.id === row.id);
    const render = (item: { speaker: string | null; body: string }) => `${item.speaker ? `${item.speaker}：` : ''}${item.body}`;
    return {
      targetType: 'utterance', targetId: row.id, workId: row.workId, nodeId: row.nodeId, sceneId: row.sceneId,
      nodeTitle: row.nodeTitle, sceneTitle: row.sceneTitle, speaker: row.speaker, text: row.body,
      contextBefore: siblings.slice(Math.max(0, index - contextSize), index).map(render).join('\n'),
      contextAfter: siblings.slice(index + 1, index + 1 + contextSize).map(render).join('\n'),
      locator: `${row.workTitle} / ${row.nodeTitle}${row.sceneTitle ? ` / ${row.sceneTitle}` : ''}`,
      contentHash: hash({ targetId: row.id, text: row.body }),
      sourceVersion: await this.version({ workId: row.workId }),
    };
  }

  async related(input: RelatedQuery): Promise<CorpusSearchPage> {
    const terms = input.terms.map((term) => term.trim()).filter((term) => term.length >= 2).slice(0, 6);
    if (!terms.length) return { items: [], truncated: false, strategy: 'like' };
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 60);
    const exclude = new Set(input.excludeIds ?? []);
    const seen = new Set<string>();
    const items: CorpusSearchHit[] = [];
    for (const term of terms) {
      const page = await this.search({ workId: input.workId, text: term, limit: limit });
      for (const hit of page.items) {
        if (exclude.has(hit.targetId) || seen.has(hit.targetId)) continue;
        seen.add(hit.targetId); items.push(hit);
        if (items.length >= limit) return { items, truncated: true, strategy: page.strategy };
      }
    }
    return { items, truncated: false, strategy: 'like' };
  }
}
