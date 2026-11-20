import type { CharacterDraftV2, CharacterUpstreamSkinProposal } from '@sthstart/contracts';
import { stripMachineCharacterIndex } from '@sthstart/contracts';
import type { ServiceDatabase } from '../../database.js';
import type { SecretStore } from '../../security.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../../providers.js';
import { resolveAppLlmBindingStatus } from '../../llm-status.js';
import { collectAiCallRedactionSecrets, fetchAuditedAiResponse, updateAiCallRecord } from '../../ai-call-trace.js';
import type { UpstreamCharacterBundle } from './types.js';
import { cleanPersonaProse } from './local-persona-cards.js';

export interface SynthesizedRpResult {
  draft: CharacterDraftV2;
  tags: string[];
  skinsAndVariants: CharacterUpstreamSkinProposal[];
  warnings: string[];
}

export interface WorldActorCanonicalContext {
  background?: string;
  personality?: string;
  speechStyle?: string;
  appearance?: string;
  faction?: string;
  goals?: string[];
  worldName?: string;
}

export function buildDeterministicDraft(
  bundle: UpstreamCharacterBundle,
  worldContext?: WorldActorCanonicalContext,
): CharacterDraftV2 {
  const cleanStories = bundle.stories
    .slice(0, 5)
    .map((s) => `### ${s.title}\n${stripMachineCharacterIndex(s.content)}`);
  const worldSections: string[] = [];
  if (worldContext?.background) worldSections.push(`### 身份与经历\n${worldContext.background.trim()}`);
  if (worldContext?.personality) worldSections.push(`### 性格与处世\n${worldContext.personality.trim()}`);
  if (worldContext?.goals?.length) {
    worldSections.push(`### 核心诉求与行动线\n${worldContext.goals.map((g) => `- ${g}`).join('\n')}`);
  }
  const cleanFacts = bundle.facts
    .filter((f) => !f.startsWith('内部标识：'))
    .map((f) => cleanPersonaProse(f, bundle.resolvedName))
    .filter(Boolean);
  const rawPersona = [
    cleanFacts.length ? `### 基本档案\n${cleanFacts.map((f) => `- ${f}`).join('\n')}` : '',
    ...worldSections,
    ...cleanStories,
  ].filter(Boolean).join('\n\n');

  const defaultSkin = bundle.skinOrVariantCandidates.find((s) => s.isDefault);
  const voiceSamples = bundle.voiceLines
    .slice(0, 6)
    .map((v) => cleanPersonaProse(`${v.title}：${v.text}`, bundle.resolvedName))
    .filter(Boolean);
  const speechText = cleanPersonaProse(
    worldContext?.speechStyle?.trim()
      || (bundle.voiceLines.length
        ? `基于原生语音语料提炼：保持符合「${bundle.resolvedName}」身份、处境与性格节奏的自然口吻，避免空泛说教。`
        : ''),
    bundle.resolvedName,
  );

  const behaviorLines: string[] = [];
  if (worldContext?.worldName || bundle.resolvedWork) {
    behaviorLines.push(`【世界观认知边界】严格立足于「${bundle.resolvedWork || worldContext?.worldName}」本土设定，不了解也不使用跨次元/现代互联网梗或剧透视角。`);
  }
  if (worldContext?.faction) {
    behaviorLines.push(`【阵营与立场】所属「${worldContext.faction}」，言行需符合自身身份与长期立场。`);
  }
  if (worldContext?.goals?.length) {
    behaviorLines.push(`【核心行动底线】优先守护与推进：${worldContext.goals.join('、')}。`);
  }

  return {
    schemaVersion: 2, displayName: bundle.resolvedName, englishName: bundle.englishName || '', aliases: bundle.aliases,
    originType: bundle.originType, work: bundle.resolvedWork,
    summary: cleanPersonaProse(
      cleanFacts.find((f) => f.startsWith('简介：'))?.replace(/^简介：/, '')
        || worldContext?.background?.split('。')[0]
        || '',
      bundle.resolvedName,
    ),
    personaText: cleanPersonaProse(stripMachineCharacterIndex(rawPersona), bundle.resolvedName),
    speechText,
    dialogueExamples: [...voiceSamples, ...bundle.dialogueSamples.slice(0, 4).map((d) => cleanPersonaProse(d, bundle.resolvedName))].filter(Boolean),
    behaviorRules: cleanPersonaProse(behaviorLines.join('\n'), bundle.resolvedName),
    appearance: {
      baseText: cleanPersonaProse(bundle.appearanceText || worldContext?.appearance || '', bundle.resolvedName),
      defaultOutfitText: cleanPersonaProse(defaultSkin?.outfitDescription || '', bundle.resolvedName),
    },
    birthday: bundle.birthday || { status: 'unset', calendar: 'unknown' },
  };
}

export interface SynthesisEvidenceSegment { sourceId: string; text: string }
export interface SynthesisEvidenceChunk {
  id: string;
  /** Category used for request logging; field citations resolve to individual segments below. */
  sourceId: string;
  text: string;
  segments: SynthesisEvidenceSegment[];
}

/** Lossless character-boundary chunks. Complete raw sources remain separately available for snapshots. */
export function buildSynthesisEvidenceChunks(bundle: UpstreamCharacterBundle, maxCharacters = 18_000): SynthesisEvidenceChunk[] {
  if (maxCharacters < 2) throw new Error('invalid_evidence_chunk_size');
  const groups = [
    // Raw sources can include inactive wiki comments, unrelated navigation or a complete game index.
    // They are archived losslessly, while the model receives only the character evidence parsed below.
    { category: 'facts', blocks: [{ sourceId: 'facts', text: bundle.facts.join('\n') }] },
    { category: 'appearance', blocks: [{ sourceId: 'appearance', text: bundle.appearanceText || '' }] },
    { category: 'stories', blocks: bundle.stories.map((s, i) => ({ sourceId: `story:${i}:${s.source}`, text: `【${s.title}】\n${s.content}` })) },
    { category: 'voices', blocks: bundle.voiceLines.map((s, i) => ({ sourceId: `voice:${i}:${s.source}`, text: `【${s.title}】\n${s.text}` })) },
    { category: 'dialogues', blocks: bundle.dialogueSamples.map((text, i) => ({ sourceId: `dialogue:${i}`, text })) },
    { category: 'skins', blocks: bundle.skinOrVariantCandidates.map((s) => ({ sourceId: `skin:${s.id}`, text: `【${s.name}】\n${s.outfitDescription}\n${s.loreStory}` })) },
  ];
  const chunks: SynthesisEvidenceChunk[] = [];
  for (const group of groups) {
    let segments: SynthesisEvidenceSegment[] = []; let length = 0;
    const flush = () => {
      if (!segments.length) return;
      chunks.push({ id: `evidence:${chunks.length}`, sourceId: group.category, text: segments.map((s) => s.text).join('\n\n'), segments });
      segments = []; length = 0;
    };
    for (const block of group.blocks.filter((b) => b.text)) {
      let offset = 0;
      while (offset < block.text.length) {
        const separatorLength = segments.length ? 2 : 0;
        const capacity = maxCharacters - length - separatorLength;
        if (capacity < 2) { flush(); continue; }
        let end = Math.min(offset + capacity, block.text.length);
        // Never split a surrogate pair. Segments can always be reassembled byte-for-byte.
        if (end < block.text.length && /[\uD800-\uDBFF]/.test(block.text[end - 1])) end -= 1;
        const text = block.text.slice(offset, end);
        segments.push({ sourceId: block.sourceId, text }); length += separatorLength + text.length; offset = end;
        if (offset < block.text.length) flush();
      }
    }
    flush();
  }
  return chunks;
}

interface GroundedResponse {
  summary?: string; personaText?: string; speechText?: string; behaviorRules?: string;
  dialogueExamples?: string[]; appearance?: { baseText?: string; defaultOutfitText?: string };
  skinUpdates?: Array<{ id: string; outfitDescription?: string; loreStory?: string }>;
  evidence?: Array<{ field: string; quote: string; sourceId?: string }>;
}

/** A model may summarize evidence but must cite an exact quote from the current chunk for every accepted field. */
export function applyGroundedSynthesisResponse(parsed: GroundedResponse, chunk: SynthesisEvidenceChunk,
  draft: CharacterDraftV2, proposals: CharacterUpstreamSkinProposal[], warnings: string[]): void {
  const citations = new Map<string, { quote: string; sourceId: string }>();
  for (const ref of parsed.evidence || []) {
    if (typeof ref?.field !== 'string' || typeof ref?.quote !== 'string' || ref.quote.trim().length < 4) continue;
    // A quote spanning two sources is not evidence. Ambiguous same-text sources require an explicit ID.
    const matches = chunk.segments.filter((s) => (!ref.sourceId || s.sourceId === ref.sourceId) && s.text.includes(ref.quote));
    if (matches.length === 1) citations.set(ref.field, { quote: ref.quote, sourceId: matches[0].sourceId });
  }
  const supported = (field: string, value: unknown): value is string => {
    if (typeof value !== 'string' || !value.trim()) return false;
    if (!citations.has(field)) { warnings.push(`LLM 字段 ${field} 缺少可核对的原文引证，已拒绝。`); return false; }
    return true;
  };
  const mark = (_field: string, text: string) => cleanPersonaProse(stripMachineCharacterIndex(text.trim()), draft.displayName);
  if (supported('summary', parsed.summary) && !draft.summary) draft.summary = parsed.summary.trim();
  for (const field of ['personaText', 'speechText', 'behaviorRules'] as const) {
    if (supported(field, parsed[field])) draft[field] = [draft[field], mark(field, parsed[field]!)].filter(Boolean).join('\n\n');
  }
  if (Array.isArray(parsed.dialogueExamples)) parsed.dialogueExamples.forEach((text, i) => {
    // Exact quotations only. Generated lines may be useful creative suggestions but cannot masquerade as native dialogue.
    if (supported(`dialogueExamples.${i}`, text) && chunk.segments.some((s) => s.sourceId === citations.get(`dialogueExamples.${i}`)!.sourceId && s.text.includes(text))) draft.dialogueExamples.push(mark(`dialogueExamples.${i}`, text));
    else if (typeof text === 'string' && text.trim()) warnings.push('LLM 对话示例并非原文，未纳入原生对白。');
  });
  for (const field of ['baseText', 'defaultOutfitText'] as const) {
    const text = parsed.appearance?.[field];
    // Visual facts are especially vulnerable to hallucination: require an extractive span, not a generic citation.
    if (supported(`appearance.${field}`, text)) {
      const sourceId = citations.get(`appearance.${field}`)!.sourceId;
      if (chunk.segments.some((s) => s.sourceId === sourceId && s.text.includes(text)) && (field === 'baseText' ? sourceId === 'appearance' : proposals.some((p) => p.isDefault && sourceId === `skin:${p.id}`))) draft.appearance[field] ||= text;
      else warnings.push(`LLM 外貌字段 ${field} 不是上游原文，已拒绝。`);
    }
  }
  for (const item of parsed.skinUpdates || []) {
    const proposal = proposals.find((p) => p.id === item.id);
    if (!proposal) { warnings.push(`LLM 返回了未检索到的形态 ID，已拒绝。`); continue; }
    for (const field of ['outfitDescription', 'loreStory'] as const) {
      const text = item[field];
      // Classification and identity are authoritative adapter facts, never decided by a text model.
      if (supported(`skinUpdates.${item.id}.${field}`, text)) {
        const sourceId = citations.get(`skinUpdates.${item.id}.${field}`)!.sourceId;
        if (sourceId === `skin:${item.id}` && chunk.segments.some((s) => s.sourceId === sourceId && s.text.includes(text))) proposal[field] ||= text;
        else warnings.push(`LLM ${proposal.name} 的 ${field} 无对应原文，已拒绝。`);
      }
    }
  }
}

export async function synthesizeRpCharacter(database: ServiceDatabase, secrets: SecretStore, fetcher: typeof fetch,
  bundle: UpstreamCharacterBundle): Promise<SynthesizedRpResult> {
  const warnings = [...bundle.warnings];
  const fallbackDraft = buildDeterministicDraft(bundle);
  const proposals: CharacterUpstreamSkinProposal[] = bundle.skinOrVariantCandidates.map((item) => ({ ...item,
    avatarUrl: item.avatarUrl ?? null, portraitUrl: item.portraitUrl ?? null, isDefault: Boolean(item.isDefault), selected: true }));
  if (!bundle.appearanceText) warnings.push('上游未提供可核验的稳定体貌文字，外貌字段留空；图像存在不等于已读取图像内容。');
  if (!bundle.skinOrVariantCandidates.some((s) => s.isDefault && s.outfitDescription)) warnings.push('缺少默认衣装的明确文字证据，默认服饰描述留空。');
  const chunks = buildSynthesisEvidenceChunks(bundle);
  if (!chunks.length) {
    warnings.push('上游未抓取到可核验文本，草稿缺少资料，尚不能作为完整角色档案。');
    return { draft: fallbackDraft, tags: [], skinsAndVariants: proposals, warnings };
  }
  const status = await resolveAppLlmBindingStatus(database, secrets, 'characters', 'text');
  const profile = status.ready ? await resolveAssignedLlmProfile(database, secrets, 'characters', 'text') : null;
  if (!profile?.model) {
    warnings.push('未配置角色文本模型，已保留上游完整直采文本及原文对话；心理深度与语流提炼尚未完成。');
    return { draft: fallbackDraft, tags: [], skinsAndVariants: proposals, warnings };
  }
  // Every chunk is visited. Raw evidence is preserved even if a chunk fails or the model omits content.
  const draft: CharacterDraftV2 = { ...fallbackDraft, appearance: { ...fallbackDraft.appearance }, dialogueExamples: [...fallbackDraft.dialogueExamples] };
  for (const chunk of chunks) {
    const prompt = `你是严谨的角色资料编辑。角色 ${JSON.stringify(bundle.resolvedName)}，作品 ${JSON.stringify(bundle.resolvedWork)}。
只依据本块资料输出 JSON；未知信息留空。不得改变身份、猜测衣装、编造故事或把图片路径当视觉证据。
可以整理心理动机、关系态度、语流、认知边界，但每个输出字段必须在 evidence 给出本块逐字 quote 及对应片段的 sourceId。不能混用不同角色形态的证据。
对话示例、外貌、服饰和形态故事只允许逐字摘录。身份及 skin classification 不由模型修改。
形态列表：${JSON.stringify(proposals.map((p) => ({ id: p.id, name: p.name })))}
输出结构：{"summary":"","personaText":"","speechText":"","behaviorRules":"","dialogueExamples":[],"appearance":{"baseText":"","defaultOutfitText":""},"skinUpdates":[],"evidence":[{"field":"personaText","sourceId":"对应片段sourceId","quote":"该片段连续原文"}]}。
skinUpdates 如有字段使用 {id,outfitDescription,loreStory}，引证 field 为 skinUpdates.<id>.<字段>；数组引证如 dialogueExamples.0。
资料类别 ${chunk.sourceId}，分块 ${chunk.id}，下列 JSON 数组每个片段均保留独立来源：
${JSON.stringify(chunk.segments)}`;
    try {
      const audited = await fetchAuditedAiResponse(database, { applicationId: 'characters', feature: 'characters',
        businessEvent: 'character.upstream.synthesize', objectType: 'character', callType: 'llm', provider: profile.name,
        models: [profile.model], parameters: { temperature: 0.1, evidenceChunk: chunk.id, sourceId: chunk.sourceId, evidenceSourceIds: chunk.segments.map((s) => s.sourceId) }, positivePrompt: prompt,
        redactionSecrets: collectAiCallRedactionSecrets({ secret: profile.secret, headers: profile.headers, extraBody: profile.extraBody }),
      }, fetcher, `${profile.baseUrl}/chat/completions`, { method: 'POST',
        headers: { ...profile.headers, ...upstreamHeaders(profile.secret) },
        body: JSON.stringify({ ...profile.extraBody, model: profile.model, temperature: 0.1,
          messages: [{ role: 'system', content: '只输出合法JSON对象。每个事实字段须有本次资料的逐字引证。' }, { role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(120_000) });
      const payload = await audited.response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
      if (!audited.response.ok) throw new Error(payload.error?.message || `HTTP ${audited.response.status}`);
      const raw = payload.choices?.[0]?.message?.content?.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      if (!raw) throw new Error('empty_llm_synthesis');
      updateAiCallRecord(database, audited.callId, { responseText: raw, event: 'content_parsed', redactionSecrets: audited.redactionSecrets });
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_llm_synthesis_object');
      applyGroundedSynthesisResponse(parsed as GroundedResponse, chunk, draft, proposals, warnings);
    } catch (error) { warnings.push(`RP 分块 ${chunk.id} 提炼失败，完整原文已保留: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { draft, tags: [], skinsAndVariants: proposals, warnings: [...new Set(warnings)] };
}
