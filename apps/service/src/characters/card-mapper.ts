import { createHash } from 'node:crypto';
import type {
  CharacterCardCompatibility,
  CharacterDraft,
  CharacterFieldMapping,
  CharacterImportCandidate,
} from '@sthstart/contracts';
import type { ParsedCharacterCard } from './card-parser.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, max = 20_000): string {
  if (typeof value === 'string') return value.trim().slice(0, max);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function strings(value: unknown, maxItems = 30): string[] {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => stringValue(item, 2_000)).filter(Boolean))].slice(0, maxItems);
}

function lineStrings(value: unknown, maxItems = 30): string[] {
  if (typeof value === 'string') return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))].slice(0, maxItems);
  return strings(value, maxItems);
}

function hash(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function sourceData(card: Record<string, unknown>) {
  const data = record(card.data);
  return { value: Object.keys(data).length ? data : card, prefix: Object.keys(data).length ? '/data' : '' };
}

function pointer(prefix: string, field: string) { return `${prefix}/${field}`; }

function exampleBlocks(value: unknown): string[] {
  const raw = stringValue(value, 40_000);
  if (!raw) return [];
  return raw
    .split(/(?:^|\n)\s*<START>\s*(?:\n|$)/i)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function firstParagraph(value: string) {
  return value.split(/\n\s*\n/)[0]?.trim().slice(0, 2_000) || value.slice(0, 2_000);
}

export function mapCharacterCard(parsed: ParsedCharacterCard): {
  candidate: CharacterImportCandidate;
  compatibility: CharacterCardCompatibility;
} {
  if (!parsed.card) {
    throw new Error('character_card_metadata_missing');
  }
  const { value: source, prefix } = sourceData(parsed.card);
  const description = stringValue(source.description, 20_000);
  const summary = stringValue(source.summary) || stringValue(source.tagline) || firstParagraph(description);
  const personality = lineStrings(source.personality);
  const examples = exampleBlocks(source.mes_example ?? source.example_messages);
  const explicitAppearance = record(source.appearance);
  const appearanceDescription = stringValue(explicitAppearance.description ?? source.appearance_description);
  const hair = stringValue(explicitAppearance.hair ?? source.hair);
  const eyes = stringValue(explicitAppearance.eyes ?? source.eyes);
  const build = stringValue(explicitAppearance.build ?? source.build ?? source.body);
  const outfits = strings(explicitAppearance.outfits ?? explicitAppearance.outfit ?? source.outfit);
  const accessories = strings(explicitAppearance.accessories ?? source.accessories);
  const tags = strings(source.tags, 50);
  const isSceneCard = tags.some((tag) => /rpg|multiple|scene|world|setting/i.test(tag))
    || /\b(?:rpg|world setting|multiple people|multiple characters)\b/i.test(`${description} ${stringValue(source.first_mes)}`);

  const draft: CharacterDraft = {
    displayName: stringValue(source.name ?? parsed.card.name, 200),
    englishName: stringValue(source.extensions && record(source.extensions).englishName, 200),
    aliases: strings(source.aliases),
    originType: 'original',
    work: '',
    world: '',
    summary,
    identity: description,
    background: '',
    currentSituation: '',
    personality,
    motivations: [],
    beliefs: [],
    secrets: [],
    speech: { tone: '', habits: '', catchphrases: [], examples },
    likes: [],
    dislikes: [],
    fears: [],
    boundaries: [],
    appearance: {
      description: appearanceDescription,
      hair,
      eyes,
      build,
      outfits,
      accessories,
      stableFeatures: [],
      defaultOutfitId: null,
      referenceIds: [],
    },
    extraRules: '',
  };

  const mappings: CharacterFieldMapping[] = [];
  const map = (fieldPath: string, sourceField: string, value: unknown, status: CharacterFieldMapping['status'] = 'card_author', note?: string) => {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)) return;
    mappings.push({ fieldPath, sourcePointer: pointer(prefix, sourceField), valueHash: hash(value), status, ...(note ? { note } : {}) });
  };
  map('/displayName', 'name', draft.displayName);
  map('/identity', 'description', description, 'card_author', '原卡描述保留为人设原文。');
  map('/summary', source.summary ? 'summary' : source.tagline ? 'tagline' : 'description', summary, 'card_author', '摘要是确定性首段/摘要候选，不代表原卡字段同名。');
  map('/personality', 'personality', personality);
  map('/speech/examples', source.mes_example ? 'mes_example' : 'example_messages', examples, 'card_author', '保留 <START> 块边界和酒馆占位符，不执行宏。');
  map('/appearance/description', explicitAppearance.description ? 'appearance/description' : 'appearance_description', appearanceDescription, 'card_author', '仅采用卡片显式外貌字段；不会从名字推断外貌。');
  map('/appearance/hair', 'appearance/hair', hair);
  map('/appearance/eyes', 'appearance/eyes', eyes);
  map('/appearance/build', 'appearance/build', build);
  map('/appearance/outfits', 'appearance/outfits', outfits);
  map('/appearance/accessories', 'appearance/accessories', accessories);

  const knownFields = ['name', 'description', 'personality', 'mes_example', 'scenario', 'first_mes', 'alternate_greetings', 'creator', 'creator_notes', 'tags', 'character_version', 'system_prompt', 'post_history_instructions', 'character_book', 'extensions', 'appearance', 'appearance_description', 'hair', 'eyes', 'build', 'body', 'outfit', 'accessories'];
  const ignoredFields = Object.keys(source).filter((key) => !knownFields.includes(key));
  const warnings: string[] = [];
  if (source.scenario || source.first_mes || source.alternate_greetings) warnings.push('原卡场景和开场白已归档，默认不写入活动长期人设。');
  if (source.system_prompt || source.post_history_instructions || source.creator_notes) warnings.push('系统提示、历史提示和作者备注只归档，不作为本应用系统指令。');
  if (record(source.character_book).entries || Array.isArray(source.character_book)) warnings.push('世界书条目已保留，但首版不执行触发器。');
  if (isSceneCard) warnings.push('这张卡可能是场景/RPG 卡；不会自动拆分其中登场角色。');
  if (!parsed.card.spec && !parsed.card.data) warnings.push('检测到旧 V1 结构，只有核心字段会进入活动投影。');
  if (parsed.format === 'v3-json' || parsed.format === 'v3-png') warnings.push('V3 的未知多媒体/扩展内容已保留但未执行。');

  const characterBook = record(source.character_book);
  const compatibility: CharacterCardCompatibility = {
    format: parsed.format,
    supported: true,
    warnings,
    preservedFields: Object.keys(source),
    ignoredFields,
    worldBookEntries: Array.isArray(source.character_book)
      ? source.character_book.length
      : Array.isArray(characterBook.entries) ? characterBook.entries.length : 0,
    isSceneCard,
  };

  return {
    candidate: {
      draft,
      mappings,
      cover: { available: parsed.mimeType === 'image/png' || parsed.mimeType.startsWith('image/'), selectedForAvatar: false, selectedForReference: false },
      originalCard: parsed.card,
    },
    compatibility,
  };
}

export function mapCharacterImage(parsed: ParsedCharacterCard, filename?: string): {
  candidate: CharacterImportCandidate;
  compatibility: CharacterCardCompatibility;
} {
  const displayName = (filename || '未命名图片').replace(/\.[A-Za-z0-9]+$/, '').trim().slice(0, 200) || '未命名图片';
  const draft: CharacterDraft = {
    displayName,
    englishName: '', aliases: [], originType: 'original', work: '', world: '', summary: '', identity: '', background: '', currentSituation: '',
    personality: [], motivations: [], beliefs: [], secrets: [], speech: { tone: '', habits: '', catchphrases: [], examples: [] },
    likes: [], dislikes: [], fears: [], boundaries: [], appearance: {
      description: '', hair: '', eyes: '', build: '', outfits: [], accessories: [], stableFeatures: [], defaultOutfitId: null, referenceIds: [],
    }, extraRules: '',
  };
  return {
    candidate: { draft, mappings: [], cover: { available: true, selectedForAvatar: false, selectedForReference: false }, originalCard: {} },
    compatibility: {
      format: parsed.format, supported: true,
      warnings: ['这是普通图片，没有检测到角色卡元数据；确认后可作为头像或外观参考图使用。'],
      preservedFields: [], ignoredFields: [], worldBookEntries: 0, isSceneCard: false,
    },
  };
}

export function mapCharacterCardForDetail(card: Record<string, unknown>, sourceUrl: string) {
  const description = stringValue(record(card).definition_character_description ?? record(card).description, 20_000);
  const data = {
    name: stringValue(card.name),
    inChatName: stringValue(card.inChatName),
    author: card.author == null ? null : String(card.author),
    sourceUrl,
    description,
    tagline: stringValue(card.tagline),
    scenario: stringValue(card.definition_scenario),
    firstMessage: stringValue(card.definition_first_message),
    exampleMessages: stringValue(card.definition_example_messages),
    creatorNotes: stringValue(card.description),
    systemPrompt: stringValue(card.definition_system_prompt),
    postHistoryInstructions: stringValue(card.definition_post_history_prompt),
    characterVersion: card.versionId == null ? null : String(card.versionId),
  };
  return data;
}
