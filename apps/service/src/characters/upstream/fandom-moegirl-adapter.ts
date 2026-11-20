import crypto from 'node:crypto';
import type { UpstreamCharacterBundle, WorkTarget } from './types.js';
import { evidenceSource, parseWikiTemplates, stripWikiMarkup } from './types.js';

const FANDOM_HOST: Record<WorkTarget, string | null> = {
  genshin: 'genshin-impact.fandom.com',
  starrail: 'honkai-star-rail.fandom.com',
  bh3: 'honkaiimpact3.fandom.com',
  zzz: 'zenless-zone-zero.fandom.com',
  general: null,
};

export async function fetchMoegirlCharacter(
  name: string,
  work: string,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const warnings: string[] = [];

  try {
    const candidateTitles = work
      ? [`${trimmed}(${work})`, `${trimmed}(游戏《${work}》角色)`, trimmed]
      : [trimmed];

    for (const title of candidateTitles) {
      const endpoint = new URL('https://mzh.moegirl.org.cn/api.php');
      endpoint.search = new URLSearchParams({
        action: 'query',
        titles: title,
        redirects: '1',
        prop: 'extracts',
        explaintext: '1',
        format: 'json',
        origin: '*',
      }).toString();

      const res = await fetcher(endpoint, {
        headers: { Accept: 'application/json', 'User-Agent': 'SthStart/1.0' },
        signal: AbortSignal.timeout(7_000),
      });
      if (!res.ok) { warnings.push(`萌娘百科 ${title} HTTP ${res.status}`); continue; }
      const json = (await res.json()) as {
        query?: { pages?: Record<string, { title?: string; extract?: string; missing?: boolean }> };
      };
      const page = Object.values(json.query?.pages ?? {})[0];
      if (page && !page.missing && page.extract?.trim()) {
        const text = page.extract.trim();
        return {
          resolvedName: trimmed,
          stories: [{ title: `萌娘百科：${page.title ?? title}`, content: text, source: '萌娘百科' }],
          sources: [evidenceSource({ title: `萌娘百科：${page.title ?? title}`, url: `https://zh.moegirl.org.cn/${encodeURIComponent(page.title ?? title)}`,
            rawText: text, rawPayload: json, sourceType: 'moegirl', externalId: page.title || title })],
          warnings,
        };
      }
    }
  } catch (error) {
    return { warnings: [`萌娘百科读取失败: ${error instanceof Error ? error.message : String(error)}`] };
  }
  return { warnings: [...warnings, `萌娘百科未找到 ${trimmed} 的可用正文。`] };
}

export async function fetchFandomCharacter(
  searchName: string,
  target: WorkTarget,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const host = FANDOM_HOST[target];
  if (!searchName.trim()) return null;
  if (!host) return { warnings: ['Fandom 未声明该作品站点，无法可靠路由。'] };

  try {
    const searchUrl = `https://${host}/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchName.trim())}&srlimit=5&format=json`;
    const searchRes = await fetcher(searchUrl, {
      headers: { 'User-Agent': 'SthStart/1.0' },
      signal: AbortSignal.timeout(7_000),
    });
    if (!searchRes.ok) return { warnings: [`Fandom 搜索 HTTP ${searchRes.status}`] };
    const searchJson = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const hits = searchJson.query?.search || [];
    if (!hits.length) return { warnings: [`Fandom 未检索到 ${searchName}。`] };

    const mainTitle = hits.find((h) => !h.title.includes('/'))?.title || hits[0].title;
    const parseUrl = `https://${host}/api.php?action=parse&page=${encodeURIComponent(mainTitle)}&prop=wikitext&format=json`;
    const pageImgUrl = `https://${host}/api.php?action=query&titles=${encodeURIComponent(mainTitle)}&prop=pageimages&format=json&pithumbsize=1024`;

    const [parseRes, imgRes] = await Promise.all([
      fetcher(parseUrl, { headers: { 'User-Agent': 'SthStart/1.0' }, signal: AbortSignal.timeout(7_000) }),
      fetcher(pageImgUrl, { headers: { 'User-Agent': 'SthStart/1.0' }, signal: AbortSignal.timeout(6_000) }),
    ]);

    const stories: UpstreamCharacterBundle['stories'] = [];
    const sources: UpstreamCharacterBundle['sources'] = [];
    if (parseRes.ok) {
      const parseJson = (await parseRes.json()) as { parse?: { wikitext?: { '*'?: string } } };
      const raw = parseJson.parse?.wikitext?.['*'] || '';
      const wt = stripWikiMarkup(raw);
      sources.push(evidenceSource({ title: `Fandom Wiki：${mainTitle}`, url: `https://${host}/wiki/${encodeURIComponent(mainTitle)}`, sourceType: 'fandom', externalId: mainTitle, rawText: raw, rawPayload: parseJson }));
      if (wt.length > 60) {
        stories.push({
          title: `Fandom (${mainTitle})`,
          content: wt,
          source: 'Fandom Wiki',
        });
      }
    }

    const assets: UpstreamCharacterBundle['assets'] = [];
    if (imgRes.ok) {
      const imgJson = (await imgRes.json()) as {
        query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
      };
      const thumb = Object.values(imgJson.query?.pages || {})[0]?.thumbnail?.source;
      if (thumb) {
        assets.push({
          id: crypto.randomUUID(),
          kind: 'portrait',
          category: 'portrait',
          title: `Fandom 官方百科图 (${mainTitle})`,
          url: thumb,
          previewUrl: `/api/admin/proxy-image?url=${encodeURIComponent(thumb)}`,
          source: 'Fandom Wiki',
        });
      }
    }

    // Search results are discovery only. Parse each armor body and verify its explicit owner.
    const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
    const warnings: string[] = [];
    if (!parseRes.ok) warnings.push(`Fandom ${mainTitle} 正文 HTTP ${parseRes.status}`);
    if (!imgRes.ok) warnings.push(`Fandom ${mainTitle} 图片 HTTP ${imgRes.status}；正文仍保留。`);
    if (target === 'bh3') {
      for (const hit of hits.filter((h) => h.title !== mainTitle && !h.title.includes('/')).slice(0, 4)) {
        const response = await fetcher(`https://${host}/api.php?action=parse&page=${encodeURIComponent(hit.title)}&prop=wikitext&format=json`,
          { headers: { 'User-Agent': 'SthStart/1.0' }, signal: AbortSignal.timeout(7_000) });
        if (!response.ok) { warnings.push(`Fandom 装甲 ${hit.title} 正文 HTTP ${response.status}`); continue; }
        const payload = await response.json() as { parse?: { wikitext?: { '*'?: string } } };
        const raw = payload.parse?.wikitext?.['*'] || '';
        const template = parseWikiTemplates(raw).find((t) => /battlesuit|女武神装甲/i.test(t.name));
        const owner = stripWikiMarkup(template?.fields.character || template?.fields.Character || template?.fields['角色名'] || '');
        if (!owner || ![mainTitle, searchName].some((name) => name.trim().toLowerCase() === owner.toLowerCase())) {
          warnings.push(`Fandom ${hit.title} 缺少可验证的同角色装甲归属，未创建形态。`); continue;
        }
        const url = `https://${host}/wiki/${encodeURIComponent(hit.title.replace(/\s+/g, '_'))}`;
        sources.push(evidenceSource({ title: `Fandom 装甲：${hit.title}`, url, sourceType: 'fandom', externalId: hit.title, rawText: raw, rawPayload: payload }));
        skinOrVariantCandidates.push({ id: `fandom:${host}:${hit.title}`, name: hit.title, classification: 'variant', variantKind: 'stage',
          outfitDescription: stripWikiMarkup(template?.fields.appearance || template?.fields['外观描述'] || ''),
          loreStory: stripWikiMarkup(template?.fields.story || template?.fields['背景故事'] || ''), source: url });
      }
    }

    if (!stories.length && !assets.length && !skinOrVariantCandidates.length) return { warnings: [...warnings, 'Fandom 未取得可用正文或资产。'] };

    return {
      stories,
      assets,
      skinOrVariantCandidates,
      sources,
      warnings,
    };
  } catch (error) {
    return { warnings: [`Fandom 读取失败: ${error instanceof Error ? error.message : String(error)}`] };
  }
}
