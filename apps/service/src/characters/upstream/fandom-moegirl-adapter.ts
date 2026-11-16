import crypto from 'node:crypto';
import type { UpstreamCharacterBundle, WorkTarget } from './types.js';
import { stripWikiMarkup } from './types.js';

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
      if (!res.ok) continue;
      const json = (await res.json()) as {
        query?: { pages?: Record<string, { title?: string; extract?: string; missing?: boolean }> };
      };
      const page = Object.values(json.query?.pages ?? {})[0];
      if (page && !page.missing && page.extract?.trim()) {
        const text = page.extract.trim().slice(0, 12_000);
        return {
          resolvedName: trimmed,
          stories: [{ title: `萌娘百科：${page.title ?? title}`, content: text, source: '萌娘百科' }],
          sources: [
            {
              title: `萌娘百科：${page.title ?? title}`,
              url: `https://zh.moegirl.org.cn/${encodeURIComponent(page.title ?? title)}`,
              excerpt: text,
              sourceType: 'moegirl',
            },
          ],
        };
      }
    }
  } catch {
    // fallback handled by caller
  }
  return null;
}

export async function fetchFandomCharacter(
  searchName: string,
  target: WorkTarget,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const host = FANDOM_HOST[target];
  if (!host || !searchName.trim()) return null;

  try {
    const searchUrl = `https://${host}/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchName.trim())}&srlimit=5&format=json`;
    const searchRes = await fetcher(searchUrl, {
      headers: { 'User-Agent': 'SthStart/1.0' },
      signal: AbortSignal.timeout(7_000),
    });
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string }> };
    };
    const hits = searchJson.query?.search || [];
    if (!hits.length) return null;

    const mainTitle = hits.find((h) => !h.title.includes('/'))?.title || hits[0].title;
    const parseUrl = `https://${host}/api.php?action=parse&page=${encodeURIComponent(mainTitle)}&prop=wikitext&format=json`;
    const pageImgUrl = `https://${host}/api.php?action=query&titles=${encodeURIComponent(mainTitle)}&prop=pageimages&format=json&pithumbsize=1024`;

    const [parseRes, imgRes] = await Promise.all([
      fetcher(parseUrl, { headers: { 'User-Agent': 'SthStart/1.0' }, signal: AbortSignal.timeout(7_000) }),
      fetcher(pageImgUrl, { headers: { 'User-Agent': 'SthStart/1.0' }, signal: AbortSignal.timeout(6_000) }),
    ]);

    const stories: UpstreamCharacterBundle['stories'] = [];
    if (parseRes.ok) {
      const parseJson = (await parseRes.json()) as { parse?: { wikitext?: { '*'?: string } } };
      const wt = stripWikiMarkup(parseJson.parse?.wikitext?.['*'] || '');
      if (wt.length > 60) {
        stories.push({
          title: `Fandom (${mainTitle})`,
          content: wt.slice(0, 8_000),
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

    // 崩坏三英文 Fandom 搜索命中的装甲形态补充
    const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
    if (target === 'bh3') {
      for (const hit of hits.slice(0, 5)) {
        if (hit.title === mainTitle || hit.title.includes('/')) continue;
        skinOrVariantCandidates.push({
          id: crypto.randomUUID(),
          name: hit.title,
          classification: 'variant',
          variantKind: 'stage',
          outfitDescription: `崩坏三装甲形态「${hit.title}」外观造型。`,
          loreStory: `崩坏三阶段性装甲形态「${hit.title}」（来自 Fandom Wiki 检索）。`,
          source: 'Fandom Wiki',
        });
      }
    }

    if (!stories.length && !assets.length && !skinOrVariantCandidates.length) return null;

    return {
      stories,
      assets,
      skinOrVariantCandidates,
      sources: stories.length
        ? [{
            title: `Fandom Wiki：${mainTitle}`,
            url: `https://${host}/wiki/${encodeURIComponent(mainTitle.replace(/\s+/g, '_'))}`,
            excerpt: stories[0].content,
            sourceType: 'fandom',
          }]
        : [],
    };
  } catch {
    return null;
  }
}
