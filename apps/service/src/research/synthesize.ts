import type { ServiceDatabase } from '../database.js';
import type { SecretStore } from '../security.js';
import type { NarrativeCorpusProvider } from './corpus.js';
import type { NarrativeDatabase } from '../narrative-database.js';
import { ResearchStore } from './store.js';
import { natureForClaims, unresolvedSynthesisIds } from './engine.js';
import { buildSynthesisPrompt, parseSynthesis } from './prompts.js';
import { resolveAssignedLlmProfile } from '../providers.js';
import { callLlm } from '../activities/text-jobs.js';

export interface SynthesizeOptions {
  database: ServiceDatabase;
  narrativeDatabase: NarrativeDatabase;
  secrets: SecretStore;
  provider: NarrativeCorpusProvider;
  store: ResearchStore;
  fetcher: typeof fetch;
}

export interface SynthesizeResult {
  ok: boolean;
  draftId?: string;
  reason?: string;
}

/**
 * 只用当前已接受的结论与有效证据重写总稿。
 * 不重跑检索：用户在审核页改的是结论，重跑检索既慢又会换掉他已经看过的证据。
 */
export async function regenerateSynthesis(
  options: SynthesizeOptions,
  projectId: string,
): Promise<SynthesizeResult> {
  const { store, database, secrets, fetcher } = options;
  const project = store.getProject(projectId);
  if (!project) return { ok: false, reason: '研究专题不存在。' };

  const accepted = store.listClaims({ projectId }).filter((claim) => claim.status === 'accepted');
  if (!accepted.length) return { ok: false, reason: '至少需要一条已接受的结论才能生成总稿。' };

  const profile = await resolveAssignedLlmProfile(database, secrets, 'narrative', 'text');
  if (!profile) return { ok: false, reason: '没有可用的文本模型，请在「模型与公共服务」为叙事档案配置。' };

  const workTitle = (options.narrativeDatabase.connection.prepare('SELECT title FROM narrative_works WHERE id=?').get(project.workId) as { title: string } | undefined)?.title ?? project.workId;

  // 每条结论带上自己的证据；同一处原文可能被多条结论引用，按目标去重后交给模型。
  const evidenceById = new Map<string, { id: string; locator: string; quote: string }>();
  const claimsForPrompt = accepted.map((claim) => {
    const evidence = store.listEvidenceForClaim(claim.id);
    for (const item of evidence) if (item.valid) evidenceById.set(item.id, { id: item.id, locator: item.locator, quote: item.quoteSnapshot });
    return {
      id: claim.id, title: claim.title, claimType: claim.claimType ?? 'open-question',
      body: claim.body, uncertainty: claim.uncertainty,
      evidenceIds: evidence.filter((item) => item.valid).map((item) => item.id),
    };
  });
  const evidence = [...evidenceById.values()];

  let synthesis;
  try {
    const raw = await callLlm(profile, buildSynthesisPrompt({
      workTitle, title: project.title, question: project.question,
      claims: claimsForPrompt, evidence,
    }), fetcher);
    synthesis = parseSynthesis(raw);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }

  // 悬空引用直接剔除，不让总稿带着不存在的证据 ID 进入发布检查。
  const validEvidenceIds = new Set(evidence.map((item) => item.id));
  const validClaimIds = new Set(claimsForPrompt.map((item) => item.id));
  const unresolved = unresolvedSynthesisIds(synthesis, { evidenceIds: validEvidenceIds, claimIds: validClaimIds });
  if (unresolved.evidence.length) {
    synthesis.sections = synthesis.sections.map((section) => ({ ...section, evidenceIds: section.evidenceIds.filter((id) => validEvidenceIds.has(id)) }));
    synthesis.evidenceIndex = synthesis.evidenceIndex.filter((entry) => validEvidenceIds.has(entry.evidenceId));
  }

  const draft = store.createDraft({
    projectId, runId: project.latestRunId, title: synthesis.title || project.title,
    summary: synthesis.summary, content: synthesis as unknown as Record<string, unknown>,
  });
  store.updateProject(projectId, { status: 'review' });
  return { ok: true, draftId: draft.id };
}

export { natureForClaims };
