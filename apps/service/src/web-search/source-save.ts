import type { WebSearchResult } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { contentHashOf, KnowledgeStore } from '../knowledge/store.js';
import { KnowledgeCollectionStore } from '../knowledge/collections.js';
import { isPublicHttpUrl, siteNameForUrl } from './urls.js';

export type SaveWebSearchSourceResult = { id: string };

const MAX_EXCERPT = 8_000;
const MANUAL_COLLECTION_NAME = '网页另存';
const MANUAL_COLLECTION_GOAL = 'SthStart 网页搜索手动另存';

export class WebSearchSourceSaveError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'WebSearchSourceSaveError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sourceLabel(item: WebSearchResult) {
  if (item.status === 'failed') return '[提取失败，仅保存搜索摘要] ';
  if (item.status === 'snippet') return '[搜索摘要] ';
  return '';
}

function sourceBody(item: WebSearchResult) {
  if (item.status === 'extracted' && item.content.trim()) return item.content;
  if (item.snippet.trim()) return item.snippet;
  if (item.content.trim()) return item.content;
  throw new WebSearchSourceSaveError(
    'web_search_source_empty',
    '该搜索结果没有可保存的摘要或正文。',
  );
}

export function buildSavedExcerpt(item: WebSearchResult) {
  const label = sourceLabel(item);
  const body = sourceBody(item);
  let suffix = item.truncated ? '\n\n[内容已截断]' : '';
  let available = MAX_EXCERPT - label.length - suffix.length;
  const cut = body.length > available;
  if (cut) {
    suffix = '\n\n[内容已截断，仅保存可容纳的部分]';
    available = MAX_EXCERPT - label.length - suffix.length;
  }
  const excerpt = label + body.slice(0, Math.max(0, available)).trimEnd() + suffix;
  return {
    excerpt: excerpt.slice(0, MAX_EXCERPT),
    truncated: item.truncated || cut,
  };
}

function ensureManualCollection(database: ServiceDatabase, collections: KnowledgeCollectionStore) {
  const row = database.connection.prepare('SELECT id FROM knowledge_collections WHERE goal=? ORDER BY created_at LIMIT 1')
    .get(MANUAL_COLLECTION_GOAL) as { id?: string } | undefined;
  if (row?.id) {
    const collection = collections.get(row.id);
    if (collection) return collection;
  }
  return collections.save({
    name: MANUAL_COLLECTION_NAME,
    goal: MANUAL_COLLECTION_GOAL,
    mode: 'topic',
    frequency: 'once',
    dailyTime: '09:00',
    timezone: 'Asia/Shanghai',
    enabled: false,
    sources: [],
  });
}

export function saveWebSearchSource(
  database: ServiceDatabase,
  item: WebSearchResult,
): SaveWebSearchSourceResult {
  if (!isPublicHttpUrl(item.url)) {
    throw new WebSearchSourceSaveError(
      'invalid_web_search_url',
      '只能保存 http/https 公共网址，不接受本机、内网或字面 IP 地址。',
    );
  }
  if (item.url.length > 500) {
    throw new WebSearchSourceSaveError(
      'web_search_url_too_long',
      '该网址超出资料库可保存的长度。',
    );
  }

  const { excerpt, truncated } = buildSavedExcerpt(item);
  const title = (item.title.trim() || item.url).slice(0, 300);
  const sourceName = (item.siteName.trim() || siteNameForUrl(item.url)).slice(0, 200);
  const hash = contentHashOf(excerpt);

  return database.transaction(() => {
    const knowledge = new KnowledgeStore(database);
    const collections = new KnowledgeCollectionStore(database);
    const collection = ensureManualCollection(database, collections);

    const sourceId = knowledge.upsertSource({
      kind: 'web',
      url: item.url,
      title,
      sourceName,
      nature: 'unconfirmed',
    });
    const version = knowledge.recordSourceVersion(sourceId, {
      title,
      excerpt,
      truncated,
      contentHash: hash,
    });

    const existing = database.connection.prepare(
      'SELECT id FROM knowledge_pending_items WHERE collection_id=? AND source_version_id=? LIMIT 1',
    ).get(collection.id, version.versionId) as { id?: string } | undefined;
    if (existing?.id) {
      collections.setPendingState([existing.id], 'kept');
      return { id: existing.id };
    }

    const run = collections.createRun({
      collectionId: collection.id,
      trigger: 'manual',
      settingsSnapshot: { kind: 'web-search-save', sourceId, sourceVersionId: version.versionId },
    });
    const pending = collections.addPending({
      runId: run.id,
      collectionId: collection.id,
      sourceVersionId: version.versionId,
      characters: [],
      changeType: version.changeType === 'changed' ? 'changed' : 'new',
    });
    collections.setPendingState([pending.pendingId], 'kept');
    collections.updateRun(run.id, {
      status: 'succeeded',
      progressLabel: '已另存',
      newCount: 1,
      startedAt: nowIso(),
      finishedAt: nowIso(),
    });
    return { id: pending.pendingId };
  });
}
