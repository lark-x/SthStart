import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';

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
 * 原神角色在游戏内内部资源命名（Enka / Ambr 等 CDN 使用的 UI_AvatarIcon_xxx 标识）
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
 * 尚未实装或无独立可玩角色头像图标的特殊角色（剧情/执行官等）的官方/百科高质立绘与头像
 */
export const SPECIAL_CHARACTER_AVATAR_MAP: Record<string, { avatars?: string[]; portraits?: string[] }> = {
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
  url: string;
  source: string;
  title: string;
  previewUrl?: string;
}

/**
 * 尝试为角色匹配官方高清头像 URL 及候选地址列表
 */
export function matchOfficialAvatarUrl(
  displayName: string,
  englishName?: string,
  _work?: string
): MatchedOfficialAvatar | null {
  const trimmed = displayName.trim();
  const trimmedEn = (englishName || '').trim().toLowerCase();

  // 1. 检查特殊未实装角色
  for (const [key, conf] of Object.entries(SPECIAL_CHARACTER_AVATAR_MAP)) {
    if (trimmed === key || trimmed.includes(key) || key.includes(trimmed)) {
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

  // 2. 检查已知别名与特殊内部名称映射
  let matchedInternal = GENSHIN_INTERNAL_ICON_MAP[trimmed];
  if (!matchedInternal) {
    for (const [key, val] of Object.entries(GENSHIN_INTERNAL_ICON_MAP)) {
      if (trimmed.includes(key) || key.includes(trimmed)) {
        matchedInternal = val;
        break;
      }
    }
  }

  // 3. 官方角色列表检索
  const catalog = loadGenshinCatalog();
  let match = catalog.find((c) => c.name === trimmed);
  if (!match && trimmedEn) {
    match = catalog.find((c) => c.nameEn.toLowerCase() === trimmedEn);
  }
  if (!match) {
    match = catalog.find((c) => trimmed.includes(c.name) || c.name.includes(trimmed));
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
  if (workLower.includes('星穹铁道') || workLower.includes('崩坏') || workLower.includes('sr')) {
    wiki = 'sr';
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
    if (!res.ok) return [];

    const data = await res.json() as {
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

      // 过滤非角色本体的道具/材料/技能/图标
      const ignoreWords = ['武器', '名片', '命之座', '图鉴', '技能', '天赋', '料理', '便携式', '材料', '圣遗物', '突破', '成就', '徽章'];
      if (ignoreWords.some((w) => rawTitle.includes(w))) {
        continue;
      }

      // 区分头像与立绘
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

  // 1. 并发检索 BWiki (B站中文维基，国内秒级高可用 CDN，支持未实装/剧情角色)
  const bwikiPromise = searchBwikiAssets(trimmed, work);

  // 2. 收集角色可能对应的英文名与内部标识
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

  // 3. 特殊未实装角色直接注入
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

  // 4. Enka 解包资源探针 (Avatar + Gacha Portrait + Costume)
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
    candidateProbes.push({
      kind: 'portrait',
      url: `https://enka.network/ui/UI_Costume_${icon}.png`,
      source: 'Enka CDN (游戏解包)',
      title: '官方服饰立绘',
      previewUrl: `https://enka.network/ui/UI_Costume_${icon}.png`,
    });
  }

  // 5. 等待 BWiki 检索结果（高可用国内 CDN）
  const bwikiCandidates = await bwikiPromise;

  // 6. Fandom Wiki 原神百科探针（仅当国内 BWiki 资源较少时作为海外百科兜底）
  if (bwikiCandidates.length < 2) {
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

  // 7. 并发探测外部 URL 可用性与去重
  const seenUrls = new Set<string>();
  const verified: OfficialAssetCandidate[] = [];

  // 首先放入 BWiki 候选（已在 BWiki 数据库中存在，高可用，去重）
  for (const cand of bwikiCandidates) {
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

  // 排序：头像在前，立绘在后；同类中 BWiki 优先，其次 Enka 解包
  return verified.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'avatar' ? -1 : 1;
    const sourceScore = (s: string) => s.includes('BWiki') ? 0 : s.includes('Enka') ? 1 : 2;
    return sourceScore(a.source) - sourceScore(b.source);
  });
}
