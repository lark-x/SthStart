import type {
  CharacterAssetCategory,
  CharacterBirthday,
  CharacterUpstreamAssetCandidate,
  CharacterUpstreamEvidenceSource,
  CharacterUpstreamSourceId,
  CharacterVariantKind,
} from '@sthstart/contracts';
import { createHash } from 'node:crypto';

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
  /** Only explicit textual descriptions, never guessed from the existence of an image. */
  appearanceText?: string;
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
  let text = raw
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/\[\[(?:文件|File|Image):[^\]]+\]\]/gi, '')
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Preserve display text of nested formatting templates before removing structural templates.
  for (let depth = 0; depth < 12; depth += 1) {
    const next = text.replace(/\{\{([^{}]*)\}\}/g, (_all, inner: string) => {
      const [name, ...parts] = inner.split('|');
      return /^(?:黑幕|颜色|color|lang|注音|ruby)$/i.test(name.trim()) ? (parts.at(-1) || '') : ' ';
    });
    if (next === text) break;
    text = next;
  }
  return text
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
    .replace(/__[A-Z_]+__/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function evidenceSource(input: {
  title: string; url: string | null; sourceType: string; externalId: string;
  rawText: string; rawPayload?: unknown; evidenceKind?: 'fulltext' | 'structured' | 'snippet';
}): CharacterUpstreamEvidenceSource {
  return { ...input, provider: input.sourceType, excerpt: input.rawText.slice(0, 12_000),
    contentHash: createHash('sha256').update(input.rawText).digest('hex'), retrievedAt: new Date().toISOString(),
    evidenceKind: input.evidenceKind || 'fulltext' };
}

/** Split only at the current template/link depth so nested | and = remain in their values. */
export function parseWikiTemplates(raw: string): Array<{ name: string; fields: Record<string, string> }> {
  const clean = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const out: Array<{ name: string; fields: Record<string, string> }> = [];
  const stack: number[] = [];
  for (let i = 0; i < clean.length - 1; i += 1) {
    if (clean.slice(i, i + 2) === '{{') { stack.push(i + 2); i += 1; }
    else if (clean.slice(i, i + 2) === '}}' && stack.length) {
      const start = stack.pop()!;
      const body = clean.slice(start, i);
      const parts: string[] = []; let braces = 0; let links = 0; let at = 0;
      for (let p = 0; p < body.length; p += 1) {
        const pair = body.slice(p, p + 2);
        if (pair === '{{') { braces += 1; p += 1; }
        else if (pair === '}}') { braces -= 1; p += 1; }
        else if (pair === '[[') { links += 1; p += 1; }
        else if (pair === ']]') { links -= 1; p += 1; }
        else if (body[p] === '|' && !braces && !links) { parts.push(body.slice(at, p)); at = p + 1; }
      }
      parts.push(body.slice(at));
      const name = parts.shift()?.trim().replace(/^(?:模板|Template):/i, '') || '';
      const fields: Record<string, string> = {};
      for (const part of parts) { const eq = part.indexOf('='); if (eq > 0) fields[part.slice(0, eq).trim()] = part.slice(eq + 1).trim(); }
      out.push({ name, fields }); i += 1;
    }
  }
  return out;
}

/** Thin menus, placeholders and index snippets cannot suppress fallback retrieval. */
export function hasSubstantiveEvidence(bundle: Pick<UpstreamCharacterBundle, 'stories' | 'voiceLines' | 'dialogueSamples'>): boolean {
  const text = bundle.stories.map((s) => s.content).filter((s) => !/这里是|待补充|暂无|施工中/.test(s)).join('');
  return text.replace(/\s/g, '').length >= 400 || bundle.voiceLines.filter((v) => v.text.length >= 12).length >= 5
    || bundle.dialogueSamples.filter((s) => s.length >= 30).length >= 5;
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
