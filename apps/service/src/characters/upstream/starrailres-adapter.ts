import crypto from 'node:crypto';
import type { UpstreamCharacterBundle } from './types.js';

interface StarRailCharacterItem {
  id: string;
  name: string;
  tag?: string;
  rarity?: number;
  path?: string;
  element?: string;
  icon?: string;
  preview?: string;
  portrait?: string;
}

const STAR_RAIL_RES_RAW = 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master';

let cachedHsrCharacters: { data: Record<string, StarRailCharacterItem>; expiresAt: number } | null = null;
let cachedHsrNicknames: { data: Record<string, string[]>; expiresAt: number } | null = null;

const PATH_NAMES: Record<string, string> = {
  Knight: '存护',
  Rogue: '巡猎',
  Mage: '智识',
  Priest: '丰饶',
  Warlock: '虚无',
  Shaman: '同谐',
  Warrior: '毁灭',
  Memory: '记忆',
};

const ELEMENT_NAMES: Record<string, string> = {
  Physical: '物理',
  Fire: '火',
  Ice: '冰',
  Thunder: '雷',
  Wind: '风',
  Quantum: '量子',
  Imaginary: '虚数',
};

/** 已知同角色基础形态与 SP 形态的归属映射，确保识别为衍生形态 (sp)。 */
const KNOWN_SP_GROUPS: ReadonlyArray<{ base: string; sp: string[] }> = [
  { base: '丹恒', sp: ['丹恒•饮月', '丹恒·饮月', '丹恒•腾荒', '丹恒·腾荒'] },
  { base: '三月七', sp: ['三月七•巡猎', '三月七·巡猎', '长夜月'] },
  { base: '停云', sp: ['忘归人'] },
  { base: '黑塔', sp: ['大黑塔'] },
];

async function loadStarRailCharacters(fetcher: typeof fetch) {
  if (cachedHsrCharacters && cachedHsrCharacters.expiresAt > Date.now()) {
    return cachedHsrCharacters.data;
  }
  const res = await fetcher(`${STAR_RAIL_RES_RAW}/index_min/cn/characters.json`, {
    headers: { 'User-Agent': 'SthStart/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`starrailres_http_${res.status}`);
  const data = (await res.json()) as Record<string, StarRailCharacterItem>;
  cachedHsrCharacters = { data, expiresAt: Date.now() + 30 * 60_000 };
  return data;
}

async function loadStarRailNicknames(fetcher: typeof fetch) {
  if (cachedHsrNicknames && cachedHsrNicknames.expiresAt > Date.now()) {
    return cachedHsrNicknames.data;
  }
  try {
    const res = await fetcher(`${STAR_RAIL_RES_RAW}/index_min/cn/nickname.json`, {
      headers: { 'User-Agent': 'SthStart/1.0' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { characters?: Record<string, string[]> };
    const data = json.characters || {};
    cachedHsrNicknames = { data, expiresAt: Date.now() + 30 * 60_000 };
    return data;
  } catch {
    return {};
  }
}

export async function fetchStarRailResCharacter(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const needle = name.trim().replace(/·/g, '•').toLowerCase();
  if (!needle) return null;

  try {
    const [chars, nicknames] = await Promise.all([
      loadStarRailCharacters(fetcher),
      loadStarRailNicknames(fetcher),
    ]);
    const list = Object.values(chars).filter((item) => item.name && item.name !== '{NICKNAME}');
    const normalize = (s: string) => s.replace(/[·•\s]/g, '').toLowerCase();
    const compactNeedle = normalize(needle);

    const matched = list.find((c) => normalize(c.name) === compactNeedle || normalize(c.tag || '') === compactNeedle)
      || list.find((c) => (nicknames[c.id] || []).some((n) => normalize(n) === compactNeedle))
      || list.find((c) => normalize(c.name).includes(compactNeedle));

    if (!matched) return null;

    const facts: string[] = [];
    if (matched.path) facts.push(`命途：${PATH_NAMES[matched.path] || matched.path}`);
    if (matched.element) facts.push(`属性：${ELEMENT_NAMES[matched.element] || matched.element}`);
    if (matched.rarity) facts.push(`星级：${matched.rarity}星`);
    if (matched.tag) facts.push(`内部标识：${matched.tag}`);

    const assets: UpstreamCharacterBundle['assets'] = [];
    const avatarUrl = matched.icon ? `${STAR_RAIL_RES_RAW}/${matched.icon}` : null;
    const portraitUrl = matched.portrait ? `${STAR_RAIL_RES_RAW}/${matched.portrait}` : null;
    const previewUrl = matched.preview ? `${STAR_RAIL_RES_RAW}/${matched.preview}` : null;

    if (avatarUrl) {
      assets.push({
        id: crypto.randomUUID(),
        kind: 'avatar',
        category: 'avatar',
        title: `${matched.name} 官方头像`,
        url: avatarUrl,
        previewUrl: avatarUrl,
        source: 'StarRailRes',
        recommended: true,
      });
    }
    if (portraitUrl) {
      assets.push({
        id: crypto.randomUUID(),
        kind: 'portrait',
        category: 'portrait',
        title: `${matched.name} 官方全身立绘`,
        url: portraitUrl,
        previewUrl: portraitUrl,
        source: 'StarRailRes',
        recommended: true,
      });
    }
    if (previewUrl && previewUrl !== portraitUrl) {
      assets.push({
        id: crypto.randomUUID(),
        kind: 'reference',
        category: 'concept',
        title: `${matched.name} 角色展示图`,
        url: previewUrl,
        previewUrl,
        source: 'StarRailRes',
      });
    }

    // 识别关联的 SP 形态，生成衍生形态候选
    const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
    const spGroup = KNOWN_SP_GROUPS.find(
      (g) => normalize(g.base) === normalize(matched.name) || g.sp.some((sp) => normalize(sp) === normalize(matched.name)),
    );
    if (spGroup) {
      const siblingNames = [spGroup.base, ...spGroup.sp].filter((n) => normalize(n) !== normalize(matched.name));
      for (const sibName of siblingNames) {
        const sib = list.find((c) => normalize(c.name) === normalize(sibName));
        if (!sib) continue;
        const sibPath = sib.path ? (PATH_NAMES[sib.path] || sib.path) : '';
        const sibEl = sib.element ? (ELEMENT_NAMES[sib.element] || sib.element) : '';
        const sibAvatar = sib.icon ? `${STAR_RAIL_RES_RAW}/${sib.icon}` : null;
        const sibPortrait = sib.portrait ? `${STAR_RAIL_RES_RAW}/${sib.portrait}` : null;
        skinOrVariantCandidates.push({
          id: crypto.randomUUID(),
          name: sib.name,
          classification: 'variant',
          variantKind: 'sp',
          outfitDescription: `${sib.name}（${[sibPath, sibEl].filter(Boolean).join(' / ')}）形态专属着装与外观造型。`,
          loreStory: `${matched.name}的衍生 SP 形态「${sib.name}」，对应${[sibPath && `${sibPath}命途`, sibEl && `${sibEl}属性`].filter(Boolean).join('、')}阶段的剧情身份与经历。`,
          avatarUrl: sibAvatar,
          portraitUrl: sibPortrait,
          source: 'StarRailRes',
          isDefault: false,
        });
        if (sibPortrait) {
          assets.push({
            id: crypto.randomUUID(),
            kind: 'reference',
            category: 'costume',
            title: `SP形态立绘 · ${sib.name}`,
            url: sibPortrait,
            previewUrl: sibPortrait,
            source: 'StarRailRes',
            skinName: sib.name,
          });
        }
      }
    }

    return {
      resolvedName: matched.name.replace(/•/g, '·'),
      resolvedWork: '崩坏：星穹铁道',
      englishName: matched.tag || undefined,
      aliases: nicknames[matched.id] || [],
      originType: 'ip',
      facts,
      skinOrVariantCandidates,
      assets,
      sources: [
        {
          title: `StarRailRes：${matched.name}`,
          url: `${STAR_RAIL_RES_RAW}/index_min/cn/characters.json`,
          excerpt: facts.join('\n'),
          sourceType: 'starrailres',
        },
      ],
    };
  } catch (error) {
    return {
      warnings: [`StarRailRes 读取失败: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
