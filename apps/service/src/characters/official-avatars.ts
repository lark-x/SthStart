import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';
import type { CharacterAssetCategory, CharacterPreferredSources } from '@sthstart/contracts';
import { inferWorkTarget, type UpstreamCharacterBundle } from './upstream/types.js';
import { fetchYattaGenshinCharacter } from './upstream/yatta-adapter.js';
import { fetchStarRailResCharacter, starRailMirrorUrls } from './upstream/starrailres-adapter.js';
import { fetchBwikiCharacter } from './upstream/bwiki-adapter.js';
import { fetchFandomCharacter, fetchMoegirlCharacter } from './upstream/fandom-moegirl-adapter.js';

interface GenshinCatalogItem {
  id: number;
  name: string;
  nameEn: string;
  region?: string;
  element?: string;
}

let cachedCatalog: GenshinCatalogItem[] | null = null;

function loadGenshinCatalog(): GenshinCatalogItem[] {
  if (cachedCatalog) return cachedCatalog;
  const candidatePaths = [
    resolve(process.cwd(), 'scripts/akasha-genshin-character-catalog.json'),
    resolve(process.cwd(), '../scripts/akasha-genshin-character-catalog.json'),
    resolve(process.cwd(), '../../scripts/akasha-genshin-character-catalog.json'),
  ];
  for (const p of candidatePaths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf-8'));
        if (Array.isArray(data.characters)) {
          cachedCatalog = data.characters;
          return cachedCatalog!;
        }
      } catch {
        // continue
      }
    }
  }
  return [];
}

/**
 * 原神角色在游戏内内部资源命名（Enka / Ambr / Yatta 等 CDN 使用的 UI_AvatarIcon_xxx 标识）
 * 往往与角色的英文译名不同（如使用拼音、原案名、去掉氏族姓氏等）。
 */
export const GENSHIN_INTERNAL_ICON_MAP: Record<string, string | string[]> = {
  '胡桃': 'Hutao',
  '琴': 'Qin',
  '雷电将军': 'Shougun',
  '枫原万叶': 'Kazuha',
  '神里绫华': 'Ayaka',
  '神里绫人': 'Ayato',
  '珊瑚宫心海': 'Kokomi',
  '九条裟罗': 'Sara',
  '久岐忍': 'Shinobu',
  '鹿野院平藏': 'Heizo',
  '艾尔海森': 'Alhatham',
  '绮良良': 'Momoka',
  '闲云': 'Liuyun',
  '安柏': 'Ambor',
  '诺艾尔': 'Noel',
  '烟绯': 'Feiyan',
  '云堇': 'Yunjin',
  '白术': 'Baizhuer',
  '荧': 'PlayerGirl',
  '空': 'PlayerBoy',
  '旅行者': ['PlayerGirl', 'PlayerBoy'],
  '旅行者·荧': 'PlayerGirl',
  '旅行者·空': 'PlayerBoy',
  '林尼': 'Liney',
  '琳妮特': 'Linette',
  '欧洛伦': 'Olorun',
  '蓝砚': 'Lanyan',
  '梦见月瑞希': 'Mizuki',
  '荒泷一斗': 'Itto',
  '八重神子': 'Yae',
  '托马': 'Tohma',
  '达达利亚': ['Tartaglia', 'PlayerBoy'],
  '公子': 'Tartaglia',
  '散兵': 'Wanderer',
  '流浪者': 'Wanderer',
  '魈': 'Xiao',
  '纳西妲': 'Nahida',
  '钟离': 'Zhongli',
  '温迪': 'Venti',
  '芙宁娜': 'Furina',
  '那维莱特': 'Neuvillette',
  '克洛琳德': 'Clorinde',
  '娜维娅': 'Navia',
  '希格雯': 'Sigewinne',
  '莱欧斯利': 'Wriothesley',
  '玛拉妮': 'Mualani',
  '基尼奇': 'Kinich',
  '玛薇卡': 'Mavuika',
  '茜特菈莉': 'Citlali',
  '恰斯卡': 'Chasca',
  '奥黛塔': 'Odette',
  '伊法': 'Ifa',
  '伊涅芙': 'Ineffe',
  '兹白': 'Zibai',
  '叶洛亚': 'Yeloia',
  '塔利亚': 'Talia',
  '瓦雷莎': 'Valesha',
};

/**
 * 尚未实装或无独立可玩角色头像图标的特殊角色（向导/剧情/执行官等）的官方/百科高质立绘与头像
 */
export const SPECIAL_CHARACTER_AVATAR_MAP: Record<string, { avatars?: string[]; portraits?: string[] }> = {
  '派蒙': {
    avatars: [
      'https://patchwiki.biligame.com/images/ys/8/8c/gmu2ekzva3yldyws9cwnrba5gx1pqb6.png',
    ],
    portraits: [
      'https://patchwiki.biligame.com/images/ys/b/b5/485l5hkt4xeqmn3wbj22eqzhzhwq68j.jpg',
    ],
  },
  '丝柯克': {
    portraits: [
      'https://patchwiki.biligame.com/images/ys/f/f0/gbjq3bhxswsoicaonopqlbgy5lomh10.png',
      'https://patchwiki.biligame.com/images/ys/d/d0/ehtz002534qqe7cfgtpxvbxir5b2oxg.png',
    ],
    avatars: [
      'https://patchwiki.biligame.com/images/ys/3/3d/bxvsq969qzr9uzs5rd37pk9k801i6gc.png',
    ],
  },
  '桑多涅': {
    portraits: [
      'https://patchwiki.biligame.com/images/ys/f/f8/4i7yshux26dfzqk8o8j7xu7s2r1rgye.png',
      'https://patchwiki.biligame.com/images/ys/9/95/21afqdb120t02zyzrb1s5dt0mz43sqj.png',
      'https://patchwiki.biligame.com/images/ys/8/84/l0j445j5ixob4iae8ety4i072goqbjx.png',
    ],
    avatars: [
      'https://patchwiki.biligame.com/images/ys/b/b2/lu6txgoo1fj9pl2hmdua1h0ezd1l79u.png',
    ],
  },
  '木偶': {
    portraits: [
      'https://patchwiki.biligame.com/images/ys/f/f8/4i7yshux26dfzqk8o8j7xu7s2r1rgye.png',
      'https://patchwiki.biligame.com/images/ys/9/95/21afqdb120t02zyzrb1s5dt0mz43sqj.png',
    ],
    avatars: [
      'https://patchwiki.biligame.com/images/ys/b/b2/lu6txgoo1fj9pl2hmdua1h0ezd1l79u.png',
    ],
  },
  '奥黛塔': {
    portraits: [
      'https://patchwiki.biligame.com/images/ys/7/7b/i8lfej106lkao4o44hw4zcbwmlb0otn.png',
      'https://patchwiki.biligame.com/images/ys/6/68/m06hi6a1xn161ykmewxne6y5dtg9ndm.png',
      'https://patchwiki.biligame.com/images/ys/6/62/e5b3s26k4f3f5ljjoccbdt4725nplr3.png',
    ],
    avatars: [
      'https://patchwiki.biligame.com/images/ys/6/6b/ai2mnros90fslotnkgwau4xzzzg15cb.png',
      'https://patchwiki.biligame.com/images/ys/d/d2/jdlylp7en3i8zcnb5ie4wjfpb5f8jn9.png',
    ],
  },
};

export interface MatchedOfficialAvatar {
  url: string;
  candidateUrls: string[];
  matchedName: string;
  nameEn: string;
}

export interface OfficialAssetCandidate {
  id: string;
  kind: 'avatar' | 'portrait';
  category?: CharacterAssetCategory;
  url: string;
  source: string;
  title: string;
  previewUrl?: string;
  skinName?: string;
  width?: number;
  height?: number;
  outfitDescription?: string;
  loreStory?: string;
}

export interface ResolvedOfficialAssetItem {
  kind: 'avatar' | 'portrait' | 'reference';
  category: CharacterAssetCategory;
  title: string;
  url: string;
  candidateUrls: string[];
  source: string;
  skinName?: string;
  outfitDescription?: string;
  loreStory?: string;
}

export interface OfficialAssetBundle {
  sourceUsed: string;
  avatar: ResolvedOfficialAssetItem | null;
  portrait: ResolvedOfficialAssetItem | null;
  costumes: ResolvedOfficialAssetItem[];
}

function genshinMirrorUrls(kind: 'avatar' | 'portrait' | 'costume', iconFile: string): string[] {
  const clean = iconFile.replace(/^.*\//, '').replace(/\.png$/i, '');
  if (kind === 'portrait') {
    const gachaName = clean.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarImg_');
    return [
      `https://gi.yatta.moe/assets/UI/${gachaName}.png`,
      `https://enka.network/ui/${gachaName}.png`,
      `https://api.ambr.top/assets/UI/${gachaName}.png`,
    ];
  }
  if (kind === 'costume') {
    const costumeName = clean.replace('UI_AvatarIcon_', 'UI_Costume_');
    return [
      `https://gi.yatta.moe/assets/UI/${costumeName}.png`,
      `https://enka.network/ui/${costumeName}.png`,
      `https://api.ambr.top/assets/UI/${costumeName}.png`,
    ];
  }
  return [
    `https://gi.yatta.moe/assets/UI/${clean}.png`,
    `https://enka.network/ui/${clean}.png`,
    `https://api.ambr.top/assets/UI/${clean}.png`,
  ];
}

function candidateUrlsForStarRailUrl(url: string): string[] {
  const match = url.match(/StarRailRes\/(?:master|@master)\/(.+)$/);
  if (!match) return [url];
  return starRailMirrorUrls(match[1]);
}

function extractBwikiAssetBundle(
  bundle: Partial<UpstreamCharacterBundle> | null,
  displayName: string,
  sourceLabel: string,
): OfficialAssetBundle | null {
  if (!bundle?.assets?.length) return null;
  const seenSkins = new Set<string>();
  let avatar: ResolvedOfficialAssetItem | null = null;
  let portrait: ResolvedOfficialAssetItem | null = null;
  const costumes: ResolvedOfficialAssetItem[] = [];

  for (const item of bundle.assets) {
    if (!item.url) continue;
    if (item.category === 'avatar' || (item.kind === 'avatar' && !item.skinName && item.category !== 'costume')) {
      if (!avatar) {
        avatar = {
          kind: 'avatar',
          category: 'avatar',
          title: `${displayName} 官方头像`,
          url: item.url,
          candidateUrls: [item.url],
          source: item.source || sourceLabel,
        };
      }
      continue;
    }
    if (item.category === 'portrait' || (item.kind === 'portrait' && !item.skinName && item.category !== 'costume')) {
      if (!portrait) {
        portrait = {
          kind: 'portrait',
          category: 'portrait',
          title: `${displayName} 官方立绘`,
          url: item.url,
          candidateUrls: [item.url],
          source: item.source || sourceLabel,
        };
      }
      continue;
    }
    if (item.category === 'costume' || item.skinName) {
      const skinName = (item.skinName || item.title || '').replace(/^(?:皮肤立绘|皮肤头像|皮肤|形态立绘)\s*[·•]\s*/, '').trim();
      if (!skinName || seenSkins.has(skinName)) continue;
      // 同一皮肤优先只保留立绘（非纯小头像）
      if (item.kind === 'avatar' && bundle.assets.some((other) => other.skinName === item.skinName && other.kind !== 'avatar')) {
        continue;
      }
      seenSkins.add(skinName);
      const skinMeta = bundle.skinOrVariantCandidates?.find((s) => s.name.trim() === skinName);
      costumes.push({
        kind: 'reference',
        category: 'costume',
        title: `皮肤 · ${skinName}`,
        url: item.url,
        candidateUrls: [item.url],
        source: item.source || sourceLabel,
        skinName,
        outfitDescription: skinMeta?.outfitDescription,
        loreStory: skinMeta?.loreStory,
      });
    }
  }

  if (!avatar && !portrait && costumes.length === 0) return null;
  return { sourceUsed: sourceLabel, avatar, portrait, costumes };
}

/**
 * 尝试为角色匹配官方高清头像 URL 及候选地址列表（同步快速表查，主要用于兼容原神单头像兜底）
 */
export function matchOfficialAvatarUrl(
  displayName: string,
  englishName?: string,
  _work?: string
): MatchedOfficialAvatar | null {
  const trimmed = displayName.trim();
  const trimmedEn = (englishName || '').trim().toLowerCase();

  const normalizeExact = (s: string) => s.trim().toLowerCase().replace(/[·•・\s]/g, '');
  const trimmedKey = normalizeExact(trimmed);

  for (const [key, conf] of Object.entries(SPECIAL_CHARACTER_AVATAR_MAP)) {
    if (normalizeExact(key) === trimmedKey) {
      const urls = conf.avatars || conf.portraits || [];
      if (urls.length > 0) {
        return {
          url: urls[0],
          candidateUrls: urls,
          matchedName: key,
          nameEn: key,
        };
      }
    }
  }

  let matchedInternal = GENSHIN_INTERNAL_ICON_MAP[trimmed];
  if (!matchedInternal) {
    for (const [key, val] of Object.entries(GENSHIN_INTERNAL_ICON_MAP)) {
      if (normalizeExact(key) === trimmedKey) {
        matchedInternal = val;
        break;
      }
    }
  }

  const catalog = loadGenshinCatalog();
  let match = catalog.find((c) => normalizeExact(c.name) === trimmedKey);
  if (!match && trimmedEn) {
    match = catalog.find((c) => c.nameEn.toLowerCase() === trimmedEn);
  }

  const iconNames: string[] = [];
  if (matchedInternal) {
    if (Array.isArray(matchedInternal)) iconNames.push(...matchedInternal);
    else iconNames.push(matchedInternal);
  }

  if (match) {
    const rawEn = match.nameEn.trim();
    iconNames.push(rawEn);
    const noSpace = rawEn.replace(/\s+/g, '');
    iconNames.push(noSpace);
    const capitalized = noSpace.charAt(0).toUpperCase() + noSpace.slice(1).toLowerCase();
    iconNames.push(capitalized);
    const parts = rawEn.split(/\s+/);
    if (parts.length > 1) {
      iconNames.push(parts[parts.length - 1]);
      iconNames.push(parts[0]);
    }
  }

  const uniqueIcons = [...new Set(iconNames.filter(Boolean))];
  if (uniqueIcons.length === 0) return null;

  const candidateUrls: string[] = [];
  for (const icon of uniqueIcons) {
    candidateUrls.push(`https://gi.yatta.moe/assets/UI/UI_AvatarIcon_${icon}.png`);
    candidateUrls.push(`https://enka.network/ui/UI_AvatarIcon_${icon}.png`);
    candidateUrls.push(`https://api.ambr.top/assets/UI/UI_AvatarIcon_${icon}.png`);
  }

  return {
    url: candidateUrls[0],
    candidateUrls,
    matchedName: match ? match.name : trimmed,
    nameEn: uniqueIcons[0],
  };
}

/**
 * 为单个角色按「作品单一最佳默认源（可配置）」解析不重复的官方形象套装：
 * - 唯一主头像（avatar）
 * - 唯一全身主立绘（portrait）
 * - 全部去重皮肤 / 衍生形态立绘（costumes）
 */
export async function resolveCharacterOfficialAssetBundle(
  displayName: string,
  englishName?: string,
  work?: string,
  preferredSources?: CharacterPreferredSources,
  fetcher: typeof fetch = fetch,
): Promise<OfficialAssetBundle | null> {
  const trimmed = displayName.trim();
  if (!trimmed) return null;
  const workTarget = inferWorkTarget(trimmed, work);

  if (workTarget === 'genshin') {
    const source = preferredSources?.genshin ?? 'yatta';
    const normalizeExact = (s: string) => s.trim().toLowerCase().replace(/[·•・\s]/g, '');
    const trimmedNorm = normalizeExact(trimmed);

    if (source === 'bwiki') {
      const bwiki = await fetchBwikiCharacter(trimmed, 'genshin', fetcher);
      return extractBwikiAssetBundle(bwiki, trimmed, 'BWiki (原神)');
    }

    if (source === 'yatta') {
      const yatta = await fetchYattaGenshinCharacter(trimmed, fetcher);
      if (yatta?.assets?.length || yatta?.skinOrVariantCandidates?.length) {
        const avatarAsset = yatta.assets?.find((a) => a.category === 'avatar' && !a.skinName);
        const portraitAsset = yatta.assets?.find((a) => a.category === 'portrait' && !a.skinName);

        const iconToken = avatarAsset?.url.match(/\/(UI_AvatarIcon_[^/.]+)\.png/i)?.[1];
        const avatarUrls = avatarAsset
          ? (iconToken ? genshinMirrorUrls('avatar', iconToken) : [avatarAsset.url])
          : [];
        const portraitUrls = portraitAsset
          ? (iconToken ? genshinMirrorUrls('portrait', iconToken) : [portraitAsset.url])
          : [];

        const costumes: ResolvedOfficialAssetItem[] = [];
        const seenSkins = new Set<string>();
        for (const skin of yatta.skinOrVariantCandidates || []) {
          if (skin.isDefault) continue;
          const skinName = skin.name.trim();
          if (!skinName || seenSkins.has(skinName)) continue;
          const targetUrl = skin.portraitUrl || skin.avatarUrl;
          if (!targetUrl) continue;
          seenSkins.add(skinName);
          const skinIconToken = (skin.avatarUrl || targetUrl).match(/\/(UI_(?:AvatarIcon|Costume)_[^/.]+)\.png/i)?.[1];
          const mirrorList = skinIconToken && skin.portraitUrl
            ? genshinMirrorUrls('costume', skinIconToken)
            : [targetUrl];
          costumes.push({
            kind: 'reference',
            category: 'costume',
            title: `皮肤 · ${skinName}`,
            url: mirrorList[0],
            candidateUrls: mirrorList,
            source: 'Project Amber (Yatta)',
            skinName,
            outfitDescription: skin.outfitDescription,
            loreStory: skin.loreStory,
          });
        }

        if (avatarAsset || portraitAsset || costumes.length > 0) {
          return {
            sourceUsed: 'Project Amber (Yatta)',
            avatar: avatarAsset
              ? {
                  kind: 'avatar',
                  category: 'avatar',
                  title: `${trimmed} 官方头像`,
                  url: avatarUrls[0] || avatarAsset.url,
                  candidateUrls: avatarUrls.length ? avatarUrls : [avatarAsset.url],
                  source: 'Project Amber (Yatta)',
                }
              : null,
            portrait: portraitAsset
              ? {
                  kind: 'portrait',
                  category: 'portrait',
                  title: `${trimmed} 官方抽卡立绘`,
                  url: portraitUrls[0] || portraitAsset.url,
                  candidateUrls: portraitUrls.length ? portraitUrls : [portraitAsset.url],
                  source: 'Project Amber (Yatta)',
                }
              : null,
            costumes,
          };
        }
      }
    }

    // 非实装或 Yatta 未收录特殊角色（如派蒙、桑多涅）精确命中内置精选来源
    for (const [key, conf] of Object.entries(SPECIAL_CHARACTER_AVATAR_MAP)) {
      if (normalizeExact(key) === trimmedNorm) {
        const av = conf.avatars?.[0];
        const pt = conf.portraits?.[0];
        if (av || pt) {
          return {
            sourceUsed: '官方图鉴精选 (特殊角色)',
            avatar: av
              ? {
                  kind: 'avatar',
                  category: 'avatar',
                  title: `${trimmed} 官方头像`,
                  url: av,
                  candidateUrls: conf.avatars || [av],
                  source: '官方图鉴精选',
                }
              : null,
            portrait: pt
              ? {
                  kind: 'portrait',
                  category: 'portrait',
                  title: `${trimmed} 官方立绘`,
                  url: pt,
                  candidateUrls: conf.portraits || [pt],
                  source: '官方图鉴精选',
                }
              : null,
            costumes: [],
          };
        }
      }
    }

    // Enka 直连或 Yatta 未匹配到（如 旅行者 组合别名）时的内部标识映射
    const fallbackMatch = matchOfficialAvatarUrl(trimmed, englishName, work);
    if (fallbackMatch) {
      const iconName = fallbackMatch.nameEn;
      return {
        sourceUsed: source === 'enka' ? 'Enka CDN' : 'Project Amber / Enka 镜像',
        avatar: {
          kind: 'avatar',
          category: 'avatar',
          title: `${trimmed} 官方头像`,
          url: fallbackMatch.candidateUrls[0],
          candidateUrls: fallbackMatch.candidateUrls,
          source: source === 'enka' ? 'Enka CDN' : 'Project Amber (Yatta)',
        },
        portrait: {
          kind: 'portrait',
          category: 'portrait',
          title: `${trimmed} 官方立绘`,
          url: `https://gi.yatta.moe/assets/UI/UI_Gacha_AvatarImg_${iconName}.png`,
          candidateUrls: [
            `https://gi.yatta.moe/assets/UI/UI_Gacha_AvatarImg_${iconName}.png`,
            `https://enka.network/ui/UI_Gacha_AvatarImg_${iconName}.png`,
            `https://api.ambr.top/assets/UI/UI_Gacha_AvatarImg_${iconName}.png`,
          ],
          source: source === 'enka' ? 'Enka CDN' : 'Project Amber (Yatta)',
        },
        costumes: [],
      };
    }

    return null;
  }

  if (workTarget === 'starrail') {
    const source = preferredSources?.starrail ?? 'starrailres';
    if (source === 'bwiki') {
      const bwiki = await fetchBwikiCharacter(trimmed, 'starrail', fetcher);
      return extractBwikiAssetBundle(bwiki, trimmed, 'BWiki (星穹铁道)');
    }

    const hsr = await fetchStarRailResCharacter(trimmed, fetcher);
    if (!hsr?.assets?.length) return null;

    const avatarAsset = hsr.assets.find((a) => a.category === 'avatar');
    const portraitAsset = hsr.assets.find((a) => a.category === 'portrait');
    const costumes: ResolvedOfficialAssetItem[] = [];
    const seenSkins = new Set<string>();

    for (const skin of hsr.skinOrVariantCandidates || []) {
      const targetUrl = skin.portraitUrl || skin.avatarUrl;
      const skinName = skin.name.trim();
      if (!targetUrl || !skinName || seenSkins.has(skinName)) continue;
      seenSkins.add(skinName);
      costumes.push({
        kind: 'reference',
        category: 'costume',
        title: `形态立绘 · ${skinName}`,
        url: targetUrl,
        candidateUrls: candidateUrlsForStarRailUrl(targetUrl),
        source: 'StarRailRes',
        skinName,
        outfitDescription: skin.outfitDescription,
        loreStory: skin.loreStory,
      });
    }

    return {
      sourceUsed: 'StarRailRes (星铁结构化主源)',
      avatar: avatarAsset
        ? {
            kind: 'avatar',
            category: 'avatar',
            title: `${trimmed} 官方头像`,
            url: avatarAsset.url,
            candidateUrls: candidateUrlsForStarRailUrl(avatarAsset.url),
            source: 'StarRailRes',
          }
        : null,
      portrait: portraitAsset
        ? {
            kind: 'portrait',
            category: 'portrait',
            title: `${trimmed} 官方全身立绘`,
            url: portraitAsset.url,
            candidateUrls: candidateUrlsForStarRailUrl(portraitAsset.url),
            source: 'StarRailRes',
          }
        : null,
      costumes,
    };
  }

  // 其他/通用作品默认单一源
  const generalSource = preferredSources?.default ?? 'bwiki';
  if (generalSource === 'moegirl') {
    const mg = await fetchMoegirlCharacter(trimmed, work || trimmed, fetcher);
    return extractBwikiAssetBundle(mg, trimmed, '萌娘百科');
  }
  if (generalSource === 'fandom') {
    const fd = await fetchFandomCharacter(englishName || trimmed, workTarget, fetcher);
    return extractBwikiAssetBundle(fd, trimmed, 'Fandom Wiki');
  }
  const bwiki = await fetchBwikiCharacter(trimmed, workTarget, fetcher);
  return extractBwikiAssetBundle(bwiki, trimmed, 'BWiki');
}

/**
 * 检索 BWiki (Bilibili 游戏维基) 高可用 CDN 官方角色媒体资源
 */
export async function searchBwikiAssets(
  displayName: string,
  work?: string
): Promise<OfficialAssetCandidate[]> {
  const trimmed = displayName.trim();
  if (!trimmed) return [];

  let wiki = 'ys';
  const workLower = (work || '').toLowerCase();
  if (workLower.includes('星穹铁道') || workLower.includes('崩铁') || workLower.includes('sr')) {
    wiki = 'sr';
  } else if (workLower.includes('崩坏3') || workLower.includes('崩坏三') || workLower.includes('bh3')) {
    wiki = 'bh3';
  } else if (workLower.includes('绝区零') || workLower.includes('zzz')) {
    wiki = 'zzz';
  }

  const results: OfficialAssetCandidate[] = [];
  try {
    const searchUrl = `https://wiki.biligame.com/${wiki}/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(trimmed)}&gsrnamespace=6&prop=imageinfo&iiprop=url|size&format=json`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok || res.status === 567) return [];
    const rawText = await res.text();
    if (rawText.trimStart().startsWith('<')) return [];
    const data = JSON.parse(rawText) as {
      query?: {
        pages?: Record<string, {
          pageid?: number;
          title?: string;
          imageinfo?: Array<{ url?: string; width?: number; height?: number; size?: number }>;
        }>;
      };
    };

    const pages = Object.values(data.query?.pages || {});
    for (const p of pages) {
      const info = p.imageinfo?.[0];
      if (!info?.url) continue;
      const url = info.url;
      const lower = url.toLowerCase();
      if (!lower.endsWith('.png') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.webp')) {
        continue;
      }

      const rawTitle = (p.title || '').replace(/^文件:/, '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
      const width = info.width || 0;
      const height = info.height || 0;

      const ignoreWords = ['武器', '名片', '命之座', '图鉴', '技能', '天赋', '料理', '便携式', '材料', '圣遗物', '突破', '成就', '徽章'];
      if (ignoreWords.some((w) => rawTitle.includes(w))) {
        continue;
      }

      let kind: 'avatar' | 'portrait' = 'portrait';
      if (rawTitle.includes('头像') || rawTitle === trimmed || (width > 0 && width <= 300 && height > 0 && height <= 300)) {
        kind = 'avatar';
      }

      let label = '官方形象';
      if (rawTitle.includes('抽卡立绘')) {
        label = 'BWiki 官方抽卡立绘';
      } else if (rawTitle.includes('立绘')) {
        label = 'BWiki 官方全身立绘';
      } else if (rawTitle.includes('头像') || kind === 'avatar') {
        label = 'BWiki 官方高清头像';
      } else {
        label = `BWiki 官方插画 (${rawTitle})`;
      }

      results.push({
        id: crypto.randomUUID(),
        kind,
        url,
        source: 'BWiki (B站游戏维基)',
        title: label,
        previewUrl: url,
      });
    }
  } catch {
    // ignore
  }

  return results;
}

/**
 * 跨多数据源聚合检索角色的可用头像与立绘候选列表
 */
export async function previewCharacterMultiSourceAssets(
  displayName: string,
  englishName?: string,
  work?: string
): Promise<OfficialAssetCandidate[]> {
  const trimmed = displayName.trim();
  const trimmedEn = (englishName || '').trim();
  const workTarget = inferWorkTarget(trimmed, work);

  const structuredPromise = workTarget === 'genshin'
    ? fetchYattaGenshinCharacter(trimmed)
    : workTarget === 'starrail'
      ? fetchStarRailResCharacter(trimmed)
      : Promise.resolve(null);
  const bwikiPagePromise = fetchBwikiCharacter(trimmed, workTarget);
  const bwikiPromise = searchBwikiAssets(trimmed, work);

  const iconNames: string[] = [];
  const searchNames: string[] = [trimmed];
  if (trimmedEn) searchNames.push(trimmedEn);

  let matchedInternal = GENSHIN_INTERNAL_ICON_MAP[trimmed];
  if (!matchedInternal) {
    for (const [key, val] of Object.entries(GENSHIN_INTERNAL_ICON_MAP)) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        matchedInternal = val;
        break;
      }
    }
  }
  if (matchedInternal) {
    if (Array.isArray(matchedInternal)) iconNames.push(...matchedInternal);
    else iconNames.push(matchedInternal);
  }

  const catalog = loadGenshinCatalog();
  let match = catalog.find((c) => c.name === trimmed);
  if (!match && trimmedEn) {
    match = catalog.find((c) => c.nameEn.toLowerCase() === trimmedEn.toLowerCase());
  }
  if (!match) {
    match = catalog.find((c) => trimmed.includes(c.name) || c.name.includes(trimmed));
  }

  if (match) {
    searchNames.push(match.nameEn);
    const rawEn = match.nameEn.trim();
    iconNames.push(rawEn);
    const noSpace = rawEn.replace(/\s+/g, '');
    iconNames.push(noSpace);
    const capitalized = noSpace.charAt(0).toUpperCase() + noSpace.slice(1).toLowerCase();
    iconNames.push(capitalized);
    const parts = rawEn.split(/\s+/);
    if (parts.length > 1) {
      iconNames.push(parts[parts.length - 1]);
      iconNames.push(parts[0]);
    }
  }

  const uniqueIcons = [...new Set(iconNames.filter(Boolean))];
  const uniqueSearchNames = [...new Set(searchNames.filter(Boolean))];

  const candidateProbes: Array<{
    kind: 'avatar' | 'portrait';
    url: string;
    source: string;
    title: string;
    previewUrl?: string;
  }> = [];

  for (const [key, conf] of Object.entries(SPECIAL_CHARACTER_AVATAR_MAP)) {
    if (trimmed === key || trimmed.includes(key) || key.includes(trimmed)) {
      for (const a of conf.avatars || []) {
        candidateProbes.push({ kind: 'avatar', url: a, source: '官方/百科资源', title: `${key} 官方头像`, previewUrl: a });
      }
      for (const p of conf.portraits || []) {
        candidateProbes.push({ kind: 'portrait', url: p, source: '官方/百科资源', title: `${key} 官方立绘`, previewUrl: p });
      }
    }
  }

  if (workTarget === 'genshin') {
    for (const icon of uniqueIcons) {
      candidateProbes.push({
        kind: 'avatar',
        url: `https://enka.network/ui/UI_AvatarIcon_${icon}.png`,
        source: 'Enka CDN (游戏解包)',
        title: '官方高清头像图标',
        previewUrl: `https://enka.network/ui/UI_AvatarIcon_${icon}.png`,
      });
      candidateProbes.push({
        kind: 'portrait',
        url: `https://enka.network/ui/UI_Gacha_AvatarImg_${icon}.png`,
        source: 'Enka CDN (游戏解包)',
        title: '官方祈愿立绘大图',
        previewUrl: `https://enka.network/ui/UI_Gacha_AvatarImg_${icon}.png`,
      });
    }
  }

  const [structuredBundle, bwikiPageBundle, bwikiCandidates] = await Promise.all([
    structuredPromise,
    bwikiPagePromise,
    bwikiPromise,
  ]);
  const structuredCandidates: OfficialAssetCandidate[] = [];
  const skinMetaMap = new Map<string, { outfitDescription: string; loreStory: string }>();
  for (const s of [...(structuredBundle?.skinOrVariantCandidates || []), ...(bwikiPageBundle?.skinOrVariantCandidates || [])]) {
    skinMetaMap.set(s.name, { outfitDescription: s.outfitDescription, loreStory: s.loreStory });
  }
  for (const item of [...(structuredBundle?.assets || []), ...(bwikiPageBundle?.assets || [])]) {
    const skinMeta = item.skinName ? skinMetaMap.get(item.skinName) : undefined;
    structuredCandidates.push({
      id: item.id,
      kind: item.kind === 'avatar' ? 'avatar' : 'portrait',
      category: item.category,
      url: item.url,
      source: item.source,
      title: item.title,
      previewUrl: item.previewUrl || item.url,
      ...(item.skinName ? { skinName: item.skinName } : {}),
      ...(item.width ? { width: item.width } : {}),
      ...(item.height ? { height: item.height } : {}),
      ...(skinMeta?.outfitDescription ? { outfitDescription: skinMeta.outfitDescription } : {}),
      ...(skinMeta?.loreStory ? { loreStory: skinMeta.loreStory } : {}),
    });
  }

  if (bwikiCandidates.length < 2 && workTarget === 'genshin') {
    for (const name of uniqueSearchNames) {
      try {
        const wikiUrl = `https://genshin-impact.fandom.com/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=1024`;
        const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json() as { query?: { pages?: Record<string, { pageid?: number; thumbnail?: { source?: string } }> } };
          for (const p of Object.values(data.query?.pages || {})) {
            if (p.pageid && p.pageid > 0 && p.thumbnail?.source) {
              candidateProbes.push({
                kind: 'portrait',
                url: p.thumbnail.source,
                source: 'Fandom Wiki (游戏百科)',
                title: '百科高清角色立绘卡片',
                previewUrl: `/api/admin/proxy-image?url=${encodeURIComponent(p.thumbnail.source)}`,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const seenUrls = new Set<string>();
  const verified: OfficialAssetCandidate[] = [];

  for (const cand of [...structuredCandidates, ...bwikiCandidates]) {
    if (!seenUrls.has(cand.url)) {
      seenUrls.add(cand.url);
      verified.push(cand);
    }
  }

  const probeTasks = candidateProbes.map(async (probe) => {
    if (seenUrls.has(probe.url)) return;
    seenUrls.add(probe.url);
    try {
      const headRes = await fetch(probe.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (headRes.ok) {
        verified.push({
          id: crypto.randomUUID(),
          kind: probe.kind,
          category: probe.kind === 'avatar' ? 'avatar' : 'portrait',
          url: probe.url,
          source: probe.source,
          title: probe.title,
          previewUrl: probe.previewUrl || probe.url,
        });
      }
    } catch {
      // url unreachable
    }
  });

  await Promise.all(probeTasks);

  return verified.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'avatar' ? -1 : 1;
    const sourceScore = (s: string) => s.includes('Yatta') || s.includes('StarRailRes') ? 0 : s.includes('BWiki') ? 1 : 2;
    return sourceScore(a.source) - sourceScore(b.source);
  });
}
