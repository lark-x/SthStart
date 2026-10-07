import type { ActivityLora } from '@sthstart/contracts';

/**
 * Tag conflict groups ported from Linshe (galgame-with-comfyUI) imagePromptPreparer.
 * When multiple conflicting tags are present in the same prompt, only the highest
 * priority or first-encountered tag is preserved.
 */
export const CONFLICT_GROUPS: string[][] = [
  ['close-up', 'close_up', 'full_body', 'wide_shot', 'cowboy_shot', 'upper_body', 'medium_shot'],
  ['from_front', 'from_behind', 'back_view'],
  ['from_above', 'from_below'],
  ['looking_at_viewer', 'facing_away', 'looking_away'],
  ['standing', 'sitting', 'lying', 'on_back', 'walking', 'running'],
  ['open_mouth', 'closed_mouth'],
  ['open_eyes', 'closed_eyes', 'winking'],
  ['night', 'daytime', 'bright_sunlight'],
];

export const MULTI_PERSON_PATTERN = /\b(two|three|duo|couple|group|crowd|multiple|2girls|2boys|3girls|3boys)\b|(?:\b1girl\s+1boy\b)/i;

/**
 * Extract base Danbooru tag by stripping SD weights ((tag:1.2)), brackets [], {}
 */
export function extractBaseTag(tag: string): string {
  if (!tag) return '';
  let s = tag.trim();
  s = s.replace(/^[\s(\[{<]+/, '').replace(/[\s)\]}>]+$/, '');
  s = s.replace(/:\s*[-+]?(?:\d*\.?\d+)\s*$/, '');
  return s.trim();
}

function normalizeTag(tag: string): string {
  const base = extractBaseTag(tag);
  return base
    .toLowerCase()
    .replace(/[_\s-]+/g, '_');
}

/**
 * Clean redundant whitespace, Chinese punctuation, double commas, and normalize separator layout.
 */
export function cleanPromptFormatting(text: string): string {
  return text
    .replace(/[\r\n]+/g, ', ')
    .replace(/，/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,{2,}/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim();
}

export interface ComposeActivityPromptOptions {
  /** Keep actor count/poses untouched when compiling structured studio sources. */
  preserveActorSemantics?: boolean;
  /** Explicit known single-actor scope; absence never guesses a person count. */
  isSingleActor?: boolean;
  /** Active LoRA trigger words */
  loraTriggers?: string[];
  /** Optional quality prefix (e.g. 'masterpiece, best quality, highres') */
  qualityPrefix?: string;
}

/**
 * Apply Danbooru tag normalization, solo enforcement, and conflict resolution
 * inspired by Linshe v3.6.2 imagePromptPreparer.
 */
export function composeActivityPrompt(prompt: string, options: ComposeActivityPromptOptions = {}): string {
  const cleaned = cleanPromptFormatting(prompt);
  if (!cleaned) return '';

  const explicitSingle = options.isSingleActor === true;
  const shouldEnforceSolo = explicitSingle && !options.preserveActorSemantics;

  // Split into segments
  let segments = cleaned.split(/,\s*/).map((s) => s.trim()).filter(Boolean);

  // 1. Solo enforcer & multi-person exclusion
  if (shouldEnforceSolo) {
    // Filter out accidental multi-person tags
    const multiTags = new Set([
      '2girls', '2boys', '3girls', '3boys', 'multiple_girls', 'multiple_boys',
      'crowd', 'group', 'duo', 'couple', 'two_persons', 'two_people'
    ]);
    segments = segments.filter((s) => !multiTags.has(normalizeTag(s)));

    const hasSolo = segments.some((s) => normalizeTag(s) === 'solo');
    if (!hasSolo) {
      // Find where to insert solo: right after 1boy / 1girl or at the front
      const charIndex = segments.findIndex((s) => /^(?:1boy|1girl|1other)$/i.test(s));
      if (charIndex >= 0) {
        segments.splice(charIndex + 1, 0, 'solo');
      } else {
        segments.unshift('solo');
      }
    }
  }

  // 2. Gaze / Sleep rule
  if (shouldEnforceSolo && /\b(?:sleep|sleeping|asleep|unconscious|nap|napping)\b/i.test(cleaned)) {
    const hasClosedEyes = segments.some((s) => normalizeTag(s) === 'closed_eyes');
    if (!hasClosedEyes) segments.push('closed_eyes');
    const gazeTags = new Set(['looking_at_viewer', 'direct_eye_contact', 'open_eyes']);
    segments = segments.filter((s) => !gazeTags.has(normalizeTag(s)));
  }

  // 3. Facing away rule
  if (shouldEnforceSolo && /\b(?:from behind|back view|facing away)\b/i.test(cleaned) && !/\bover shoulder\b/i.test(cleaned)) {
    const gazeTags = new Set(['looking_at_viewer', 'direct_eye_contact']);
    segments = segments.filter((s) => !gazeTags.has(normalizeTag(s)));
  }

  // 4. Lighting / Day vs Night rule
  if (/\b(?:night|nighttime|evening)\b/i.test(cleaned)) {
    const dayTags = new Set(['daytime', 'bright_sunlight']);
    segments = segments.filter((s) => !dayTags.has(normalizeTag(s)));
  } else if (/\b(?:day|daytime|morning|afternoon)\b/i.test(cleaned)) {
    const nightTags = new Set(['night', 'moonlight']);
    segments = segments.filter((s) => !nightTags.has(normalizeTag(s)));
  }

  // 5. Conflict group resolution: keep first appearance, drop later conflicting ones
  for (const group of CONFLICT_GROUPS) {
    // Different actors can legitimately have opposite poses, gazes and expressions.
    if (!shouldEnforceSolo && group.some(tag => ['standing', 'looking_at_viewer', 'open_mouth', 'open_eyes'].includes(tag))) continue;
    const groupNorms = new Set(group.map(normalizeTag));
    let matchedFirst = false;
    segments = segments.filter((s) => {
      const norm = normalizeTag(s);
      if (groupNorms.has(norm)) {
        if (!matchedFirst) {
          matchedFirst = true;
          return true;
        }
        return false;
      }
      return true;
    });
  }

  // 6. Deduplication preserving original order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const seg of segments) {
    const norm = normalizeTag(seg);
    if (!seen.has(norm)) {
      seen.add(norm);
      deduped.push(seg);
    }
  }

  if (options.qualityPrefix) {
    const qTags = options.qualityPrefix.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    const existing = new Set(deduped.map(normalizeTag));
    const toPrepend = qTags.filter((t) => !existing.has(normalizeTag(t)));
    if (toPrepend.length) {
      deduped.unshift(...toPrepend);
    }
  }

  if (options.loraTriggers && options.loraTriggers.length) {
    const existing = new Set(deduped.map((s) => extractBaseTag(s).toLowerCase()));
    const toPrepend: string[] = [];
    for (const raw of options.loraTriggers) {
      for (const tag of cleanPromptFormatting(raw).split(/,\s*/)) {
        const key = extractBaseTag(tag).toLowerCase();
        if (!key || existing.has(key)) continue;
        existing.add(key);
        toPrepend.push(tag);
      }
    }
    if (toPrepend.length) {
      deduped.unshift(...toPrepend);
    }
  }

  return cleanPromptFormatting(deduped.join(', '));
}

/**
 * Prepend LoRA trigger words to the front of the prompt so CLIP attention
 * gives them top priority, instead of appending them at the end.
 */
export function prependLoraTriggerWords(prompt: string, loras: ActivityLora[]): string {
  const result = cleanPromptFormatting(prompt);
  const existing = result.toLowerCase();
  const additions = [...new Set(loras.filter((item) => item.enabled).map((item) => item.triggerWord.trim()).filter(Boolean))]
    .filter((word) => !existing.includes(word.toLowerCase()));

  if (!additions.length) return result;
  return `${additions.join(', ')}, ${result}`;
}
