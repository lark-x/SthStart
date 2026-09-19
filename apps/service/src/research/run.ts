import { randomUUID } from 'node:crypto';
import type { ServiceDatabase } from '../database.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import type { SecretStore } from '../security.js';
import type { NarrativeCorpusProvider, ResearchScope } from './corpus.js';
import { ResearchStore, type ClaimType, type ResearchClaimRow, type ResearchRunRow } from './store.js';
import {
  RESEARCH_BUDGET, analysisWindow, mergeCandidates, natureForClaims, retrieveForQuery, toCandidate,
  unresolvedSynthesisIds, validateClaim, type CandidateEvidence,
} from './engine.js';
import {
  buildClaimExtractionPrompt, buildQueryPlanPrompt, buildSynthesisPrompt, buildVerificationPrompt,
  parseClaims, parseQueryPlan, parseSynthesis, parseVerification,
} from './prompts.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { callLlm } from '../activities/text-jobs.js';

export interface ResearchRunOptions {
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase;
  secrets: SecretStore;
  provider: NarrativeCorpusProvider;
  store: ResearchStore;
  fetcher: typeof fetch;
}

export interface RunProgress { stage: string; label: string; usedModelCalls: number }

/** 被取消的运行不能被迟到的模型结果改回 running。 */
class RunCancelled extends Error {
  constructor() { super('运行已取消'); }
}

/**
 * 研究运行编排：阶段结果逐段落库，重试可以从最后一个有效阶段继续。
 * 模型调用失败只影响当前阶段，已有检索结果保留，状态标记为 incomplete。
 */
export async function executeResearchRun(
  options: ResearchRunOptions,
  runId: string,
  onProgress?: (progress: RunProgress) => void,
): Promise<ResearchRunRow | null> {
  const { store, provider, database, narrativeDatabase, secrets, fetcher } = options;
  const run = store.getRun(runId);
  if (!run) return null;
  const project = store.getProject(run.projectId);
  if (!project) return null;
  /*
   * 取消是不可逆的终态：编排入口先检查一次，
   * 否则下面把状态置为 running 会把刚取消的运行重新复活。
   */
  if (run.status === 'cancelled') return run;

  const scope: ResearchScope = { ...project.scope, workId: project.workId };
  const workTitle = (narrativeDatabase.connection.prepare('SELECT title FROM narrative_works WHERE id=?').get(project.workId) as { title: string } | undefined)?.title ?? project.workId;

  let usedModelCalls = run.usedModelCalls;
  let profile: Awaited<ReturnType<typeof resolveAssignedLlmProfile>> = null;
  const fail = (message: string, incomplete: string | null = null) => {
    store.updateRun(runId, { status: incomplete ? 'incomplete' : 'failed', errorMessage: message, incompleteReason: incomplete, finishedAt: new Date().toISOString(), usedModelCalls });
  };

  const isCancelled = () => store.getRun(runId)?.status === 'cancelled';
  const guard = () => { if (isCancelled()) throw new RunCancelled(); };

  try {
    // 置为 running 前再确认一次：编排可能在排队期间被用户取消。
    if (store.getRun(runId)?.status === 'cancelled') return store.getRun(runId);
    store.updateRun(runId, { status: 'running', stage: 'inventory', startedAt: run.startedAt ?? new Date().toISOString(), progressLabel: '检查本地语料', errorMessage: null, incompleteReason: null });
    onProgress?.({ stage: 'inventory', label: '检查本地语料', usedModelCalls });

    const version = await provider.version(scope);
    store.updateRun(runId, { corpusVersion: version as unknown as Record<string, unknown> });
    if (!version.utteranceCount) {
      fail('本地语料为空，无法开始研究。', '所选作品没有可检索的原文，请先导入规范化 JSON。');
      return store.getRun(runId);
    }
    guard();

    profile = await resolveAssignedLlmProfile(database, secrets, 'narrative', 'text');
    if (!profile) {
      fail('没有可用的文本模型。', '请在「模型与公共服务」为叙事档案配置文本模型后重试。');
      return store.getRun(runId);
    }
    store.updateRun(runId, { modelProfileId: profile.id });

    // ---- 检索计划 ----
    store.updateRun(runId, { stage: 'query-planning', progressLabel: '制定检索计划' });
    onProgress?.({ stage: 'query-planning', label: '制定检索计划', usedModelCalls });
    const keywords = project.scope.keywords ?? [];
    let plan: Array<Record<string, unknown>> = [];
    try {
      const raw = await callLlm(profile, buildQueryPlanPrompt({ workTitle, title: project.title, question: project.question, keywords, entities: [] }), fetcher);
      usedModelCalls += 1;
      plan = parseQueryPlan(raw) as unknown as Array<Record<string, unknown>>;
    } catch (error) {
      store.updateRun(runId, { usedModelCalls });
      fail(error instanceof Error ? error.message : String(error), '检索计划生成失败。');
      return store.getRun(runId);
    }
    guard();
    // 模型没有给出可用计划时退化为按关键词直检，避免整次运行白跑。
    if (!plan.length) plan = [{ question: project.question || project.title, keywords, nodeKinds: [], entities: [], stopCondition: '' }];
    store.updateRun(runId, { queryPlan: plan, stage: 'retrieval', progressLabel: '检索本地原文', usedModelCalls });

    // ---- 检索 ----
    onProgress?.({ stage: 'retrieval', label: '检索本地原文', usedModelCalls });
    const readFailures: string[] = [];
    const batches: CandidateEvidence[][] = [];
    for (const item of plan) {
      guard();
      const keywordsForQuery = Array.isArray(item.keywords) ? item.keywords.map(String) : [];
      const hits = await retrieveForQuery(provider, scope, {
        question: String(item.question ?? ''), keywords: keywordsForQuery.length ? keywordsForQuery : keywords,
        nodeKinds: Array.isArray(item.nodeKinds) ? item.nodeKinds.map(String) : [],
      }, (targetId, message) => readFailures.push(`${targetId}: ${message}`));
      batches.push(hits);
    }
    const merged = mergeCandidates(batches);
    store.updateRun(runId, { candidateEvidence: merged.items as unknown as unknown[], stage: 'evidence-expansion', progressLabel: '扩展上下文' });
    guard();

    // ---- 二跳扩展 ----
    onProgress?.({ stage: 'evidence-expansion', label: '扩展上下文', usedModelCalls });
    const seenIds = new Set(merged.items.map((item) => item.targetId));
    const terms = [...new Set([...keywords, ...plan.flatMap((item) => (Array.isArray(item.entities) ? item.entities.map(String) : []))])].filter((term) => term.length >= 2).slice(0, 6);
    if (terms.length && provider.related) {
      const related = await provider.related({ workId: scope.workId, terms, limit: 20, excludeIds: [...seenIds] });
      for (const hit of related.items) {
        if (seenIds.has(hit.targetId)) continue;
        seenIds.add(hit.targetId);
        try {
          const document = await provider.read({ targetType: hit.targetType, targetId: hit.targetId, contextSize: 3 });
          if (document) merged.items.push(toCandidate(document, '二跳扩展'));
        } catch (error) { readFailures.push(`${hit.targetId}: ${error instanceof Error ? error.message : String(error)}`); }
        if (merged.items.length >= RESEARCH_BUDGET.maxCandidates) break;
      }
    }
    guard();

    // ---- 证据落库 ----
    const window = analysisWindow(merged.items);
    const evidenceIdByTarget = new Map<string, string>();
    const quotes = new Map<string, string>();
    store.clearRunEvidence(runId);
    for (const candidate of window.items) {
      const evidenceId = store.upsertEvidence({
        projectId: run.projectId, runId, providerId: provider.id, workId: scope.workId,
        targetType: candidate.targetType, targetId: candidate.targetId, nodeId: candidate.nodeId, sceneId: candidate.sceneId,
        locator: candidate.locator, quoteSnapshot: candidate.quote, contextBefore: candidate.contextBefore,
        contextAfter: candidate.contextAfter, contentHash: candidate.contentHash, sourceVersion: candidate.sourceVersion,
      });
      evidenceIdByTarget.set(`${candidate.targetType}:${candidate.targetId}`, evidenceId);
      quotes.set(evidenceId, candidate.quote);
    }

    if (!window.items.length) {
      store.updateRun(runId, { status: 'incomplete', stage: 'retrieval', progressLabel: '没有检索到相关资料', incompleteReason: '本地原文里没有找到与该主题相关的片段，请调整关键词或范围。', finishedAt: new Date().toISOString(), usedModelCalls });
      return store.getRun(runId);
    }

    // ---- 结论卡 ----
    store.updateRun(runId, { stage: 'claim-extraction', progressLabel: '生成结论卡', usedModelCalls });
    onProgress?.({ stage: 'claim-extraction', label: '生成结论卡', usedModelCalls });
    const evidenceForPrompt = window.items.map((item) => ({
      id: evidenceIdByTarget.get(`${item.targetType}:${item.targetId}`)!, locator: item.locator, quote: item.quote,
    }));
    let parsedClaims: ReturnType<typeof parseClaims> = [];
    try {
      const raw = await callLlm(profile, buildClaimExtractionPrompt({ workTitle, title: project.title, question: project.question, evidence: evidenceForPrompt }), fetcher);
      usedModelCalls += 1;
      parsedClaims = parseClaims(raw);
    } catch (error) {
      store.updateRun(runId, { usedModelCalls });
      fail(error instanceof Error ? error.message : String(error), '结论卡生成失败，检索结果已保留。');
      return store.getRun(runId);
    }
    guard();

    // ---- 确定性校验 ----
    store.updateRun(runId, { stage: 'verification', progressLabel: '校验证据', usedModelCalls });
    onProgress?.({ stage: 'verification', label: '校验证据', usedModelCalls });
    const availableEvidenceIds = new Set(evidenceIdByTarget.values());
    const rejected: Array<{ title: string; reason: string }> = [];
    const accepted: Array<{ claim: ResearchClaimRow; evidenceIds: string[]; counterEvidenceIds: string[]; claimType: ClaimType }> = [];
    for (const claim of parsedClaims) {
      const mapped = {
        ...claim,
        evidenceIds: claim.evidenceIds.map((id) => evidenceIdByTarget.get(id) ?? id),
        counterEvidenceIds: claim.counterEvidenceIds.map((id) => evidenceIdByTarget.get(id) ?? id),
      };
      const validation = validateClaim(mapped, { availableEvidenceIds, evidenceQuotes: quotes });
      if (!validation.ok) { rejected.push({ title: claim.title, reason: validation.reason ?? '校验未通过' }); continue; }
      const created = store.createClaim({
        workId: scope.workId, projectId: run.projectId, runId, title: claim.title,
        claimType: validation.effectiveType, body: claim.body, explanation: claim.explanation,
        uncertainty: claim.uncertainty, origin: 'ai',
      });
      for (const evidenceId of validation.evidenceIds) store.linkEvidenceToClaim(evidenceId, created.id, 'support');
      for (const evidenceId of validation.counterEvidenceIds) store.linkEvidenceToClaim(evidenceId, created.id, 'counter');
      accepted.push({ claim: created, evidenceIds: validation.evidenceIds, counterEvidenceIds: validation.counterEvidenceIds, claimType: validation.effectiveType });
    }

    /*
     * 二次验证只调整类型与不确定说明。模型说「证据充分」但确定性校验已经降级时，
     * 以确定性校验为准——否则一次模型调用就能把 inference 抬回 fact。
     */
    if (accepted.length) {
      try {
        const raw = await callLlm(profile, buildVerificationPrompt({
          workTitle, title: project.title,
          claims: accepted.map((item) => ({ id: item.claim.id, title: item.claim.title, claimType: item.claim.claimType ?? 'open-question', body: item.claim.body, evidenceIds: item.evidenceIds })),
          evidence: evidenceForPrompt,
        }), fetcher);
        usedModelCalls += 1;
        const verifications = parseVerification(raw);
        for (const verification of verifications) {
          const target = accepted.find((item) => item.claim.id === verification.id);
          if (!target) continue;
          const allowed = ['fact', 'inference', 'speculation', 'contradiction', 'open-question'];
          const nextType = allowed.includes(verification.claimType) ? verification.claimType as ClaimType : target.claimType;
          // 降级永远允许；升级需要满足更严格的证据要求，这里只允许同级别调整。
          const severity: Record<ClaimType, number> = { fact: 0, inference: 1, contradiction: 2, speculation: 3, 'open-question': 4 };
          const effective = severity[nextType] < severity[target.claimType] ? target.claimType : nextType;
          const merged = verification.counterEvidenceIds.map((id) => evidenceIdByTarget.get(id) ?? id).filter((id) => availableEvidenceIds.has(id));
          store.setClaimVerification(target.claim.id, { claimType: effective, uncertainty: verification.uncertainty || target.claim.uncertainty });
          for (const evidenceId of merged) store.linkEvidenceToClaim(evidenceId, target.claim.id, 'counter');
          target.claimType = effective;
        }
      } catch {
        // 验证阶段失败不阻断：确定性校验已经保证了最低要求，只是缺少置信说明。
      }
    }
    guard();

    // ---- 总稿 ----
    store.updateRun(runId, { stage: 'synthesis', progressLabel: '撰写研究总稿', usedModelCalls });
    onProgress?.({ stage: 'synthesis', label: '撰写研究总稿', usedModelCalls });
    const claimsForSynthesis = accepted.map((item) => {
      const fresh = store.getClaim(item.claim.id)!;
      return { id: fresh.id, title: fresh.title, claimType: fresh.claimType ?? 'open-question', body: fresh.body, uncertainty: fresh.uncertainty, evidenceIds: item.evidenceIds };
    });
    try {
      const raw = await callLlm(profile, buildSynthesisPrompt({ workTitle, title: project.title, question: project.question, claims: claimsForSynthesis, evidence: evidenceForPrompt }), fetcher);
      usedModelCalls += 1;
      const synthesis = parseSynthesis(raw);
      const unresolved = unresolvedSynthesisIds(synthesis, { evidenceIds: availableEvidenceIds, claimIds: new Set(claimsForSynthesis.map((item) => item.id)) });
      if (unresolved.evidence.length) {
        // 未解析的证据 ID 直接剔除，而不是让总稿带着悬空引用进入审核。
        synthesis.sections = synthesis.sections.map((section) => ({ ...section, evidenceIds: section.evidenceIds.filter((id) => availableEvidenceIds.has(id)) }));
        synthesis.evidenceIndex = synthesis.evidenceIndex.filter((entry) => availableEvidenceIds.has(entry.evidenceId));
      }
      const draft = store.createDraft({ projectId: run.projectId, runId, title: synthesis.title || project.title, summary: synthesis.summary, content: synthesis as unknown as Record<string, unknown> });
      const claimTypes = claimsForSynthesis.map((item) => item.claimType);
      const synthesisMeta = {
        draftId: draft.id, nature: natureForClaims(claimTypes),
        rejectedClaims: rejected, readFailures: readFailures.slice(0, 20),
        truncated: { candidates: merged.truncated, analysis: window.truncated },
      };
      store.updateRun(runId, {
        stage: 'complete', status: accepted.length ? 'needs-review' : 'incomplete',
        progressLabel: accepted.length ? '等待审核' : '没有生成可用结论',
        synthesis: synthesisMeta, verifiedEvidence: evidenceForPrompt as unknown as unknown[],
        incompleteReason: accepted.length ? null : '所有结论都未通过证据校验，请调整主题或补充原文。',
        finishedAt: new Date().toISOString(), usedModelCalls,
      });
      store.updateProject(run.projectId, { status: 'review' });
    } catch (error) {
      store.updateRun(runId, { usedModelCalls });
      fail(error instanceof Error ? error.message : String(error), '总稿生成失败，结论卡已保留。');
      store.updateProject(run.projectId, { status: 'review' });
    }
    return store.getRun(runId);
  } catch (error) {
    if (error instanceof RunCancelled) {
      store.updateRun(runId, { status: 'cancelled', progressLabel: '运行已取消', finishedAt: new Date().toISOString(), usedModelCalls });
      return store.getRun(runId);
    }
    store.updateRun(runId, { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString(), usedModelCalls });
    return store.getRun(runId);
  }
}

/** 选题批次 ID 生成：一次扫描对应一个批次，便于回看候选来源。 */
export function newBatchId(): string { return randomUUID(); }
