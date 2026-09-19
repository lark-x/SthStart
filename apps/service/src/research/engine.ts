import type { NarrativeCorpusProvider, CorpusDocument, CorpusSearchHit, ResearchScope } from './corpus.js';
import type { ClaimType } from './store.js';

/** 检索预算：与提示词里的规模说明保持一致，超出时标记 incomplete。 */
export const RESEARCH_BUDGET = {
  /** 每个检索问题最多取多少命中。 */
  hitsPerQuery: 20,
  /** 全部查询合计最多保留多少候选。 */
  maxCandidates: 120,
  /** 去重后最多进入 AI 分析多少条。 */
  maxForAnalysis: 80,
  /** 最终有效证据上限。 */
  maxVerified: 40,
  /** 单条证据正文上限。 */
  maxEvidenceChars: 1_600,
  /** 选题扫描：每批节点数、总节点数、每节点字符数、模型调用上限。 */
  topicBatchNodes: 20,
  topicMaxNodes: 200,
  topicNodeChars: 1_200,
  topicMaxModelCalls: 12,
} as const;

export interface CandidateEvidence {
  targetType: 'utterance' | 'node' | 'document';
  targetId: string;
  nodeId: string | null;
  sceneId: string | null;
  locator: string;
  quote: string;
  contextBefore: string;
  contextAfter: string;
  contentHash: string;
  sourceVersion: Record<string, unknown>;
  /** 命中来源问题，便于审核时解释为什么这条会被检索到。 */
  fromQuery: string;
}

export function clip(text: string, limit: number = RESEARCH_BUDGET.maxEvidenceChars): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  return clean.length <= limit ? clean : clean.slice(0, limit) + '…';
}

/** 按标题匹配、实体匹配、正文匹配的优先级取舍，与计划里的预算顺序一致。 */
function rankHit(hit: CorpusSearchHit, keywords: string[]): number {
  const title = hit.title ?? '';
  let score = 0;
  if (keywords.some((word) => title.includes(word))) score += 100;
  if (hit.speaker && keywords.some((word) => hit.speaker!.includes(word))) score += 60;
  if (keywords.some((word) => (hit.excerpt ?? '').includes(word))) score += 20;
  return score;
}

/**
 * 执行一个检索问题：搜索 → 排序 → 读取上下文。
 * 读取失败不抛错，只是少一条候选，避免单个坏节点让整次运行失败。
 */
export async function retrieveForQuery(
  provider: NarrativeCorpusProvider,
  scope: ResearchScope,
  query: { question: string; keywords: string[]; nodeKinds?: string[] },
  onReadFailure?: (targetId: string, message: string) => void,
): Promise<CandidateEvidence[]> {
  const results: CandidateEvidence[] = [];
  const seen = new Set<string>();
  for (const keyword of query.keywords) {
    const page = await provider.search({
      workId: scope.workId, text: keyword, limit: RESEARCH_BUDGET.hitsPerQuery,
      ...(scope.nodeIds?.length ? { nodeIds: scope.nodeIds } : {}),
      ...(query.nodeKinds?.length ? { nodeKinds: query.nodeKinds } : scope.nodeKinds?.length ? { nodeKinds: scope.nodeKinds } : {}),
    });
    const ranked = [...page.items].sort((a, b) => rankHit(b, query.keywords) - rankHit(a, query.keywords));
    for (const hit of ranked) {
      const key = `${hit.targetType}:${hit.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const document = await provider.read({ targetType: hit.targetType, targetId: hit.targetId, contextSize: 3 });
        if (!document) continue;
        results.push(toCandidate(document, query.question));
      } catch (error) {
        onReadFailure?.(hit.targetId, error instanceof Error ? error.message : String(error));
      }
      if (results.length >= RESEARCH_BUDGET.hitsPerQuery) break;
    }
    if (results.length >= RESEARCH_BUDGET.hitsPerQuery) break;
  }
  return results;
}

export function toCandidate(document: CorpusDocument, fromQuery: string): CandidateEvidence {
  return {
    targetType: document.targetType, targetId: document.targetId,
    nodeId: document.nodeId, sceneId: document.sceneId,
    locator: document.locator,
    quote: clip(document.text), contextBefore: clip(document.contextBefore, 600), contextAfter: clip(document.contextAfter, 600),
    contentHash: document.contentHash,
    sourceVersion: document.sourceVersion as unknown as Record<string, unknown>,
    fromQuery,
  };
}

/** 合并多问题候选并去重；超预算时按命中质量截断。 */
export function mergeCandidates(batches: CandidateEvidence[][]): { items: CandidateEvidence[]; truncated: boolean } {
  const seen = new Set<string>();
  const items: CandidateEvidence[] = [];
  for (const batch of batches) {
    for (const candidate of batch) {
      const key = `${candidate.targetType}:${candidate.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key); items.push(candidate);
      if (items.length >= RESEARCH_BUDGET.maxCandidates) return { items, truncated: true };
    }
  }
  return { items, truncated: false };
}

/** 单批次去重，保留首次命中的来源问题。 */
export function dedupeCandidates(candidates: CandidateEvidence[]): CandidateEvidence[] {
  return mergeCandidates([candidates]).items;
}

export function analysisWindow(candidates: CandidateEvidence[]): { items: CandidateEvidence[]; truncated: boolean } {
  return candidates.length <= RESEARCH_BUDGET.maxForAnalysis
    ? { items: candidates, truncated: false }
    : { items: candidates.slice(0, RESEARCH_BUDGET.maxForAnalysis), truncated: true };
}

// ---------- 确定性证据校验 ----------

export interface ValidationContext {
  /** 本次运行里真实存在的证据 ID。 */
  availableEvidenceIds: Set<string>;
  /** 证据 ID → 冻结原文，用于检查引用片段是否真在证据里。 */
  evidenceQuotes: Map<string, string>;
}

export interface ClaimValidationResult {
  ok: boolean;
  /** 不通过时给出可读原因，运行详情里直接展示。 */
  reason?: string;
  /** 校验后确定的类型：证据不足的事实会被降级，而不是直接丢弃。 */
  effectiveType: ClaimType;
  evidenceIds: string[];
  counterEvidenceIds: string[];
}

/**
 * 结论卡的最低证据要求（计划 3.5）。
 * 关键点：模型把推论写成事实时降级为 inference，而不是接受它；
 * 完全没有证据的内容只能成为 open-question。
 */
export function validateClaim(
  claim: { claimType: string; body: string; uncertainty: string; evidenceIds: string[]; counterEvidenceIds: string[] },
  context: ValidationContext,
): ClaimValidationResult {
  const known = (ids: string[]) => ids.filter((id) => context.availableEvidenceIds.has(id));
  const missing = claim.evidenceIds.filter((id) => !context.availableEvidenceIds.has(id));
  const evidenceIds = known(claim.evidenceIds);
  const counterEvidenceIds = known(claim.counterEvidenceIds);
  if (missing.length) return { ok: false, reason: `引用了不存在的证据 ID：${missing.join('、')}`, effectiveType: 'open-question', evidenceIds, counterEvidenceIds };

  const declared = (['fact', 'inference', 'speculation', 'contradiction', 'open-question'].includes(claim.claimType)
    ? claim.claimType : 'open-question') as ClaimType;

  /*
   * 引用内容必须能在证据快照里找到：冻结快照为空说明这条证据没有可核对的原文，
   * 按无效处理。这里不做词面比对——模型会改写措辞，强比对会把有效结论判死。
   */
  const emptyQuotes = evidenceIds.filter((id) => !(context.evidenceQuotes.get(id) ?? '').trim());
  if (emptyQuotes.length) return { ok: false, reason: '引用的证据没有可核对的原文快照。', effectiveType: 'open-question', evidenceIds, counterEvidenceIds };

  if (declared === 'fact') {
    if (!evidenceIds.length) return { ok: false, reason: 'fact 结论没有任何有效证据。', effectiveType: 'open-question', evidenceIds, counterEvidenceIds };
    return { ok: true, effectiveType: 'fact', evidenceIds, counterEvidenceIds };
  }
  if (declared === 'inference') {
    if (evidenceIds.length < 2) return { ok: false, reason: 'inference 结论少于两条独立证据。', effectiveType: evidenceIds.length ? 'speculation' : 'open-question', evidenceIds, counterEvidenceIds };
    return { ok: true, effectiveType: 'inference', evidenceIds, counterEvidenceIds };
  }
  if (declared === 'contradiction') {
    if (evidenceIds.length + counterEvidenceIds.length < 2) return { ok: false, reason: 'contradiction 需要至少两条互相冲突的证据。', effectiveType: 'speculation', evidenceIds, counterEvidenceIds };
    return { ok: true, effectiveType: 'contradiction', evidenceIds, counterEvidenceIds };
  }
  if (declared === 'speculation') {
    if (!claim.uncertainty.trim()) return { ok: false, reason: 'speculation 必须写明不确定性。', effectiveType: 'open-question', evidenceIds, counterEvidenceIds };
    return { ok: true, effectiveType: 'speculation', evidenceIds, counterEvidenceIds };
  }
  return { ok: true, effectiveType: 'open-question', evidenceIds, counterEvidenceIds };
}

/** 证据数量与类型必须匹配；校验失败的结论不进审核区。 */
export function countByType(claims: Array<{ claimType: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const claim of claims) counts[claim.claimType] = (counts[claim.claimType] ?? 0) + 1;
  return counts;
}

/** 发布时的内容性质：只有全是 fact 才是 canon。 */
export function natureForClaims(claimTypes: string[]): 'canon' | 'unconfirmed' {
  if (!claimTypes.length) return 'unconfirmed';
  return claimTypes.every((type) => type === 'fact') ? 'canon' : 'unconfirmed';
}

/** 总稿只允许引用本次有效证据与结论；未解析的 ID 会阻止发布。 */
export function unresolvedSynthesisIds(
  synthesis: { sections: Array<{ evidenceIds: string[]; claimIds: string[] }>; evidenceIndex: Array<{ evidenceId: string }> },
  valid: { evidenceIds: Set<string>; claimIds: Set<string> },
): { evidence: string[]; claims: string[] } {
  const evidence = new Set<string>(); const claims = new Set<string>();
  for (const section of synthesis.sections) {
    for (const id of section.evidenceIds) if (!valid.evidenceIds.has(id)) evidence.add(id);
    for (const id of section.claimIds) if (!valid.claimIds.has(id)) claims.add(id);
  }
  for (const entry of synthesis.evidenceIndex) if (!valid.evidenceIds.has(entry.evidenceId)) evidence.add(entry.evidenceId);
  return { evidence: [...evidence], claims: [...claims] };
}
