import crypto from 'node:crypto';
import type { UpstreamCharacterBundle, WorkTarget } from './types.js';
import { evidenceSource, parseWikiTemplates, stripWikiMarkup } from './types.js';

const WIKI_SUBSITE: Partial<Record<WorkTarget, string>> = {
  genshin: 'ys',
  starrail: 'sr',
  bh3: 'bh3',
  zzz: 'zzz',
};

const bwikiCaches = new WeakMap<typeof fetch, Map<string, { value: unknown; expiresAt: number }>>();
let bwikiLastRequestAt = 0;

/** 对 BWiki 施加轻量串行间隔与缓存，防止触发 Tencent EdgeOne 567 WAF。 */
async function fetchBwikiJson<T>(url: string, fetcher: typeof fetch): Promise<{ ok: true; data: T } | { ok: false; rateLimited?: boolean; reason: string }> {
  let bwikiCache = bwikiCaches.get(fetcher);
  if (!bwikiCache) { bwikiCache = new Map(); bwikiCaches.set(fetcher, bwikiCache); }
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
        'User-Agent': 'SthStart/1.0',
        Accept: 'application/json',
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

function classifyBwikiImage(fileTitle: string): {
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
    || fileTitle.includes('装甲');

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

interface WikiPage { title?: string; pageid?: number; revid?: number; wikitext?: { '*'?: string }; images?: string[] }

/** Parse retrieved text without making network calls. Comments are removed before heading detection. */
export function parseBwikiCharacterPage(page: WikiPage, target: WorkTarget, characterName: string): Partial<UpstreamCharacterBundle> {
  const wiki = WIKI_SUBSITE[target];
  const raw = page.wikitext?.['*'] || '';
  const clean = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const title = page.title || characterName;
  const source = `https://wiki.biligame.com/${wiki}/${encodeURIComponent(title)}`;
  const templates = parseWikiTemplates(clean);
  const facts: string[] = []; const stories: UpstreamCharacterBundle['stories'] = [];
  const voiceLines: UpstreamCharacterBundle['voiceLines'] = [];
  const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
  let englishName: string | undefined; let appearanceText = '';
  const value = (fields: Record<string, string>, key: string) => stripWikiMarkup(fields[key] || '');
  for (const template of templates) {
    const f = template.fields;
    if (/^(?:角色|角色\/信息|女武神装甲)$/.test(template.name)) {
      const keys = ['名称', '中文名', '全名', '称号', '介绍', '简介', '所属', '种族', '性别', '生日', '身高', '体重', '爱好', '出身地区', '角色名', '装甲名', '稀有度', '属性', '元素属性', '命途', '命途属性', '武器类型', '武器'];
      for (const key of keys) { const v = value(f, key); if (v) facts.push(`${key === '介绍' ? '简介' : key}：${v}`); }
      englishName ||= value(f, '英文名称') || value(f, '英文名') || undefined;
      for (const key of ['外貌', '外观', '体貌']) { if (value(f, key)) appearanceText += `${key}：${value(f, key)}\n`; }
    }
    if (/故事|传记/.test(template.name)) {
      for (const key of Object.keys(f)) {
        if (/条件|解锁|名称|好感|标题/.test(key)) continue;
        const text = value(f, key);
        if (text.length >= 12) stories.push({ title: value(f, `${key}名称`) || key, content: text, source });
      }
    }
    if (/语音|台词/.test(template.name) && value(f, '语音内容')) {
      voiceLines.push({ title: value(f, '语音类型') || '角色语音', text: value(f, '语音内容'), source });
    }
    if (/角色衣装|服装|换装/.test(template.name)) {
      const owner = value(f, '适配角色') || value(f, '角色名');
      if (owner && owner !== characterName) continue;
      const skinName = value(f, '名称') || title;
      skinOrVariantCandidates.push({ id: `bwiki:${wiki}:${title}`, name: skinName, classification: 'skin',
        outfitDescription: value(f, '简介') || value(f, '描述'), loreStory: value(f, '故事'), source });
    }
    if (template.name === '女武神装甲' && value(f, '装甲名') && value(f, '角色名') === characterName) {
      skinOrVariantCandidates.push({ id: `bwiki:${wiki}:${title}`, name: value(f, '装甲名'), classification: 'variant', variantKind: 'stage',
        outfitDescription: value(f, '外观描述'), loreStory: value(f, '背景故事') || value(f, '故事'), source });
    }
  }
  for (const section of splitWikitextSections(clean)) {
    const text = stripWikiMarkup(section.body);
    if (text.length < 12 || /这里是|待补充|施工中/.test(text)) continue;
    if (/^(?:角色故事|故事|传记|背景|简介|人物背景)/.test(section.title)) stories.push({ title: section.title, content: text, source });
    else if (/^(?:语音|台词|对话)/.test(section.title)) {
      for (const line of text.split(/\n+/).filter((l) => l.length > 6)) voiceLines.push({ title: section.title, text: line, source });
    } else if (/装扮|皮肤|衣装/.test(section.title) && !skinOrVariantCandidates.some((c) => c.classification === 'skin')) {
      const skinName = text.match(/[「“]([^」”]+)[」”]/)?.[1];
      // A generic section heading is not an identifiable skin.
      if (skinName) skinOrVariantCandidates.push({ id: `bwiki:${wiki}:${title}:${skinName}`, name: skinName,
        classification: 'skin', outfitDescription: text, loreStory: '', source });
    }
  }
  return { facts, stories, voiceLines, skinOrVariantCandidates, englishName, appearanceText: appearanceText.trim(),
    sources: [evidenceSource({ title: `BWiki：${title}`, url: source, sourceType: 'bwiki', externalId: `${wiki}:${page.pageid || title}`,
      rawText: raw, rawPayload: page })], warnings: [] };
}

export async function fetchBwikiCharacter(name: string, target: WorkTarget, fetcher: typeof fetch = fetch): Promise<Partial<UpstreamCharacterBundle> | null> {
  const wiki = WIKI_SUBSITE[target];
  if (!name.trim()) return null;
  if (!wiki) return { warnings: ['BWiki 未声明该作品对应站点，已跳过；不会将通用作品路由到原神。'] };
  const warnings: string[] = [];
  const search = async (query: string) => {
    const params = new URLSearchParams({ format: 'json', action: 'query', list: 'search', srsearch: query, srlimit: '6' });
    const url = `https://wiki.biligame.com/${wiki}/api.php?${params}`;
    const res = await fetchBwikiJson<{ query?: { search?: Array<{ title: string }> }; continue?: unknown }>(url, fetcher);
    if (!res.ok) { warnings.push(`BWiki (${wiki}) 搜索失败: ${res.reason}`); return []; }
    if (res.data.continue) warnings.push(`BWiki (${wiki}) 搜索「${query}」存在更多结果，本次仅读取首批候选，不能视为完整目录。`);
    return res.data.query?.search || [];
  };
  const read = async (title: string) => {
    const params = new URLSearchParams({ format: 'json', action: 'parse', prop: 'wikitext|images', page: title, redirects: '1', disableeditsection: '1' });
    const url = `https://wiki.biligame.com/${wiki}/api.php?${params}`;
    const res = await fetchBwikiJson<{ parse?: WikiPage; error?: { info?: string } }>(url, fetcher);
    if (!res.ok) { warnings.push(`BWiki (${wiki}) ${title} 读取失败: ${res.reason}`); return null; }
    if (!res.data.parse?.wikitext?.['*']) { warnings.push(`BWiki (${wiki}) ${title} 未返回正文`); return null; }
    return res.data.parse;
  };
  const hits = await search(name.trim());
  const main = hits.find((h) => h.title === name.trim()) || hits.find((h) => !h.title.includes('/'));
  if (!main) return { warnings: [...warnings, `BWiki (${wiki}) 未匹配角色：${name}`] };
  const first = await read(main.title);
  if (!first) return { warnings };
  const armorOwner = target === 'bh3' ? parseWikiTemplates(first.wikitext?.['*'] || '').find((t) => t.name === '女武神装甲')?.fields['角色名'] : undefined;
  const ownerName = stripWikiMarkup(armorOwner || main.title);
  const pages = [first];
  if (target === 'genshin') {
    const voice = await read(`${main.title}语音`); if (voice) pages.push(voice);
    const skins = await search(`insource:"适配角色=${main.title}"`);
    for (const hit of skins.slice(0, 6)) { if (pages.some((p) => p.title === hit.title)) continue; const page = await read(hit.title); if (page) pages.push(page); }
  } else if (target === 'bh3') {
    // Search titles are discovery only; only an actual armor template with the same owner is accepted.
    const armorHits = [...await search(`insource:"角色名=${ownerName}"`), ...hits];
    for (const hit of [...new Map(armorHits.map((h) => [h.title, h])).values()].filter((h) => h.title !== main.title && !h.title.includes('/') && !/图鉴|名册|PV$|攻略/.test(h.title)).slice(0, 8)) {
      const page = await read(hit.title); if (page) pages.push(page);
    }
  }
  const result: Partial<UpstreamCharacterBundle> = { resolvedName: ownerName, facts: [], stories: [], voiceLines: [], skinOrVariantCandidates: [], sources: [], assets: [], warnings };
  const fileOwners = new Map<string, string>();
  const allFiles: string[] = [];
  for (const page of pages) {
    const parsed = parseBwikiCharacterPage(page, target, ownerName);
    if (page !== first && target === 'bh3' && !parsed.skinOrVariantCandidates?.length) continue;
    for (const key of ['facts', 'stories', 'voiceLines', 'skinOrVariantCandidates', 'sources'] as const) {
      // Armor rarity/element facts belong to that form, not to the root character identity.
      if (target === 'bh3' && page !== first && key === 'facts') continue;
      (result[key] as unknown[]).push(...(parsed[key] || []));
    }
    result.englishName ||= parsed.englishName; result.appearanceText ||= parsed.appearanceText;
    const candidate = parsed.skinOrVariantCandidates?.[0];
    for (const file of page.images || []) {
      // Template-expanded navigation icons do not belong to this character.
      if (!file.includes(main.title) && !file.includes(page.title || main.title)) continue;
      if (candidate && (file.includes(candidate.name) || file.includes(main.title))) fileOwners.set(file.replace(/^(?:File|文件):/i, ''), candidate.name);
      allFiles.push(file);
    }
  }
  const files = [...new Set(allFiles)].filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !classifyBwikiImage(f).ignore).slice(0, 30);
  if (files.length) {
    const url = `https://wiki.biligame.com/${wiki}/api.php?action=query&titles=${encodeURIComponent(files.map((f) => `File:${f}`).join('|'))}&prop=imageinfo&iiprop=url|size&format=json`;
    const res = await fetchBwikiJson<{ query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; width?: number; height?: number }> }> } }>(url, fetcher);
    if (!res.ok) warnings.push(`BWiki 图片读取失败: ${res.reason}；文字证据仍保留。`);
    else {
      result.sources!.push(evidenceSource({ title: `BWiki 图片来源：${main.title}`, url, sourceType: 'bwiki', externalId: `${wiki}:imageinfo:${main.title}`,
        rawText: JSON.stringify(res.data), rawPayload: res.data, evidenceKind: 'structured' }));
      for (const p of Object.values(res.data.query?.pages || {})) {
      const image = p.imageinfo?.[0]; if (!image?.url || (image.width && image.height && Math.max(image.width, image.height) < 120)) continue;
      const file = (p.title || '').replace(/^(?:File|文件):/i, '');
      const cls = classifyBwikiImage(file); if (cls.ignore) continue;
      const skinName = fileOwners.get(file);
      const candidate = result.skinOrVariantCandidates?.find((c) => c.name === skinName);
      if (candidate) {
        if (file.includes('头像')) candidate.avatarUrl = image.url;
        else if (file.includes('立绘') || file.includes('全身')) candidate.portraitUrl = image.url;
      }
      result.assets!.push({ id: crypto.randomUUID(), kind: skinName ? (file.includes('头像') ? 'avatar' : 'reference') : cls.kind,
        category: skinName ? 'costume' : cls.category, title: file, url: image.url, source: `BWiki (${wiki})`,
        ...(skinName ? { skinName } : {}), width: image.width, height: image.height });
      }
    }
  }
  for (const candidate of result.skinOrVariantCandidates || []) {
    if (!candidate.outfitDescription) warnings.push(`${candidate.name}：来源没有具体衣装描述，已留空。`);
    if (!candidate.loreStory) warnings.push(`${candidate.name}：来源没有背景故事，已留空。`);
  }
  return result;
}
