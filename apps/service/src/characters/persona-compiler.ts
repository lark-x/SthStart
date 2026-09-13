import {
  CHARACTER_AUDITION_FIELD_PATHS,
  CHARACTER_PERSONA_COMPILER_VERSION,
  buildCharacterVisualContext,
  buildCharacterContextSections,
  normalizeCharacterAppearance,
  toCharacterRuntime,
} from '@sthstart/contracts';

export { CHARACTER_PERSONA_COMPILER_VERSION, normalizeCharacterAppearance };

/**
 * V1 结构化外观的视觉提示词（兼容口径）。
 *
 * 只接受 V1 外观对象；新角色走 buildCharacterVisualContext。保留此函数是因为
 * 旧版本快照与「默认外观 + 设计服装（不含默认造型列表）」等调用点仍需逐字一致的旧输出。
 */
export function buildCharacterVisualPrompt(appearanceValue: unknown, outfitOverride?: string) {
  const appearance = normalizeCharacterAppearance(appearanceValue);
  const selectedOutfit = outfitOverride?.trim() || (appearance.defaultOutfitId && appearance.outfits.includes(appearance.defaultOutfitId)
    ? appearance.defaultOutfitId : appearance.outfits[0]) || '';
  return [
    appearance.description,
    appearance.hair && `发型与发色：${appearance.hair}`,
    appearance.eyes && `眼睛：${appearance.eyes}`,
    appearance.build && `体态：${appearance.build}`,
    appearance.stableFeatures?.length ? `稳定辨识特征：${appearance.stableFeatures.join('；')}` : '',
    selectedOutfit ? `服装：${selectedOutfit}` : '',
    appearance.accessories.length ? `配饰：${appearance.accessories.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 活动人物快照的人设投影。
 *
 * 只保存一次标准角色数据：V2 正文分节 + 统一外观 + 来源标识。不再附带整份
 * sourceSnapshot 副本；旧读取方需要的 V1 字段仍在此保留，且投影可被
 * toCharacterRuntime 直接还原。
 */
export function projectCharacterPersona(draft: unknown) {
  const runtime = toCharacterRuntime(draft);
  return {
    schemaVersion: runtime.schemaVersion,
    displayName: runtime.displayName,
    englishName: runtime.englishName,
    aliases: [...runtime.aliases],
    originType: runtime.originType,
    work: runtime.work,
    summary: runtime.summary,
    personaText: runtime.personaText,
    speechText: runtime.speechText,
    dialogueExamples: [...runtime.dialogueExamples],
    behaviorRules: runtime.behaviorRules,
    appearance: {
      baseText: runtime.appearance.baseText,
      defaultOutfitText: runtime.appearance.defaultOutfitText,
      stableFeatures: [...runtime.appearance.stableFeatures],
    },
    visualPrompt: buildCharacterVisualContext(runtime).text,
  };
}

/**
 * 试演提示词。
 *
 * 角色语义走与其他消费方相同的上下文构建器（规划 4.2），不再另拼一份 JSON 投影：
 * 同一个角色的试演、活动与邻舍导出因此看到同一份人设。
 *
 * 建议的 fieldPath 必须是 V2 草稿里真实存在的字段；旧版的 `/speech/tone` 这类 V1 路径
 * 在 V2 编辑器里没有对应控件，会让用户拿到无处可用的建议（规划 6.3）。
 */
export function buildAuditionPrompt(draft: unknown, scenario: string, feedback?: string) {
  const runtime = toCharacterRuntime(draft);
  const context = buildCharacterContextSections(runtime, { includeExamples: 2 });
  const characterBlock = [
    `角色：${runtime.displayName}${runtime.englishName ? `(${runtime.englishName})` : ''}`,
    runtime.work ? `来自《${runtime.work}》` : '',
    context.text,
    buildCharacterVisualContext(runtime).text,
  ].filter(Boolean).join('\n');

  return `你是严谨的角色试演编辑。请只根据下方已保存的人设和场景，输出一个 JSON 对象，不要输出 Markdown、解释或 JSON 以外的文字。

人设：
${characterBlock}

场景：${scenario}
${feedback ? `用户反馈：${feedback}` : ''}

输出格式示例（严格遵守字段名；output 是一次 30-120 字的角色回复；suggestions 是可选的逐字段修改建议；不能新增字段）：
{
  "output": "（自然、符合人设的短回复，不替用户做决定）",
  "suggestions": [
    {
      "fieldPath": "/speechText",
      "before": "（当前字段原文；没有修改建议时为空字符串）",
      "after": "（建议值；没有修改建议时为空字符串）",
      "reason": "（不超过 80 字，说明为什么建议；没有修改建议时为空字符串）"
    }
  ]
}
fieldPath 只允许取以下值：${CHARACTER_AUDITION_FIELD_PATHS.join('、')}。
严格只输出上述 JSON。`;
}
