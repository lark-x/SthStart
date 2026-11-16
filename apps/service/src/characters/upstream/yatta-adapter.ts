import crypto from 'node:crypto';
import type { UpstreamCharacterBundle } from './types.js';
import { stripWikiMarkup } from './types.js';

interface YattaAvatarIndexEntry {
  id: number;
  name: string;
  route?: string;
  rank?: number;
  element?: string;
  weaponType?: string;
  icon?: string;
  birthday?: [number, number];
}

let cachedAvatarIndex: { data: Record<string, YattaAvatarIndexEntry>; expiresAt: number } | null = null;

const ELEMENT_MAP: Record<string, string> = {
  Wind: '风',
  Rock: '岩',
  Electric: '雷',
  Grass: '草',
  Water: '水',
  Fire: '火',
  Ice: '冰',
};

const REGION_MAP: Record<string, string> = {
  MONDSTADT: '蒙德',
  LIYUE: '璃月',
  INAZUMA: '稻妻',
  SUMERU: '须弥',
  FONTAINE: '枫丹',
  NATLAN: '纳塔',
  SNEZHNAYA: '至冬',
  NODKRAI: '挪德卡莱',
};

function cleanGameRichText(text: string): string {
  return stripWikiMarkup(
    (text || '')
      .replace(/<color=[^>]+>([\s\S]*?)<\/color>/gi, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\{NICKNAME\}/g, '旅行者')
      .replace(/\{M#([^}]+)\}\{F#([^}]+)\}/g, '$1/$2'),
  );
}

async function fetchAvatarIndex(fetcher: typeof fetch): Promise<Record<string, YattaAvatarIndexEntry>> {
  if (cachedAvatarIndex && cachedAvatarIndex.expiresAt > Date.now()) {
    return cachedAvatarIndex.data;
  }
  const res = await fetcher('https://gi.yatta.moe/api/v2/chs/avatar', {
    headers: { 'User-Agent': 'SthStart/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`yatta_index_http_${res.status}`);
  const json = (await res.json()) as { data?: { items?: Record<string, YattaAvatarIndexEntry> } };
  const items = json.data?.items || {};
  cachedAvatarIndex = { data: items, expiresAt: Date.now() + 30 * 60_000 };
  return items;
}

export async function fetchYattaGenshinCharacter(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<Partial<UpstreamCharacterBundle> | null> {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;

  try {
    const items = await fetchAvatarIndex(fetcher);
    const entries = Object.values(items);
    const matched = entries.find((item) => item.name?.toLowerCase() === needle || item.route?.toLowerCase() === needle)
      || entries.find((item) => item.name?.toLowerCase().includes(needle) || item.route?.toLowerCase().includes(needle));
    if (!matched) return null;

    const [detailRes, fetterRes] = await Promise.all([
      fetcher(`https://gi.yatta.moe/api/v2/chs/avatar/${matched.id}`, {
        headers: { 'User-Agent': 'SthStart/1.0' },
        signal: AbortSignal.timeout(8_000),
      }),
      fetcher(`https://gi.yatta.moe/api/v2/chs/avatarFetter/${matched.id}`, {
        headers: { 'User-Agent': 'SthStart/1.0' },
        signal: AbortSignal.timeout(8_000),
      }),
    ]);

    if (!detailRes.ok) return null;
    const detailJson = (await detailRes.json()) as {
      data?: {
        id: number;
        name: string;
        route?: string;
        element?: string;
        region?: string;
        icon?: string;
        birthday?: [number, number];
        fetter?: {
          title?: string;
          detail?: string;
          constellation?: string;
          native?: string;
          cv?: Record<string, string>;
        };
        other?: {
          costume?: Array<{
            name?: string;
            description?: string;
            isDefault?: boolean;
            icon?: string;
          }>;
        };
      };
    };

    const detail = detailJson.data;
    if (!detail) return null;

    const fetterJson = fetterRes.ok
      ? ((await fetterRes.json()) as {
          data?: {
            story?: Record<string, { title?: string; text?: string }>;
            quotes?: Record<string, { title?: string; text?: string }>;
          };
        })
      : null;

    const facts: string[] = [];
    if (detail.fetter?.title) facts.push(`称号：${detail.fetter.title}`);
    if (detail.fetter?.native) facts.push(`所属：${detail.fetter.native}`);
    else if (detail.region && REGION_MAP[detail.region]) facts.push(`地区：${REGION_MAP[detail.region]}`);
    if (detail.element && ELEMENT_MAP[detail.element]) facts.push(`元素：${ELEMENT_MAP[detail.element]}`);
    if (detail.fetter?.detail) facts.push(`简介：${cleanGameRichText(detail.fetter.detail)}`);
    if (detail.fetter?.cv?.CHS) facts.push(`汉语配音：${detail.fetter.cv.CHS}`);

    const birthday = detail.birthday && detail.birthday[0] > 0 && detail.birthday[1] > 0
      ? { status: 'known' as const, month: detail.birthday[0], day: detail.birthday[1], calendar: 'gregorian' as const }
      : undefined;

    const stories = Object.values(fetterJson?.data?.story || {})
      .filter((s) => s.title && s.text)
      .map((s) => ({
        title: String(s.title),
        content: cleanGameRichText(String(s.text)),
        source: 'Project Amber (Yatta)',
      }));

    // 优先抽取能体现性格、好恶、谈吐与心理边界的代表性语音
    const priorityKeywords = ['初次见面', '闲聊', '早上好', '晚上好', '晚安', '关于', '想要了解', '有什么想', '喜好', '讨厌', '烦恼', '生日', '突破', '倒下'];
    const allQuotes = Object.values(fetterJson?.data?.quotes || {}).filter((q) => q.title && q.text);
    const prioritized = [
      ...allQuotes.filter((q) => priorityKeywords.some((kw) => String(q.title).includes(kw))),
      ...allQuotes.filter((q) => !priorityKeywords.some((kw) => String(q.title).includes(kw))),
    ].slice(0, 26);

    const voiceLines = prioritized.map((q) => ({
      title: String(q.title),
      text: cleanGameRichText(String(q.text)),
      source: 'Project Amber (Yatta)',
    }));

    const assets: UpstreamCharacterBundle['assets'] = [];
    const defaultIcon = detail.icon || matched.icon;
    if (defaultIcon) {
      const avatarUrl = `https://gi.yatta.moe/assets/UI/${defaultIcon}.png`;
      const gachaName = defaultIcon.replace('UI_AvatarIcon_', 'UI_Gacha_AvatarImg_');
      const portraitUrl = `https://gi.yatta.moe/assets/UI/${gachaName}.png`;
      assets.push({
        id: crypto.randomUUID(),
        kind: 'avatar',
        category: 'avatar',
        title: `${detail.name} 官方头像`,
        url: avatarUrl,
        previewUrl: avatarUrl,
        source: 'Project Amber (Yatta)',
        recommended: true,
      });
      assets.push({
        id: crypto.randomUUID(),
        kind: 'portrait',
        category: 'portrait',
        title: `${detail.name} 官方抽卡立绘`,
        url: portraitUrl,
        previewUrl: portraitUrl,
        source: 'Project Amber (Yatta)',
        recommended: true,
      });
    }

    const skinOrVariantCandidates: UpstreamCharacterBundle['skinOrVariantCandidates'] = [];
    for (const costume of detail.other?.costume || []) {
      const skinName = (costume.name || '').trim();
      if (!skinName) continue;
      const skinDesc = cleanGameRichText(costume.description || '');
      const skinIconUrl = costume.icon ? `https://gi.yatta.moe/assets/UI/${costume.icon}.png` : null;
      const skinPortraitUrl = costume.icon
        ? `https://gi.yatta.moe/assets/UI/${costume.icon.replace('UI_AvatarIcon_', 'UI_Costume_')}.png`
        : null;

      skinOrVariantCandidates.push({
        id: crypto.randomUUID(),
        name: skinName,
        classification: 'skin',
        outfitDescription: skinDesc || `${detail.name}的「${skinName}」装扮。`,
        loreStory: skinDesc,
        avatarUrl: skinIconUrl,
        portraitUrl: skinPortraitUrl,
        source: 'Project Amber (Yatta)',
        isDefault: Boolean(costume.isDefault),
      });

      if (!costume.isDefault && skinPortraitUrl) {
        assets.push({
          id: crypto.randomUUID(),
          kind: 'reference',
          category: 'costume',
          title: `皮肤立绘 · ${skinName}`,
          url: skinPortraitUrl,
          previewUrl: skinPortraitUrl,
          source: 'Project Amber (Yatta)',
          skinName,
          recommended: true,
        });
      }
      if (!costume.isDefault && skinIconUrl) {
        assets.push({
          id: crypto.randomUUID(),
          kind: 'avatar',
          category: 'costume',
          title: `皮肤头像 · ${skinName}`,
          url: skinIconUrl,
          previewUrl: skinIconUrl,
          source: 'Project Amber (Yatta)',
          skinName,
        });
      }
    }

    const excerptLines = [
      ...facts,
      ...stories.slice(0, 6).map((s) => `【${s.title}】\n${s.content}`),
      ...voiceLines.slice(0, 14).map((v) => `【语音·${v.title}】${v.text}`),
    ];

    return {
      resolvedName: detail.name,
      resolvedWork: '原神',
      englishName: detail.route || undefined,
      aliases: detail.route ? [detail.route] : [],
      originType: 'ip',
      birthday,
      facts,
      stories,
      voiceLines,
      skinOrVariantCandidates,
      assets,
      sources: [
        {
          title: `Project Amber：${detail.name}`,
          url: `https://gi.yatta.moe/chs/archive/avatar/${detail.id}/${detail.route || ''}`,
          excerpt: excerptLines.join('\n\n').slice(0, 12_000),
          sourceType: 'yatta',
        },
      ],
    };
  } catch (error) {
    return {
      warnings: [`Yatta 原神数据源读取失败: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
