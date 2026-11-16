import type {
  CharacterDraftV2,
  CharacterUpstreamSkinProposal,
} from '@sthstart/contracts';
import { normalizeCharacterDraft, stripMachineCharacterIndex, toCharacterRuntime } from '@sthstart/contracts';
import type { ServiceDatabase } from '../../database.js';
import type { SecretStore } from '../../security.js';
import { resolveAssignedLlmProfile, upstreamHeaders } from '../../providers.js';
import { resolveAppLlmBindingStatus } from '../../llm-status.js';
import { collectAiCallRedactionSecrets, fetchAuditedAiResponse, updateAiCallRecord } from '../../ai-call-trace.js';
import type { UpstreamCharacterBundle } from './types.js';

export interface SynthesizedRpResult {
  draft: CharacterDraftV2;
  tags: string[];
  skinsAndVariants: CharacterUpstreamSkinProposal[];
  warnings: string[];
}

function buildDeterministicDraft(bundle: UpstreamCharacterBundle): CharacterDraftV2 {
  const storyBlocks = bundle.stories
    .slice(0, 5)
    .map((s) => `### ${s.title}\n${s.content.slice(0, 900)}`)
    .join('\n\n');

  const rawPersona = [
    bundle.facts.length ? `### 基本档案\n${bundle.facts.join('\n')}` : '',
    storyBlocks,
  ]
    .filter(Boolean)
    .join('\n\n');

  const voiceExamples = bundle.voiceLines
    .slice(0, 4)
    .map((v) => `${v.title}：${v.text}`);
  const mergedExamples = [...voiceExamples, ...bundle.dialogueSamples].slice(0, 4);

  const defaultSkin = bundle.skinOrVariantCandidates.find((s) => s.isDefault) || bundle.skinOrVariantCandidates[0];

  return {
    schemaVersion: 2,
    displayName: bundle.resolvedName,
    englishName: bundle.englishName || '',
    aliases: bundle.aliases,
    originType: bundle.originType,
    work: bundle.resolvedWork,
    summary: bundle.facts.find((f) => f.startsWith('简介：'))?.replace(/^简介：/, '') || `${bundle.resolvedName}${bundle.resolvedWork ? `（${bundle.resolvedWork}）` : ''}角色档案`,
    personaText: stripMachineCharacterIndex(rawPersona),
    speechText: bundle.voiceLines.length
      ? `参考原生语音语流（已采样 ${bundle.voiceLines.length} 条），贴合原角色语气与措辞习惯。`
      : '',
    dialogueExamples: mergedExamples,
    behaviorRules: bundle.resolvedWork
      ? `严格保持《${bundle.resolvedWork}》世界观认知边界，不使用超出所处世界观的现代网络流行语或元叙事吐槽。`
      : '',
    appearance: {
      baseText: `${bundle.resolvedName}的标志性五官、发色、瞳色与体貌特征。`,
      defaultOutfitText: defaultSkin?.outfitDescription || '',
    },
    birthday: bundle.birthday || { status: 'unset', calendar: 'unknown' },
  };
}

export async function synthesizeRpCharacter(
  database: ServiceDatabase,
  secrets: SecretStore,
  fetcher: typeof fetch,
  bundle: UpstreamCharacterBundle,
): Promise<SynthesizedRpResult> {
  const warnings = [...bundle.warnings];
  const fallbackDraft = buildDeterministicDraft(bundle);

  const baseProposals: CharacterUpstreamSkinProposal[] = bundle.skinOrVariantCandidates.map((item) => ({
    id: item.id,
    name: item.name,
    classification: item.classification,
    ...(item.variantKind ? { variantKind: item.variantKind } : {}),
    outfitDescription: item.outfitDescription,
    loreStory: item.loreStory,
    avatarUrl: item.avatarUrl ?? null,
    portraitUrl: item.portraitUrl ?? null,
    source: item.source,
    isDefault: Boolean(item.isDefault),
    selected: true,
  }));

  const hasTextEvidence = bundle.facts.length > 0 || bundle.stories.length > 0 || bundle.voiceLines.length > 0 || bundle.dialogueSamples.length > 0;
  if (!hasTextEvidence) {
    warnings.push('上游未抓取到足够文本证据，已按基础查询生成占位草稿。');
    return { draft: fallbackDraft, tags: [], skinsAndVariants: baseProposals, warnings };
  }

  const bindingStatus = await resolveAppLlmBindingStatus(database, secrets, 'characters', 'text');
  const profile = bindingStatus.ready ? await resolveAssignedLlmProfile(database, secrets, 'characters', 'text') : null;
  if (!bindingStatus.ready || !profile?.model) {
    warnings.push('未配置角色文本模型，已保留上游结构化直采文本（配置后可自动提炼心理深度与防复读示例对话）。');
    return { draft: fallbackDraft, tags: [], skinsAndVariants: baseProposals, warnings };
  }

  const evidenceText = [
    bundle.facts.length ? `【基础事实】\n${bundle.facts.join('\n')}` : '',
    bundle.stories.length ? `【角色故事与资料】\n${bundle.stories.map((s) => `### ${s.title}\n${s.content}`).join('\n\n').slice(0, 12_000)}` : '',
    bundle.voiceLines.length ? `【原生语音样本】\n${bundle.voiceLines.map((v) => `- ${v.title}: ${v.text}`).join('\n').slice(0, 6_000)}` : '',
    bundle.dialogueSamples.length ? `【剧情实景对话切片】\n${bundle.dialogueSamples.join('\n---\n').slice(0, 4_000)}` : '',
    baseProposals.length
      ? `【待区分的皮肤与衍生形态】\n${baseProposals.map((s) => `- id:${s.id} | 名称:${s.name} | 初始分类:${s.classification} | 现有描述:${s.outfitDescription} | 现有故事:${s.loreStory}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const prompt = `你是资深的 RP 角色卡架构师与视觉设定编辑。请严格依据提供的上游原生资料，合成一张可用于「沉浸式 AI 故事推演」与「AI 生图/图生视频」的 V2 角色卡 JSON。
严禁编造与事实冲突的信息；严禁输出任何【MCP角色索引】字段。

核心要求：
1. personaText：用清晰的 ### 章节整理（如 ### 身份与背景、### 心理防御与软肋、### 核心动机与价值观、### 偏好与忌讳、### 重要关系态度），避免干瘪标签化。
2. speechText：提炼角色的语流节奏、常用称呼、语气词、以及日常 vs 紧张/防备时的语言切换特征（直接决定 AI 扮演沉浸感）。
3. dialogueExamples：输出 3~4 条防复读情境对话范例（每条格式为 "情境说明：\\n用户：...\\n角色：*动作描写* 台词"），重语气与节奏而非死背固定台词。
4. behaviorRules：写明世界观认知边界（角色不知道现代互联网/现实常识）与 OOC 防护底线。
5. appearance.baseText：仅描述稳定不变的体貌特征（发色、发型、瞳色、身形气质），不写具体某套衣服；appearance.defaultOutfitText：描述默认常态装扮。
6. skinUpdates：针对“待区分的皮肤与衍生形态”列表，请确保每一项都包含清晰具体的「服装描述 (outfitDescription，可直接给 AI 生图参考)」和「背景故事 (loreStory)」，并校对 classification（崩坏三装甲/星铁 SP/阶段形态填 "variant"，纯换装填 "skin"）。

请只输出纯 JSON（不要 markdown 代码块），结构如下：
{
  "displayName": "${bundle.resolvedName}",
  "englishName": "${bundle.englishName || ''}",
  "aliases": [],
  "originType": "${bundle.originType}",
  "work": "${bundle.resolvedWork}",
  "summary": "一句话精确概括角色身份与核心气质",
  "tags": ["3到6个高区分度标签，不要重复写作品名"],
  "personaText": "...",
  "speechText": "...",
  "dialogueExamples": ["...", "...", "..."],
  "behaviorRules": "...",
  "appearance": {
    "baseText": "...",
    "defaultOutfitText": "..."
  },
  "skinUpdates": [
    {
      "id": "原样保留输入 id",
      "classification": "variant 或 skin",
      "variantKind": "stage 或 sp 或 form（仅 variant 时填写）",
      "outfitDescription": "详细的视觉服装描写（颜色、剪裁、配饰、特征元素）",
      "loreStory": "该皮肤或阶段形态的背景故事与意义"
    }
  ]
}

上游采集资料：
${evidenceText}`;

  try {
    const requestBody = {
      ...profile.extraBody,
      model: profile.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: '你是严谨的角色资料编辑，只输出合法 JSON 对象。' },
        { role: 'user', content: prompt },
      ],
    };

    const audited = await fetchAuditedAiResponse(
      database,
      {
        applicationId: 'characters',
        feature: 'characters',
        businessEvent: 'character.upstream.synthesize',
        objectType: 'character',
        callType: 'llm',
        provider: profile.name,
        models: [profile.model],
        parameters: { temperature: 0.3 },
        positivePrompt: prompt,
        redactionSecrets: collectAiCallRedactionSecrets({
          secret: profile.secret,
          headers: profile.headers,
          extraBody: profile.extraBody,
        }),
      },
      fetcher,
      `${profile.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { ...profile.headers, ...upstreamHeaders(profile.secret) },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120_000),
      },
    );

    const payload = (await audited.response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!audited.response.ok) {
      throw new Error(payload.error?.message || `HTTP ${audited.response.status}`);
    }
    const raw = payload.choices?.[0]?.message?.content
      ?.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    if (!raw) throw new Error('empty_llm_synthesis');

    updateAiCallRecord(database, audited.callId, {
      responseText: raw,
      event: 'content_parsed',
      redactionSecrets: audited.redactionSecrets,
    });

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = toCharacterRuntime(normalizeCharacterDraft({
      schemaVersion: 2,
      displayName: parsed.displayName || bundle.resolvedName,
      englishName: parsed.englishName || bundle.englishName || '',
      aliases: Array.isArray(parsed.aliases) ? parsed.aliases : bundle.aliases,
      originType: parsed.originType === 'original' ? 'original' : bundle.originType,
      work: parsed.work || bundle.resolvedWork,
      summary: parsed.summary || fallbackDraft.summary,
      personaText: stripMachineCharacterIndex(String(parsed.personaText || fallbackDraft.personaText)),
      speechText: String(parsed.speechText || fallbackDraft.speechText),
      dialogueExamples: Array.isArray(parsed.dialogueExamples)
        ? parsed.dialogueExamples.map((x) => String(x)).filter(Boolean)
        : fallbackDraft.dialogueExamples,
      behaviorRules: String(parsed.behaviorRules || fallbackDraft.behaviorRules),
      appearance: parsed.appearance && typeof parsed.appearance === 'object'
        ? parsed.appearance
        : fallbackDraft.appearance,
      birthday: bundle.birthday || fallbackDraft.birthday,
    }));

    const draft: CharacterDraftV2 = {
      schemaVersion: 2,
      displayName: normalized.displayName,
      englishName: normalized.englishName,
      aliases: [...normalized.aliases],
      originType: normalized.originType,
      work: normalized.work,
      summary: normalized.summary,
      personaText: stripMachineCharacterIndex(normalized.personaText),
      speechText: normalized.speechText,
      dialogueExamples: [...normalized.dialogueExamples],
      behaviorRules: normalized.behaviorRules,
      appearance: {
        baseText: normalized.appearance.baseText,
        defaultOutfitText: normalized.appearance.defaultOutfitText,
      },
      birthday: bundle.birthday || fallbackDraft.birthday,
    };

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).trim()).filter((t) => t && t !== draft.work && t !== draft.displayName).slice(0, 8)
      : [];

    const updatesMap = new Map<string, Record<string, unknown>>();
    if (Array.isArray(parsed.skinUpdates)) {
      for (const item of parsed.skinUpdates) {
        if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') {
          updatesMap.set(String((item as Record<string, unknown>).id), item as Record<string, unknown>);
        }
      }
    }

    const enrichedProposals = baseProposals.map((proposal) => {
      const upd = updatesMap.get(proposal.id);
      if (!upd) return proposal;
      const cls = upd.classification === 'variant' || upd.classification === 'skin'
        ? upd.classification
        : proposal.classification;
      const vKind = cls === 'variant' && (upd.variantKind === 'stage' || upd.variantKind === 'sp' || upd.variantKind === 'form')
        ? upd.variantKind
        : proposal.variantKind;
      return {
        ...proposal,
        classification: cls,
        ...(vKind ? { variantKind: vKind } : {}),
        outfitDescription: String(upd.outfitDescription || proposal.outfitDescription).trim(),
        loreStory: String(upd.loreStory || proposal.loreStory).trim(),
      };
    });

    return { draft, tags, skinsAndVariants: enrichedProposals, warnings };
  } catch (error) {
    warnings.push(`RP 深度提炼降级为直采模式: ${error instanceof Error ? error.message : String(error)}`);
    return { draft: fallbackDraft, tags: [], skinsAndVariants: baseProposals, warnings };
  }
}
