import crypto from 'node:crypto';
import type { UpstreamCharacterBundle, WorkTarget } from './types.js';
import { stripWikiMarkup } from './types.js';

const WIKI_SUBSITE: Record<WorkTarget, string> = {
  genshin: 'ys',
  starrail: 'sr',
  bh3: 'bh3',
  zzz: 'zzz',
  general: 'ys',
};

const bwikiCache = new Map<string, { value: unknown; expiresAt: number }>();
let bwikiLastRequestAt = 0;

/** 对 BWiki 施加轻量串行间隔与缓存，防止触发 Tencent EdgeOne 567 WAF。 */
async function fetchBwikiJson<T>(url: string, fetcher: typeof fetch): Promise<{ ok: true; data: T } | { ok: false; rateLimited?: boolean; reason: string }> {
  const cached = bwikiCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return { ok: true, data: cached.value as T };
  }

  const now = Date.now();
  const waitMs = Math.max(0, bwikiLastRequestAt + 350 - now);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  bwikiLastRequestAt = Date.now();

  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(7_500),
    });
    const text = await res.text();
    if (res.status === 567 || text.includes('EdgeOne') || text.trimStart().startsWith('<!doctype')) {
      return { ok: false, rateLimited: true, reason: 'BWiki 触发访问频控 (EdgeOne WAF)' };
    }
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    const parsed = JSON.parse(text) as T;
    bwikiCache.set(url, { value: parsed, expiresAt: Date.now() + 10 * 60_000 });
    return { ok: true, data: parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function splitWikitextSections(wikitext: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = [];
  const lines = wikitext.split(/\r?\n/);
  let currentTitle = '概览';
  let buffer: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(={2,4})\s*([^=]+?)\s*\1\s*$/.exec(line);
    if (headingMatch) {
      if (buffer.length) sections.push({ title: currentTitle, body: buffer.join('\n') });
      currentTitle = headingMatch[2].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length) sections.push({ title: currentTitle, body: buffer.join('\n') });
  return sections;
}

function classifyBwikiImage(fileTitle: string, target: WorkTarget): {
  ignore: boolean;
  kind: 'avatar' | 'portrait' | 'reference';
  category: 'avatar' | 'portrait' | 'costume' | 'cg' | 'concept';
  label: string;
  skinName?: string;
} {
  const ignoreWords = ['武器', '名片', '命之座', '天赋', '技能', '料理', '材料', '圣遗物', '突破', '成就', '徽章', '图标', '图标_', '按钮', '星魂', '行迹', '光锥', '圣痕'];
  if (ignoreWords.some((w) => fileTitle.includes(w))) {
    return { ignore: true, kind: 'reference', category: 'concept', label: fileTitle };
  }

  const isSkinOrArmor =
    fileTitle.includes('装扮')
    || fileTitle.includes('皮肤')
    || fileTitle.includes('衣装')
    || fileTitle.includes('海风')
    || fileTitle.includes('霓裾')
    || fileTitle.includes('装甲')
    || (target === 'bh3' && (fileTitle.includes('立绘') || fileTitle.includes('律者')));

  if (fileTitle.includes('头像')) {
    return {
      ignore: false,
      kind: 'avatar',
      category: isSkinOrArmor ? 'costume' : 'avatar',
      label: isSkinOrArmor ? `BWiki 皮肤头像 (${fileTitle})` : 'BWiki 官方头像',
      ...(isSkinOrArmor ? { skinName: fileTitle.replace(/头像|立绘/g, '').trim() } : {}),
    };
  }

  if (fileTitle.includes('抽卡立绘') || fileTitle.includes('立绘')) {
    return {
      ignore: false,
      kind: isSkinOrArmor ? 'reference' : 'portrait',
      category: isSkinOrArmor ? 'costume' : 'portrait',
      label: isSkinOrArmor ? `BWiki 皮肤/形态立绘 (${fileTitle})` : 'BWiki 官方立绘',
      ...(isSkinOrArmor ? { skinName: fileTitle.replace(/立绘|抽卡/g, '').trim() } : {}),
    };
  }

  if (fileTitle.includes('生贺') || fileTitle.includes('贺图')) {
    return { ignore: false, kind: 'reference', category: 'cg', label: `官方贺图 (${fileTitle})` };
  }

  return { ignore: false, kind: 'reference', category: 'concept', label: `BWiki 插画 (${fileTitle})` };
}

export async function fetchBwikiCharacter(
  name: string,
  target: WorkTarget,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const wiki = WIKI_SUBSITE[target];
  if (!name.trim()) return null;

  const warnings: string[] = [];
  const searchUrl = `https://wiki.biligame.com/${wiki}/api.php?action=query&list=search&srsearch=${encodeURIComponent(name.trim())}&srlimit=6&format=json`;
  const searchRes = await fetchBwikiJson<{ query?: { search?: Array<{ title: string }> } }>(searchUrl, fetcher);
  if (!searchRes.ok) {
    return { warnings: [`BWiki (${wiki}): ${searchRes.reason}`] };
  }

  const hits = searchRes.data.query?.search || [];
  if (!hits.length) return null;

  // 选择主词条（尽量避免选中“/攻略”“/图鉴”）
  const cleanHits = hits.filter((h) => !h.title.includes('/'));
  const exact = cleanHits.find((h) => h.title === name.trim()) || cleanHits[0] || hits[0];
  const pageTitle = exact.title;

  const parseUrl = `https://wiki.biligame.com/${wiki}/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext|images&format=json`;
  const parseRes = await fetchBwikiJson<{
    parse?: { title?: string; wikitext?: { '*'?: string }; images?: string[] };
  }>(parseUrl, fetcher);

  if (!parseRes.ok) {
    return { warnings: [`BWiki (${wiki}) 页面解析受限: ${parseRes.reason}`] };
  }

  const wikitext = parseRes.data.parse?.wikitext?.['*'] || '';
  const imageNames = parseRes.data.parse?.images || [];
  const sections = splitWikitextSections(wikitext);

  const stories: UpstreamCharacterBundle['stories'] = [];
  const voiceLines: UpstreamCharacterBundle['voiceLines'] = [];
  const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
  const facts: string[] = [];

  for (const sec of sections) {
    const cleaned = stripWikiMarkup(sec.body);
    if (!cleaned || cleaned.length < 12) continue;

    if (/故事|传记|背景|剧情|考据|简介|资料|人物/.test(sec.title)) {
      stories.push({
        title: sec.title,
        content: cleaned.slice(0, 3_500),
        source: `BWiki (${wiki})`,
      });
    } else if (/语音|台词|对话/.test(sec.title)) {
      const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 6).slice(0, 15);
      for (const line of lines) {
        voiceLines.push({ title: sec.title, text: line.slice(0, 260), source: `BWiki (${wiki})` });
      }
    } else if (/装扮|皮肤|衣装|装甲/.test(sec.title)) {
      skinOrVariantCandidates.push({
        id: crypto.randomUUID(),
        name: sec.title.replace(/商城|角色|相关/g, '').trim() || '衍生外观',
        classification: target === 'bh3' ? 'variant' : 'skin',
        ...(target === 'bh3' ? { variantKind: 'stage' as const } : {}),
        outfitDescription: cleaned.slice(0, 400),
        loreStory: cleaned.slice(0, 800),
        source: `BWiki (${wiki})`,
      });
    } else if (sec.title === '概览' || /基本信息|其他信息/.test(sec.title)) {
      facts.push(cleaned.slice(0, 1_200));
    }
  }

  // 解析崩坏三同角色的其他装甲页面作为衍生形态候选
  if (target === 'bh3') {
    for (const hit of cleanHits.slice(0, 5)) {
      if (hit.title === pageTitle) continue;
      skinOrVariantCandidates.push({
        id: crypto.randomUUID(),
        name: hit.title,
        classification: 'variant',
        variantKind: 'stage',
        outfitDescription: `崩坏三装甲形态「${hit.title}」专属战甲造型与外观。`,
        loreStory: `角色「${name}」在崩坏三剧情中的阶段性装甲形态「${hit.title}」。`,
        source: `BWiki (${wiki})`,
      });
    }
  }

  // 按需解析页面中的核心角色图片（限制单次 imageinfo 批量请求，避免触发 WAF）
  const assets: UpstreamCharacterBundle['assets'] = [];
  const candidateFiles = imageNames
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .filter((file) => {
      const bare = file.replace(/\.(png|jpe?g|webp)$/i, '');
      const cls = classifyBwikiImage(bare, target);
      if (cls.ignore) return false;
      return bare.includes(name.trim()) || cls.category === 'costume' || bare.includes('立绘') || bare.includes('头像');
    })
    .slice(0, 18);

  if (candidateFiles.length > 0) {
    const titlesParam = candidateFiles.map((f) => `File:${f}`).join('|');
    const infoUrl = `https://wiki.biligame.com/${wiki}/api.php?action=query&titles=${encodeURIComponent(titlesParam)}&prop=imageinfo&iiprop=url|size&format=json`;
    const infoRes = await fetchBwikiJson<{
      query?: {
        pages?: Record<string, {
          title?: string;
          imageinfo?: Array<{ url?: string; width?: number; height?: number }>;
        }>;
      };
    }>(infoUrl, fetcher);

    if (infoRes.ok) {
      for (const p of Object.values(infoRes.data.query?.pages || {})) {
        const info = p.imageinfo?.[0];
        if (!info?.url) continue;
        const width = info.width || 0;
        const height = info.height || 0;
        if (width > 0 && height > 0 && Math.max(width, height) < 120) continue;
        const bareTitle = (p.title || '').replace(/^文件:|^File:/i, '').replace(/\.(png|jpe?g|webp)$/i, '');
        const cls = classifyBwikiImage(bareTitle, target);
        if (cls.ignore) continue;
        assets.push({
          id: crypto.randomUUID(),
          kind: cls.kind,
          category: cls.category,
          title: cls.label,
          url: info.url,
          previewUrl: info.url,
          source: `BWiki (${wiki})`,
          ...(cls.skinName ? { skinName: cls.skinName } : {}),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          recommended: cls.kind === 'avatar' || cls.kind === 'portrait',
        });
      }
    } else if (infoRes.rateLimited) {
      warnings.push(infoRes.reason);
    }
  }

  return {
    resolvedName: pageTitle,
    facts,
    stories: stories.slice(0, 8),
    voiceLines,
    skinOrVariantCandidates,
    assets,
    sources: [
      {
        title: `BWiki：${pageTitle}`,
        url: `https://wiki.biligame.com/${wiki}/${encodeURIComponent(pageTitle)}`,
        excerpt: [...facts, ...stories.map((s) => `【${s.title}】\n${s.content}`)].join('\n\n').slice(0, 12_000),
        sourceType: 'bwiki',
      },
    ],
    warnings,
  };
}
