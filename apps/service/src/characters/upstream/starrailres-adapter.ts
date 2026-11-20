import crypto from 'node:crypto';
import { evidenceSource, type UpstreamCharacterBundle } from './types.js';

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
const STAR_RAIL_RES_JSDELIVR = 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master';

const characterCache = new WeakMap<typeof fetch, { data: Record<string, StarRailCharacterItem>; expiresAt: number }>();
const nicknameCache = new WeakMap<typeof fetch, { data: Record<string, string[]>; expiresAt: number }>();

const PATH_NAMES: Record<string, string> = {
  Knight: '存护',
  Rogue: '巡猎',
  Mage: '智识',
  Priest: '丰饶',
  Warlock: '虚无',
  Shaman: '同谐',
  Warrior: '毁灭',
  Memory: '记忆',
  Elation: '欢愉',
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

/** Verified game data IDs and tags. Display names are not unique (1001 and 1224 are both 三月七). */
const IDENTITY_GROUPS = [
  { ids: ['1001', '1224', '1413'], tags: ['mar7th', 'mar7th2', 'evernight'] },
  { ids: ['1002', '1213', '1414'], tags: ['danheng', 'danhengil', 'danhengpt'] },
  { ids: ['1202', '1225'], tags: ['tingyun', 'fugue'] },
  { ids: ['1013', '1401'], tags: ['herta', 'theherta'] },
  {
    ids: ['8001', '8002', '8003', '8004', '8005', '8006', '8007', '8008', '8009', '8010'],
    tags: [
      'playerboy', 'playergirl',
      'playerboy2', 'playergirl2',
      'playerboy3', 'playergirl3',
      'playerboy4', 'playergirl4',
      'playerboy5', 'playergirl5',
    ],
  },
];

async function fetchJsonWithFallback<T>(
  fetcher: typeof fetch,
  relativePath: string,
  timeoutMs: number,
): Promise<T> {
  const primaryUrl = `${STAR_RAIL_RES_RAW}/${relativePath}`;
  try {
    const res = await fetcher(primaryUrl, {
      headers: { 'User-Agent': 'SthStart/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status < 500 && res.status !== 403 && res.status !== 429) {
      throw new Error(`starrailres_http_${res.status}`);
    }
  } catch (err) {
    // Fall through to mirror only if primary failed
    void err;
  }

  const mirrorUrl = `${STAR_RAIL_RES_JSDELIVR}/${relativePath}`;
  const res = await fetcher(mirrorUrl, {
    headers: { 'User-Agent': 'SthStart/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`starrailres_http_${res.status}`);
  return (await res.json()) as T;
}

async function loadStarRailCharacters(fetcher: typeof fetch) {
  const cachedHsrCharacters = characterCache.get(fetcher);
  if (cachedHsrCharacters && cachedHsrCharacters.expiresAt > Date.now()) {
    return cachedHsrCharacters.data;
  }
  const data = await fetchJsonWithFallback<Record<string, StarRailCharacterItem>>(
    fetcher,
    'index_min/cn/characters.json',
    8_000,
  );
  characterCache.set(fetcher, { data, expiresAt: Date.now() + 30 * 60_000 });
  return data;
}

async function loadStarRailNicknames(fetcher: typeof fetch) {
  const cachedHsrNicknames = nicknameCache.get(fetcher);
  if (cachedHsrNicknames && cachedHsrNicknames.expiresAt > Date.now()) {
    return cachedHsrNicknames.data;
  }
  try {
    const json = await fetchJsonWithFallback<{ characters?: Record<string, string[]> }>(
      fetcher,
      'index_min/cn/nickname.json',
      6_000,
    );
    const data = json.characters || {};
    nicknameCache.set(fetcher, { data, expiresAt: Date.now() + 30 * 60_000 });
    return data;
  } catch {
    return {};
  }
}

function normalizeStarRailEntry(item: StarRailCharacterItem): StarRailCharacterItem {
  if (item.name === '{NICKNAME}') {
    const isBoy = (item.tag || '').startsWith('playerboy');
    const genderSuffix = isBoy ? '穹' : '星';
    return {
      ...item,
      name: `开拓者·${genderSuffix}`,
    };
  }
  return item;
}

export function starRailMirrorUrls(relativeAssetPath: string): string[] {
  const clean = relativeAssetPath.replace(/^\/+/, '');
  return [
    `${STAR_RAIL_RES_RAW}/${clean}`,
    `${STAR_RAIL_RES_JSDELIVR}/${clean}`,
  ];
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
    const list = Object.values(chars)
      .filter((item) => Boolean(item.name))
      .map(normalizeStarRailEntry);
    const normalize = (s: string) => s.replace(/[·•\s]/g, '').toLowerCase();
    const compactNeedle = normalize(needle);

    let matched = list.find((c) => c.id === needle || normalize(c.tag || '') === compactNeedle || normalize(`${c.name}·${PATH_NAMES[c.path || ''] || c.path || ''}`) === compactNeedle || normalize(c.name) === compactNeedle)
      || list.find((c) => (nicknames[c.id] || []).some((n) => normalize(n) === compactNeedle));

    // 开拓者 / 星 / 穹 显式优先匹配默认主角形象（8002 女开拓者星 / 8001 男开拓者穹）
    if (!matched && ['开拓者', '星', '穹', 'trailblazer', 'stelle', 'caelus'].includes(compactNeedle)) {
      const preferredId = ['穹', 'caelus'].includes(compactNeedle) ? '8001' : '8002';
      matched = list.find((c) => c.id === preferredId)
        || list.find((c) => c.id === '8001' || c.id === '8002');
    }

    if (!matched) return null;

    const resolvedDisplayName = matched.name.startsWith('开拓者·') && ['开拓者', 'trailblazer'].includes(compactNeedle)
      ? '开拓者'
      : matched.name.replace(/•/g, '·');

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
        title: `${resolvedDisplayName} 官方头像`,
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
        title: `${resolvedDisplayName} 官方全身立绘`,
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
        title: `${resolvedDisplayName} 角色展示图`,
        url: previewUrl,
        previewUrl,
        source: 'StarRailRes',
      });
    }

    // 识别关联的 SP 形态，生成衍生形态候选（保持每个名称不重复）
    const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
    const group = IDENTITY_GROUPS.find((g) => g.ids.includes(matched.id) || g.tags.includes(matched.tag || ''));
    if (group) {
      const seenVariantNames = new Set<string>();
      for (const sib of list.filter((c) => c.id !== matched.id && (group.ids.includes(c.id) || group.tags.includes(c.tag || '')))) {
        const sibAvatar = sib.icon ? `${STAR_RAIL_RES_RAW}/${sib.icon}` : null;
        const sibPortrait = sib.portrait ? `${STAR_RAIL_RES_RAW}/${sib.portrait}` : null;
        const pathLabel = PATH_NAMES[sib.path || ''] || '衍生形态';
        const variantName = sib.name === matched.name || sib.name.startsWith('开拓者·')
          ? `${sib.name}（${pathLabel}）`
          : sib.name;
        if (seenVariantNames.has(variantName)) continue;
        seenVariantNames.add(variantName);

        skinOrVariantCandidates.push({
          id: `starrailres:${sib.id}`,
          name: variantName,
          classification: 'variant',
          variantKind: 'sp',
          outfitDescription: '',
          loreStory: '',
          avatarUrl: sibAvatar,
          portraitUrl: sibPortrait,
          source: `${STAR_RAIL_RES_RAW}/index_min/cn/characters.json#${sib.id}`,
          isDefault: false,
        });
        if (sibPortrait) {
          assets.push({
            id: crypto.randomUUID(),
            kind: 'reference',
            category: 'costume',
            title: `SP形态立绘 · ${variantName}`,
            url: sibPortrait,
            previewUrl: sibPortrait,
            source: 'StarRailRes',
            skinName: variantName,
          });
        }
      }
    }

    const trailblazerAliases = matched.name.startsWith('开拓者·') ? ['开拓者', '星', '穹'] : [];
    const aliases = [...new Set([...(nicknames[matched.id] || []), ...trailblazerAliases])];

    return {
      resolvedName: resolvedDisplayName,
      resolvedWork: '崩坏：星穹铁道',
      englishName: matched.tag || undefined,
      aliases,
      originType: 'ip',
      facts,
      skinOrVariantCandidates,
      assets,
      sources: [evidenceSource({
        title: `StarRailRes：${resolvedDisplayName} (${matched.id})`,
        url: `${STAR_RAIL_RES_RAW}/index_min/cn/characters.json`,
        sourceType: 'starrailres', externalId: matched.id,
        rawText: JSON.stringify({ character: matched, related: list.filter((c) => group && (group.ids.includes(c.id) || group.tags.includes(c.tag || ''))), aliases }),
        rawPayload: { characters: chars, nicknames, matchedId: matched.id }, evidenceKind: 'structured',
      })],
      warnings: ['StarRailRes 仅提供角色身份、命途、属性和图像路径，不含衣装描述或背景故事；未生成推测文本。'],
    };
  } catch (error) {
    return {
      warnings: [`StarRailRes 读取失败: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
