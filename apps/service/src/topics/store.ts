import crypto from 'node:crypto';
import type {
  Topic, TopicCollectionRun, TopicCollectionRunStatus, TopicCollectionSettings,
  TopicDetail, TopicInfoNature, TopicKind, TopicListQuery, TopicListResponse, TopicSource,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { DEFAULT_DAILY_TIME, DEFAULT_TIMEZONE, computeNextRunAt, normalizeTimezone, parseDailyTime } from './time.js';

const SETTINGS_ID = 'default';

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function asStringArray(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))].slice(0, limit);
}

/** 只去掉明确的跟踪参数；其余查询参数可能用于定位内容，保持原样。 */
export function normalizeTopicUrl(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|spm|share_token)$/i.test(key)) url.searchParams.delete(key);
    }
    // hash may locate an SPA article; preserve it.
    const search = url.searchParams.toString();
    return url.origin + url.pathname.replace(/\/$/, '') + (search ? '?' + search : '') + url.hash;
  } catch {
    return value.slice(0, 500);
  }
}

const KINDS: TopicKind[] = ['meme', 'character', 'update', 'occasion'];
const NATURES: TopicInfoNature[] = ['official', 'community', 'unconfirmed', 'unknown'];

function normalizeKind(value: unknown): TopicKind {
  return KINDS.includes(value as TopicKind) ? value as TopicKind : 'meme';
}
function normalizeNature(value: unknown): TopicInfoNature {
  return NATURES.includes(value as TopicInfoNature) ? value as TopicInfoNature : 'unknown';
}

export interface TopicUpsertInput {
  targetTopicId?: string;
  allowCreate?: boolean;
  title: string;
  summary: string;
  works: string[];
  characters: string[];
  kind: TopicKind;
  infoNature: TopicInfoNature;
  adaptationTags: string[];
  /** 来源发布时间；未知时留空，不假装是刚发生。 */
  publishedAt?: string | null;
  source: {
    sourceId?: string;
    sourceName: string;
    url: string;
    documentLocator: string;
    title: string;
    excerpt: string;
  };
}

/** 标题指纹：只做大小写与标点归一，不做模糊匹配。 */
export function topicTitleKey(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 80);
}

export class TopicStore {
  constructor(private readonly database: ServiceDatabase) {}

  private get connection() {
    return this.database.connection;
  }

  // ---------------------------------------------------------------- 设置

  getSettings(): TopicCollectionSettings {
    const row = this.connection.prepare('SELECT * FROM topic_collection_settings WHERE id=?').get(SETTINGS_ID) as Record<string, unknown> | undefined;
    if (!row) {
      return {
        enabled: false,
        works: [],
        keywords: [],
        sources: [],
        dailyTime: DEFAULT_DAILY_TIME,
        timezone: DEFAULT_TIMEZONE,
        nextRunAt: null,
        maxNewTopics: 20,
        updatedAt: nowIso(),
      };
    }
    return {
      enabled: Boolean(row.enabled),
      works: parseJson<string[]>(row.works_json, []),
      keywords: parseJson<string[]>(row.keywords_json, []),
      sources: parseJson<TopicCollectionSettings['sources']>(row.sources_json, []).filter((item) => item && typeof item.sourceId === 'string' && typeof item.searchTool === 'string'),
      dailyTime: String(row.daily_time ?? DEFAULT_DAILY_TIME),
      timezone: String(row.timezone ?? DEFAULT_TIMEZONE),
      nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
      maxNewTopics: Number(row.max_new_topics ?? 20),
      updatedAt: String(row.updated_at),
    };
  }

  saveSettings(input: Partial<TopicCollectionSettings>): TopicCollectionSettings {
    const current = this.getSettings();
    const parsedTime = parseDailyTime(input.dailyTime ?? current.dailyTime);
    const dailyTime = String(parsedTime.hour).padStart(2, '0') + ':' + String(parsedTime.minute).padStart(2, '0');
    const timezone = normalizeTimezone(input.timezone ?? current.timezone);
    const maxNewTopics = [10, 20, 50].includes(Number(input.maxNewTopics)) ? Number(input.maxNewTopics) : current.maxNewTopics;
    const enabled = input.enabled ?? current.enabled;
    const sources = (input.sources ?? current.sources).map((item) => ({
      sourceId: String(item.sourceId),
      searchTool: String(item.searchTool),
      ...(item.readTool ? { readTool: String(item.readTool) } : {}),
    })).slice(0, 10);
    const now = new Date();
    // 只有开启时才维护下次执行时间；关闭后清空，重新开启时重算。
    const nextRunAt = enabled ? computeNextRunAt(now, dailyTime, timezone) : null;
    this.connection.prepare(`INSERT INTO topic_collection_settings
      (id,enabled,works_json,keywords_json,sources_json,daily_time,timezone,next_run_at,max_new_topics,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        enabled=excluded.enabled,works_json=excluded.works_json,keywords_json=excluded.keywords_json,
        sources_json=excluded.sources_json,daily_time=excluded.daily_time,timezone=excluded.timezone,
        next_run_at=excluded.next_run_at,max_new_topics=excluded.max_new_topics,updated_at=excluded.updated_at`)
      .run(
        SETTINGS_ID, enabled ? 1 : 0,
        JSON.stringify(asStringArray(input.works ?? current.works, 50)),
        JSON.stringify(asStringArray(input.keywords ?? current.keywords, 30)),
        JSON.stringify(sources), dailyTime, timezone, nextRunAt, maxNewTopics, now.toISOString(), now.toISOString(),
      );
    return this.getSettings();
  }

  /** 只更新下次执行时间：错过计划时间补采后顺延。 */
  setNextRunAt(nextRunAt: string | null) {
    this.connection.prepare('UPDATE topic_collection_settings SET next_run_at=?,updated_at=? WHERE id=?').run(nextRunAt, nowIso(), SETTINGS_ID);
  }

  // ---------------------------------------------------------------- 任务

  createRun(input: { trigger: TopicCollectionRun['trigger']; settingsSnapshot: Record<string, unknown> }): TopicCollectionRun {
    const id = crypto.randomUUID();
    const now = nowIso();
    this.connection.prepare(`INSERT INTO topic_collection_runs
      (id,status,trigger,progress_label,used_tool_calls,created_count,merged_count,failed_count,error_message,settings_snapshot_json,raw_candidates_json,started_at,finished_at,created_at,updated_at)
      VALUES (?,?,?,?,0,0,0,0,NULL,?,'[]',NULL,NULL,?,?)`)
      .run(id, 'queued', input.trigger, '已排队', JSON.stringify(input.settingsSnapshot), now, now);
    return this.getRun(id)!;
  }

  getRun(id: string): TopicCollectionRun | null {
    const row = this.connection.prepare('SELECT * FROM topic_collection_runs WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRuns(limit = 10): TopicCollectionRun[] {
    return (this.connection.prepare('SELECT * FROM topic_collection_runs ORDER BY created_at DESC LIMIT ?').all(Math.min(Math.max(limit, 1), 50)) as Record<string, unknown>[])
      .map((row) => this.mapRun(row));
  }

  lastSuccessfulRun(): TopicCollectionRun | null {
    const row = this.connection.prepare("SELECT * FROM topic_collection_runs WHERE status='succeeded' ORDER BY finished_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : null;
  }

  /** 已有排队或运行中的任务时返回它，避免重复点击并行启动。 */
  findActiveRun(): TopicCollectionRun | null {
    const row = this.connection.prepare("SELECT * FROM topic_collection_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : null;
  }

  updateRun(id: string, patch: Partial<{
    status: TopicCollectionRunStatus;
    progressLabel: string | null;
    usedToolCalls: number;
    createdCount: number;
    mergedCount: number;
    failedCount: number;
    errorMessage: string | null;
    rawCandidates: unknown[];
    startedAt: string | null;
    finishedAt: string | null;
  }>) {
    const columns: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => { columns.push(column + '=?'); values.push(value); };
    if (patch.status !== undefined) push('status', patch.status);
    if (patch.progressLabel !== undefined) push('progress_label', patch.progressLabel);
    if (patch.usedToolCalls !== undefined) push('used_tool_calls', patch.usedToolCalls);
    if (patch.createdCount !== undefined) push('created_count', patch.createdCount);
    if (patch.mergedCount !== undefined) push('merged_count', patch.mergedCount);
    if (patch.failedCount !== undefined) push('failed_count', patch.failedCount);
    if (patch.errorMessage !== undefined) push('error_message', patch.errorMessage);
    if (patch.rawCandidates !== undefined) push('raw_candidates_json', JSON.stringify(patch.rawCandidates));
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt);
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt);
    if (!columns.length) return;
    push('updated_at', nowIso());
    values.push(id);
    this.connection.prepare('UPDATE topic_collection_runs SET ' + columns.join(',') + ' WHERE id=?').run(...values as never[]);
  }

  /** 最近一次保留了原始候选的失败/部分完成任务，支持不重新搜索的重试。 */
  findRetryableRun(): TopicCollectionRun | null {
    const row = this.connection.prepare("SELECT * FROM topic_collection_runs WHERE status IN ('failed','partial','interrupted') ORDER BY created_at DESC LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? this.mapRun(row) : null;
  }

  getRunRawCandidates(id: string): unknown[] {
    const row = this.connection.prepare('SELECT raw_candidates_json FROM topic_collection_runs WHERE id=?').get(id) as { raw_candidates_json?: string } | undefined;
    return parseJson<unknown[]>(row?.raw_candidates_json, []);
  }

  /** 进程重启后把未结束的任务标记为中断，释放运行占用。 */
  interruptDanglingRuns(): number {
    const now = nowIso();
    const result = this.connection.prepare(
      "UPDATE topic_collection_runs SET status='interrupted', error_message=COALESCE(error_message,'服务重启导致中断'), progress_label='已中断', finished_at=?, updated_at=? WHERE status IN ('queued','running')"
    ).run(now, now);
    return Number(result.changes);
  }

  // ---------------------------------------------------------------- 素材

  listTopics(query: TopicListQuery): TopicListResponse {
    const view = query.view ?? 'all';
    const page = Math.max(1, Math.trunc(Number(query.page) || 1));
    const pageSize = Math.min(Math.max(Math.trunc(Number(query.pageSize) || 24), 1), 100);
    const clauses: string[] = [];
    const params: unknown[] = [];
    // 默认隐藏已忽略；已忽略视图只显示被忽略的内容。
    clauses.push(view === 'ignored' ? 'ignored=1' : 'ignored=0');
    if (view === 'favorite') clauses.push('favorite=1');
    if (view === 'used') clauses.push('used_activity_id IS NOT NULL');
    const q = String(query.q ?? '').trim();
    if (q) {
      clauses.push('(title LIKE ? OR summary LIKE ? OR works_json LIKE ? OR characters_json LIKE ?)');
      const like = '%' + q + '%';
      params.push(like, like, like, like);
    }
    const works = asStringArray(query.works);
    if (works.length) {
      clauses.push('EXISTS (SELECT 1 FROM json_each(topics.works_json) WHERE value IN (' + works.map(() => '?').join(',') + '))');
      params.push(...works);
    }
    const kinds = (query.kinds ?? []).filter((kind): kind is TopicKind => KINDS.includes(kind));
    if (kinds.length) {
      clauses.push('kind IN (' + kinds.map(() => '?').join(',') + ')');
      params.push(...kinds);
    }
    // 收藏视图默认不限时间，其余视图默认最近 30 天。
    const days = Number(query.days);
    const effectiveDays = query.days !== undefined && Number.isFinite(days) && days >= 0 ? days : view === 'favorite' ? 0 : 30;
    if (effectiveDays > 0) {
      clauses.push('last_seen_at >= ?');
      params.push(new Date(Date.now() - effectiveDays * 86_400_000).toISOString());
    }
    const where = 'WHERE ' + clauses.join(' AND ');
    const totalRow = this.connection.prepare('SELECT COUNT(*) count FROM topics ' + where).get(...params as never[]) as { count?: number } | undefined;
    const rows = this.connection.prepare('SELECT * FROM topics ' + where + ' ORDER BY last_seen_at DESC, created_at DESC LIMIT ? OFFSET ?')
      .all(...params as never[], pageSize, (page - 1) * pageSize) as Record<string, unknown>[];

    // 分面只按忽略视图之外的基础条件统计，避免筛选后分面自相矛盾。
    const facetClauses = ['ignored=0'];
    const facetParams: unknown[] = [];
    if (q) {
      facetClauses.push('(title LIKE ? OR summary LIKE ? OR works_json LIKE ? OR characters_json LIKE ?)');
      const like = '%' + q + '%';
      facetParams.push(like, like, like, like);
    }
    const workRows = this.connection.prepare('SELECT works_json FROM topics WHERE ' + facetClauses.join(' AND ')).all(...facetParams as never[]) as Array<{ works_json?: string }>;
    const workCounts = new Map<string, number>();
    for (const row of workRows) {
      for (const work of parseJson<string[]>(row.works_json, [])) workCounts.set(work, (workCounts.get(work) ?? 0) + 1);
    }
    const kindRows = this.connection.prepare('SELECT kind, COUNT(*) count FROM topics WHERE ' + facetClauses.join(' AND ') + ' GROUP BY kind').all(...facetParams as never[]) as Array<{ kind?: string; count?: number }>;
    return {
      items: rows.map((row) => this.mapTopic(row)),
      total: Number(totalRow?.count ?? 0),
      page,
      pageSize,
      facets: {
        works: [...workCounts.keys()].sort((a, b) => a.localeCompare(b, 'zh')),
        kinds: kindRows.map((row) => ({ kind: normalizeKind(row.kind), count: Number(row.count ?? 0) })),
      },
    };
  }

  getTopic(id: string): Topic | null {
    const row = this.connection.prepare('SELECT * FROM topics WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTopic(row) : null;
  }

  getTopicDetail(id: string): TopicDetail | null {
    const topic = this.getTopic(id);
    if (!topic) return null;
    const rows = this.connection.prepare('SELECT * FROM topic_sources WHERE topic_id=? ORDER BY COALESCE(published_at, created_at) DESC').all(id) as Record<string, unknown>[];
    return { topic, sources: rows.map((row) => this.mapSource(row)) };
  }

  getTopicSources(topicIds: string[]): TopicSource[] {
    if (!topicIds.length) return [];
    const placeholders = topicIds.map(() => '?').join(',');
    const rows = this.connection.prepare('SELECT * FROM topic_sources WHERE topic_id IN (' + placeholders + ') ORDER BY COALESCE(published_at, created_at) DESC').all(...topicIds as never[]) as Record<string, unknown>[];
    return rows.map((row) => this.mapSource(row));
  }

  /** 收藏 / 忽略 / 恢复。忽略可以恢复，但再次搜集到同一话题不会自动取消忽略。 */
  updateTopicFlags(id: string, patch: { favorite?: boolean; ignored?: boolean }): Topic | null {
    const topic = this.getTopic(id);
    if (!topic) return null;
    const ignored = patch.ignored ?? topic.ignored;
    const favorite = patch.favorite ?? topic.favorite;
    this.connection.prepare('UPDATE topics SET favorite=?,ignored=?,ignored_at=?,updated_at=? WHERE id=?')
      .run(favorite ? 1 : 0, ignored ? 1 : 0, ignored ? nowIso() : null, nowIso(), id);
    return this.getTopic(id);
  }

  /** 归并写入一条素材：先按链接去重，再按标题指纹归并。 */
  upsertTopic(input: TopicUpsertInput): { topicId: string; result: 'created' | 'merged' | 'updated' } {
    const url = normalizeTopicUrl(input.source.url) || 'mcp://' + encodeURIComponent(input.source.sourceId || input.source.sourceName) + '/' + encodeURIComponent(input.source.documentLocator || input.source.title);
    const now = nowIso();
    const existingByUrl = url
      ? this.connection.prepare('SELECT topic_id FROM topic_sources WHERE url=? LIMIT 1').get(url) as { topic_id?: string } | undefined
      : undefined;
    // 只合并完全相同标题、相同作品的近期话题；相似前缀不能证明是同一事件。
    const recent = this.connection.prepare('SELECT id,title,works_json FROM topics WHERE last_seen_at>=?').all(new Date(Date.now() - 7 * 86400000).toISOString()) as Array<{ id: string; title: string; works_json: string }>;
    const existingByTitle = recent.find(row => topicTitleKey(row.title) === topicTitleKey(input.title) && JSON.stringify(asStringArray(parseJson(row.works_json, [])).sort()) === JSON.stringify(asStringArray(input.works).sort()));
    const target = input.targetTopicId && this.getTopic(input.targetTopicId) ? input.targetTopicId : null;
    const topicId = existingByUrl?.topic_id ?? target ?? existingByTitle?.id ?? null;
    if (!topicId && input.allowCreate === false) return { topicId: '', result: 'updated' };

    if (!topicId) {
      const id = crypto.randomUUID();
      this.connection.prepare(`INSERT INTO topics
        (id,title,summary,works_json,characters_json,kind,info_nature,adaptation_tags_json,first_seen_at,last_seen_at,favorite,ignored,ignored_at,used_activity_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,0,NULL,NULL,?,?)`)
        .run(
          id, input.title.slice(0, 200), input.summary.slice(0, 1_000),
          JSON.stringify(asStringArray(input.works, 20)), JSON.stringify(asStringArray(input.characters, 30)),
          normalizeKind(input.kind), normalizeNature(input.infoNature),
          JSON.stringify(asStringArray(input.adaptationTags, 3)), now, now, now, now,
        );
      this.upsertSource(id, url, input, now);
      return { topicId: id, result: 'created' };
    }

    const current = this.getTopic(topicId)!;
    const works = [...new Set([...current.works, ...asStringArray(input.works, 20)])].slice(0, 20);
    const characters = [...new Set([...current.characters, ...asStringArray(input.characters, 30)])].slice(0, 30);
    const tags = [...new Set([...current.adaptationTags, ...asStringArray(input.adaptationTags, 3)])].slice(0, 3);
    // 只刷新发现时间与补充字段，不改动收藏/忽略状态。
    this.connection.prepare('UPDATE topics SET works_json=?,characters_json=?,adaptation_tags_json=?,summary=?,last_seen_at=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(works), JSON.stringify(characters), JSON.stringify(tags), current.summary || input.summary.slice(0, 1_000), now, now, topicId);
    const before = url
      ? this.connection.prepare('SELECT id FROM topic_sources WHERE topic_id=? AND url=?').get(topicId, url) as { id?: string } | undefined
      : undefined;
    this.upsertSource(topicId, url, input, now);
    return { topicId, result: before ? 'merged' : 'updated' };
  }

  private upsertSource(topicId: string, url: string, input: TopicUpsertInput, now: string) {
    const hash = crypto.createHash('sha256').update(JSON.stringify({ url, excerpt: input.source.excerpt.slice(0, 2_000), title: input.source.title })).digest('hex');
    this.connection.prepare(`INSERT INTO topic_sources
      (id,topic_id,source_id,source_name,url,document_locator,title,published_at,excerpt,content_hash,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(topic_id,url) DO UPDATE SET
        source_name=excluded.source_name,document_locator=excluded.document_locator,title=excluded.title,
        published_at=COALESCE(excluded.published_at,topic_sources.published_at),excerpt=excluded.excerpt,
        content_hash=excluded.content_hash,updated_at=excluded.updated_at`)
      .run(
        crypto.randomUUID(), topicId, input.source.sourceId ?? null, input.source.sourceName.slice(0, 200),
        url, input.source.documentLocator.slice(0, 400), input.source.title.slice(0, 300),
        input.publishedAt ?? null, input.source.excerpt.slice(0, 4_000), hash, now, now,
      );
  }

  /** 标记素材已用于某场正式活动；只生成点子不会调用这里。 */
  markUsed(topicIds: string[], activityId: string): number {
    let changed = 0;
    for (const id of topicIds) {
      const result = this.connection.prepare('UPDATE topics SET used_activity_id=?,updated_at=? WHERE id=? AND (used_activity_id IS NULL OR used_activity_id<>?)')
        .run(activityId, nowIso(), id, activityId);
      changed += Number(result.changes);
    }
    return changed;
  }

  /** 清理 30 天前的原始检索候选；素材、收藏、已用与活动依据不受影响。 */
  pruneRawCandidates(days = 30): number {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const result = this.connection.prepare("UPDATE topic_collection_runs SET raw_candidates_json='[]' WHERE created_at < ? AND raw_candidates_json NOT IN ('[]','')").run(cutoff);
    return Number(result.changes);
  }

  private mapRun(row: Record<string, unknown>): TopicCollectionRun {
    return {
      id: String(row.id),
      status: String(row.status) as TopicCollectionRunStatus,
      trigger: String(row.trigger) as TopicCollectionRun['trigger'],
      ...(row.progress_label ? { progressLabel: String(row.progress_label) } : {}),
      usedToolCalls: Number(row.used_tool_calls ?? 0),
      createdCount: Number(row.created_count ?? 0),
      mergedCount: Number(row.merged_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
      settingsSnapshot: parseJson<Record<string, unknown>>(row.settings_snapshot_json, {}),
      ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
      ...(row.finished_at ? { finishedAt: String(row.finished_at) } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTopic(row: Record<string, unknown>): Topic {
    const id = String(row.id);
    const sourceRow = this.connection.prepare('SELECT COUNT(*) count, MAX(published_at) latest FROM topic_sources WHERE topic_id=?').get(id) as { count?: number; latest?: string | null } | undefined;
    return {
      id,
      title: String(row.title),
      summary: String(row.summary ?? ''),
      works: parseJson<string[]>(row.works_json, []),
      characters: parseJson<string[]>(row.characters_json, []),
      kind: normalizeKind(row.kind),
      infoNature: normalizeNature(row.info_nature),
      adaptationTags: parseJson<string[]>(row.adaptation_tags_json, []),
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      ...(sourceRow?.latest ? { latestPublishedAt: String(sourceRow.latest) } : {}),
      favorite: Boolean(row.favorite),
      ignored: Boolean(row.ignored),
      ...(row.ignored_at ? { ignoredAt: String(row.ignored_at) } : {}),
      ...(row.used_activity_id ? { usedActivityId: String(row.used_activity_id) } : {}),
      sourceCount: Number(sourceRow?.count ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapSource(row: Record<string, unknown>): TopicSource {
    return {
      id: String(row.id),
      topicId: String(row.topic_id),
      ...(row.source_id ? { sourceId: String(row.source_id) } : {}),
      sourceName: String(row.source_name ?? ''),
      url: String(row.url ?? '').startsWith('mcp://') ? '' : String(row.url ?? ''),
      documentLocator: String(row.document_locator ?? ''),
      title: String(row.title ?? ''),
      ...(row.published_at ? { publishedAt: String(row.published_at) } : {}),
      excerpt: String(row.excerpt ?? ''),
      contentHash: String(row.content_hash ?? ''),
      createdAt: String(row.created_at),
    };
  }
}
