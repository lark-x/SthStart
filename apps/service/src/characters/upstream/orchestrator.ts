import type {
  CharacterUpstreamResearchPreview,
  CharacterUpstreamResearchRequest,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../../config.js';
import type { ServiceDatabase } from '../../database.js';
import type { SecretStore } from '../../security.js';
import {
  cleanUpstreamQuery,
  createEmptyBundle,
  dedupeAssets,
  inferWorkTarget,
  isPreferredSource,
  type UpstreamCharacterBundle,
} from './types.js';
import { fetchYattaGenshinCharacter } from './yatta-adapter.js';
import { fetchStarRailResCharacter } from './starrailres-adapter.js';
import { fetchBwikiCharacter } from './bwiki-adapter.js';
import { fetchFandomCharacter, fetchMoegirlCharacter } from './fandom-moegirl-adapter.js';
import { fetchAkashaDialogueSlices } from './akasha-bridge.js';
import { synthesizeRpCharacter } from './rp-synthesizer.js';

function mergeBundle(base: UpstreamCharacterBundle, patch: Partial<UpstreamCharacterBundle> | null) {
  if (!patch) return;
  if (patch.resolvedName && (!base.resolvedName || base.resolvedName === base.resolvedWork)) {
    base.resolvedName = patch.resolvedName;
  }
  if (patch.resolvedWork && !base.resolvedWork) base.resolvedWork = patch.resolvedWork;
  if (patch.englishName && !base.englishName) base.englishName = patch.englishName;
  if (patch.birthday && (!base.birthday || base.birthday.status === 'unset')) base.birthday = patch.birthday;
  if (patch.originType) base.originType = patch.originType;
  if (patch.aliases?.length) base.aliases = [...new Set([...base.aliases, ...patch.aliases])];
  if (patch.facts?.length) base.facts.push(...patch.facts);
  if (patch.stories?.length) base.stories.push(...patch.stories);
  if (patch.voiceLines?.length) base.voiceLines.push(...patch.voiceLines);
  if (patch.dialogueSamples?.length) base.dialogueSamples.push(...patch.dialogueSamples);
  if (patch.sources?.length) base.sources.push(...patch.sources);
  if (patch.warnings?.length) base.warnings.push(...patch.warnings);

  if (patch.skinOrVariantCandidates?.length) {
    const existingNames = new Set(base.skinOrVariantCandidates.map((s) => s.name.trim()));
    for (const candidate of patch.skinOrVariantCandidates) {
      if (!existingNames.has(candidate.name.trim())) {
        existingNames.add(candidate.name.trim());
        base.skinOrVariantCandidates.push(candidate);
      } else {
        const existing = base.skinOrVariantCandidates.find((s) => s.name.trim() === candidate.name.trim());
        if (existing) {
          if (!existing.portraitUrl && candidate.portraitUrl) existing.portraitUrl = candidate.portraitUrl;
          if (!existing.avatarUrl && candidate.avatarUrl) existing.avatarUrl = candidate.avatarUrl;
          if (candidate.loreStory.length > existing.loreStory.length) existing.loreStory = candidate.loreStory;
        }
      }
    }
  }

  if (patch.assets?.length) base.assets.push(...patch.assets);
}

/**
 * 分层自适应多源采集编排：
 * - 原神：Yatta(故事/语音/皮肤) + BWiki(补全立绘) + 可选 Akasha MCP
 * - 星铁：StarRailRes(档案/SP形态/立绘) + BWiki(故事/语音) + 可选 Akasha MCP
 * - 崩坏三：BWiki(装甲/故事) + Fandom(装甲兜底) + 可选 Akasha MCP
 * - 其他作品：BWiki -> 萌娘百科 -> Fandom
 */
export async function runUpstreamCharacterResearch(
  database: ServiceDatabase,
  secrets: SecretStore,
  config: ServiceConfig | undefined,
  fetcher: typeof fetch,
  input: CharacterUpstreamResearchRequest,
): Promise<CharacterUpstreamResearchPreview> {
  const { name, work } = cleanUpstreamQuery(input.query, input.work);
  const target = inferWorkTarget(name, work);
  const prefer = input.preferSources;
  const bundle = createEmptyBundle(name, work);

  const tasks: Array<Promise<Partial<UpstreamCharacterBundle> | null>> = [];

  if (target === 'genshin' && isPreferredSource(prefer, 'yatta')) {
    tasks.push(fetchYattaGenshinCharacter(name, fetcher));
  }
  if (target === 'starrail' && isPreferredSource(prefer, 'starrailres')) {
    tasks.push(fetchStarRailResCharacter(name, fetcher));
  }
  if (isPreferredSource(prefer, 'bwiki')) {
    tasks.push(fetchBwikiCharacter(name, target, fetcher));
  }
  if (isPreferredSource(prefer, 'akasha-mcp')) {
    tasks.push(fetchAkashaDialogueSlices(name, target, config, fetcher));
  }

  const primaryResults = await Promise.all(tasks);
  for (const res of primaryResults) mergeBundle(bundle, res);

  // 若主源故事与语音均较薄（或非米系通用角色），自动触发萌娘百科与 Fandom 兜底
  const needFallback = bundle.stories.length === 0 || (target === 'bh3' && bundle.skinOrVariantCandidates.length === 0);
  if (needFallback) {
    const fallbacks: Array<Promise<Partial<UpstreamCharacterBundle> | null>> = [];
    if (isPreferredSource(prefer, 'moegirl')) {
      fallbacks.push(fetchMoegirlCharacter(name, bundle.resolvedWork || work, fetcher));
    }
    if (isPreferredSource(prefer, 'fandom')) {
      fallbacks.push(fetchFandomCharacter(bundle.englishName || name, target, fetcher));
    }
    const fallbackResults = await Promise.all(fallbacks);
    for (const res of fallbackResults) mergeBundle(bundle, res);
  }

  if (input.includeSkins === false) {
    bundle.skinOrVariantCandidates = bundle.skinOrVariantCandidates.filter((item) => item.classification === 'variant');
  }
  if (input.includeVariants === false) {
    bundle.skinOrVariantCandidates = bundle.skinOrVariantCandidates.filter((item) => item.classification === 'skin');
  }
  if (input.includeVoiceLines === false) {
    bundle.voiceLines = [];
  }

  bundle.assets = dedupeAssets(bundle.assets);

  const synthesized = await synthesizeRpCharacter(database, secrets, fetcher, bundle);

  const evidenceSummary = [
    bundle.sources.length ? `已汇聚 ${bundle.sources.length} 个数据源（${[...new Set(bundle.sources.map((s) => s.sourceType))].join(' / ')}）` : '暂无外部匹配来源',
    bundle.stories.length ? `故事段落 ${bundle.stories.length} 篇` : '',
    bundle.voiceLines.length ? `语音样本 ${bundle.voiceLines.length} 条` : '',
    bundle.dialogueSamples.length ? `剧情对白切片 ${bundle.dialogueSamples.length} 段` : '',
    synthesized.skinsAndVariants.length ? `形态/皮肤 ${synthesized.skinsAndVariants.length} 项` : '',
    bundle.assets.length ? `图像资产 ${bundle.assets.length} 张` : '',
  ].filter(Boolean).join(' · ');

  return {
    query: input.query,
    resolvedName: synthesized.draft.displayName || bundle.resolvedName,
    resolvedWork: synthesized.draft.work || bundle.resolvedWork,
    draft: synthesized.draft,
    tags: synthesized.tags,
    skinsAndVariants: synthesized.skinsAndVariants,
    assets: bundle.assets,
    sources: bundle.sources,
    evidenceSummary,
    warnings: [...new Set(synthesized.warnings)],
  };
}
