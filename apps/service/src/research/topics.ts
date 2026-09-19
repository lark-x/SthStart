import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { SecretStore } from '../security.js';
import type { NarrativeCorpusProvider, ResearchScope } from './corpus.js';
import { ResearchStore, type TopicSuggestionRow } from './store.js';
import { RESEARCH_BUDGET } from './engine.js';
import { buildTopicSuggestionPrompt, parseTopicSuggestionsDetailed, type ParsedTopicSuggestion } from './prompts.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { callLlm } from '../activities/text-jobs.js';

export interface TopicSuggestionOptions {
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase;
  secrets: SecretStore;
  provider: NarrativeCorpusProvider;
  store: ResearchStore;
  fetcher: typeof fetch;
}

export interface TopicSuggestionResult {
  batchId: string;
  items: TopicSuggestionRow[];
  /** 扫描范围与丢弃原因都要如实返回，用户才知道候选为什么只有几条。 */
  scanned: { nodes: number; total: number; batches: number; modelCalls: number };
  discarded: Array<{ title: string; reason: string }>;
  scopeNote: string | null;
  incompleteReason: string | null;
}

function normalizeTitle(value: string): string {
  return value.replace(/[\s《》「」【】()（）,，。.、:：;；!！?？-]/g, '').toLowerCase();
}

/** 相似候选去重：标题归一化后包含关系即视为同一主题，保留先出现的。 */
export function dedupeSuggestions(items: ParsedTopicSuggestion[]): { kept: ParsedTopicSuggestion[]; dropped: ParsedTopicSuggestion[] } {
  const kept: ParsedTopicSuggestion[] = []; const dropped: ParsedTopicSuggestion[] = [];
  const keys: string[] = [];
  for (const item of items) {
    const key = normalizeTitle(item.title);
    const duplicate = keys.some((existing) => existing === key || (existing.length >= 4 && key.length >= 4 && (existing.includes(key) || key.includes(existing))));
    if (duplicate) { dropped.push(item); continue; }
    keys.push(key); kept.push(item);
  }
  return { kept, dropped };
}

/**
 * AI 选题：分层扫描本地节点 → 分批让模型提候选 → 用真实原文核对种子证据。
 * 核对不上的候选直接丢弃，避免模型凭常识编出「看起来合理」的主题。
 */
export async function suggestResearchTopics(
  options: TopicSuggestionOptions,
  input: { workId: string; scope: ResearchScope; existingTitles: string[] },
): Promise<TopicSuggestionResult> {
  const { provider, store, database, narrativeDatabase, secrets, fetcher } = options;
  const scope: ResearchScope = { ...input.scope, workId: input.workId };
  const workTitle = (narrativeDatabase.connection.prepare('SELECT title FROM narrative_works WHERE id=?').get(input.workId) as { title: string } | undefined)?.title ?? input.workId;
  const catalog = await provider.catalog({ workId: input.workId, nodeIds: scope.nodeIds, nodeKinds: scope.nodeKinds, limit: RESEARCH_BUDGET.topicMaxNodes });
  const scannable = catalog.items.filter((item) => item.utteranceCount > 0).slice(0, RESEARCH_BUDGET.topicMaxNodes);
  const discarded: Array<{ title: string; reason: string }> = [];
  if (!scannable.length) {
    return {
      batchId: '', items: [], scanned: { nodes: 0, total: catalog.items.length, batches: 0, modelCalls: 0 }, discarded,
      scopeNote: null, incompleteReason: '所选范围里没有可读取的原文，请先导入规范化 JSON 或放宽范围。',
    };
  }

  const profile = await resolveAssignedLlmProfile(database, secrets, 'narrative', 'text');
  if (!profile) {
    return {
      batchId: '', items: [], scanned: { nodes: 0, total: catalog.items.length, batches: 0, modelCalls: 0 }, discarded,
      scopeNote: null, incompleteReason: '没有可用的文本模型，请在「模型与公共服务」为叙事档案配置后重试。',
    };
  }

  const batchId = crypto.randomUUID();
  let modelCalls = 0;
  const collected: ParsedTopicSuggestion[] = [];
  let scopeNote: string | null = catalog.truncated ? `仅扫描了前 ${scannable.length} 个节点，结果不代表整部作品。` : null;

  for (let offset = 0; offset < scannable.length; offset += RESEARCH_BUDGET.topicBatchNodes) {
    if (modelCalls >= RESEARCH_BUDGET.topicMaxModelCalls) { scopeNote = scopeNote ?? `已达到 ${RESEARCH_BUDGET.topicMaxModelCalls} 次模型调用上限，仅扫描部分资料。`; break; }
    const batch = scannable.slice(offset, offset + RESEARCH_BUDGET.topicBatchNodes);
    const excerpts: Array<{ nodeTitle: string; nodeKind: string; excerpt: string }> = [];
    for (const entry of batch) {
      const document = await provider.read({ targetType: 'node', targetId: entry.nodeId, contextSize: 8 });
      if (!document) continue;
      excerpts.push({ nodeTitle: entry.title, nodeKind: entry.kind, excerpt: document.text.slice(0, RESEARCH_BUDGET.topicNodeChars) });
    }
    if (!excerpts.length) continue;
    try {
      const raw = await callLlm(profile, buildTopicSuggestionPrompt({
        workTitle, scopeLabel: describeScope(scope), scannedNodes: Math.min(offset + batch.length, scannable.length),
        totalNodes: catalog.items.length, batches: excerpts, existingTitles: input.existingTitles,
      }), fetcher);
      modelCalls += 1;
      const parsed = parseTopicSuggestionsDetailed(raw);
      collected.push(...parsed.kept);
      // 解析阶段丢弃的候选也要如实回报，否则用户只看到候选变少而不知原因。
      discarded.push(...parsed.dropped);
    } catch (error) {
      scopeNote = scopeNote ?? `部分批次生成失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /*
   * 种子证据必须能在本地原文里找到。模型给出的引文可能被改写，
   * 所以按「节点标题 + 引文片段」在语料里再检索一次来核对。
   */
  const verified: ParsedTopicSuggestion[] = [];
  for (const suggestion of collected) {
    const evidence: TopicSuggestionRow['seedEvidence'] = [];
    for (const seed of suggestion.seedEvidence) {
      const probe = seed.quote.slice(0, 24);
      const page = await provider.search({ workId: input.workId, text: probe, limit: 5 });
      const hit = page.items[0];
      if (!hit) continue;
      const document = await provider.read({ targetType: hit.targetType, targetId: hit.targetId, contextSize: 2 });
      if (!document) continue;
      evidence.push({ targetType: document.targetType, targetId: document.targetId, locator: document.locator, quote: document.text.slice(0, 400) });
    }
    if (!evidence.length) { discarded.push({ title: suggestion.title, reason: '候选引用的种子证据在本地原文里找不到。' }); continue; }
    verified.push({ ...suggestion, seedEvidence: suggestion.seedEvidence, ...{ evidence } });
  }

  const { kept, dropped } = dedupeSuggestions(verified);
  for (const item of dropped) discarded.push({ title: item.title, reason: '与其它候选主题重复。' });
  const selected = kept.slice(0, 10);

  const items = selected.length ? store.createSuggestionBatch({
    workId: input.workId, batchId,
    items: selected.map((item) => ({
      title: item.title, question: item.question, reason: item.reason,
      scope: { ...scope, keywords: [...new Set([...(scope.keywords ?? []), ...item.keywords])].slice(0, 12) },
      seedEvidence: (item as unknown as { evidence: TopicSuggestionRow['seedEvidence'] }).evidence,
    })),
  }) : [];

  return {
    batchId: items.length ? batchId : '', items,
    scanned: { nodes: scannable.length, total: catalog.items.length, batches: Math.ceil(scannable.length / RESEARCH_BUDGET.topicBatchNodes), modelCalls },
    discarded, scopeNote,
    incompleteReason: items.length ? null : '没有生成可用的候选主题，请调整范围或先补充原文。',
  };
}

function describeScope(scope: ResearchScope): string {
  const parts: string[] = [];
  if (scope.nodeKinds?.length) parts.push(`文档类型：${scope.nodeKinds.join('、')}`);
  if (scope.nodeIds?.length) parts.push(`选定 ${scope.nodeIds.length} 个节点`);
  if (scope.keywords?.length) parts.push(`关键词：${scope.keywords.join('、')}`);
  return parts.length ? parts.join('；') : '整个作品';
}
