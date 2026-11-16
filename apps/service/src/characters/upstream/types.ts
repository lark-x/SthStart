import type {
  CharacterAssetCategory,
  CharacterBirthday,
  CharacterUpstreamAssetCandidate,
  CharacterUpstreamEvidenceSource,
  CharacterUpstreamSourceId,
  CharacterVariantKind,
} from '@sthstart/contracts';

export interface UpstreamSkinOrVariantCandidate {
  id: string;
  name: string;
  classification: 'variant' | 'skin';
  variantKind?: CharacterVariantKind;
  outfitDescription: string;
  loreStory: string;
  avatarUrl?: string | null;
  portraitUrl?: string | null;
  source: string;
  isDefault?: boolean;
}

export interface UpstreamCharacterBundle {
  resolvedName: string;
  resolvedWork: string;
  englishName?: string;
  aliases: string[];
  originType: 'original' | 'ip';
  birthday?: CharacterBirthday;
  facts: string[];
  stories: Array<{ title: string; content: string; source: string }>;
  voiceLines: Array<{ title: string; text: string; source: string }>;
  dialogueSamples: string[];
  skinOrVariantCandidates: UpstreamSkinOrVariantCandidate[];
  assets: CharacterUpstreamAssetCandidate[];
  sources: CharacterUpstreamEvidenceSource[];
  warnings: string[];
}

export type WorkTarget = 'genshin' | 'starrail' | 'bh3' | 'zzz' | 'general';

export function inferWorkTarget(query: string, work?: string): WorkTarget {
  const combined = `${work || ''} ${query}`.toLowerCase();
  if (combined.includes('星穹铁道') || combined.includes('崩铁') || combined.includes('star rail') || combined.includes('hsr')) {
    return 'starrail';
  }
  if (combined.includes('崩坏3') || combined.includes('崩坏三') || combined.includes('bh3') || combined.includes('honkai impact')) {
    return 'bh3';
  }
  if (combined.includes('绝区零') || combined.includes('zzz')) {
    return 'zzz';
  }
  if (combined.includes('原神') || combined.includes('genshin')) {
    return 'genshin';
  }
  return 'general';
}

export function cleanUpstreamQuery(query: string, work?: string): { name: string; work: string } {
  const trimmed = query.trim();
  const match = trimmed.match(/^(.+?)[（(](.+?)[）)]$/);
  return {
    name: (match?.[1] ?? trimmed).trim(),
    work: (work?.trim() || match?.[2]?.trim() || ''),
  };
}

export function stripWikiMarkup(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref[^/]*\/>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|span|b|i|strong|em|small|center|font|ruby|rt|rp)[^>]*>/gi, ' ')
    .replace(/\[\[(?:文件|File|Image):[^\]]+\]\]/gi, '')
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createEmptyBundle(name: string, work: string): UpstreamCharacterBundle {
  return {
    resolvedName: name,
    resolvedWork: work,
    aliases: [],
    originType: work ? 'ip' : 'original',
    facts: [],
    stories: [],
    voiceLines: [],
    dialogueSamples: [],
    skinOrVariantCandidates: [],
    assets: [],
    sources: [],
    warnings: [],
  };
}

export function isPreferredSource(preferSources: readonly CharacterUpstreamSourceId[] | undefined, id: CharacterUpstreamSourceId): boolean {
  return !preferSources || preferSources.length === 0 || preferSources.includes(id);
}

export function dedupeAssets(items: CharacterUpstreamAssetCandidate[]): CharacterUpstreamAssetCandidate[] {
  const seen = new Set<string>();
  const out: CharacterUpstreamAssetCandidate[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

export type { CharacterAssetCategory };
