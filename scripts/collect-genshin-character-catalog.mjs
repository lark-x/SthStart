#!/usr/bin/env node
/**
 * Collect a reviewable index of Genshin Impact character-card candidates from
 * the same Character Tavern provider used by the character-library import UI.
 *
 * This script deliberately writes metadata and compatibility measurements only;
 * it does not create or update character-library records and does not archive
 * third-party card bytes in the repository.
 *
 * Usage:
 *   node --import tsx/esm scripts/collect-genshin-character-catalog.mjs
 *   node --import tsx/esm scripts/collect-genshin-character-catalog.mjs --pages=3 --no-download
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CharacterTavernProvider } from '../apps/service/src/characters/source-providers/character-tavern.ts';
import { mapCharacterCard } from '../apps/service/src/characters/card-mapper.ts';
import { parseCharacterCard } from '../apps/service/src/characters/card-parser.ts';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(root, 'docs/development/reviews/genshin-character-card-catalog.json');
const args = new Map(process.argv.slice(2).filter((value) => value.startsWith('--')).map((value) => {
  const [key, rawValue] = value.slice(2).split('=', 2);
  return [key, rawValue ?? true];
}));
const maxPages = Math.max(1, Math.min(5, Number(args.get('pages') || 3)));
const searchLimit = 30;
const skipDownloads = args.has('no-download');
const workerCount = Math.max(1, Math.min(6, Number(args.get('workers') || 4)));

// Current playable-character baseline retrieved from the public Character/List
// table on 2026-09-09. The source is recorded in the generated catalog so the
// roster can be refreshed independently from the provider results.
const GENSHIN_ROSTER = [
  'Aino', 'Albedo', 'Alhaitham', 'Aloy', 'Alyosha', 'Amber', 'Arataki Itto',
  'Arlecchino', 'Baizhu', 'Barbara', 'Beidou', 'Bennett', 'Candace', 'Charlotte',
  'Chasca', 'Chevreuse', 'Chiori', 'Chongyun', 'Citlali', 'Clorinde', 'Collei',
  'Columbina', 'Cyno', 'Dahlia', 'Dehya', 'Diluc', 'Diona', 'Dori', 'Durin',
  'Emilie', 'Escoffier', 'Eula', 'Faruzan', 'Fischl', 'Flins', 'Freminet', 'Furina',
  'Gaming', 'Ganyu', 'Gorou', 'Hu Tao', 'Iansan', 'Ifa', 'Illuga', 'Ineffa', 'Jahoda',
  'Jean', 'Kachina', 'Kaedehara Kazuha', 'Kaeya', 'Kamisato Ayaka', 'Kamisato Ayato',
  'Kaveh', 'Keqing', 'Kinich', 'Kirara', 'Klee', 'Kujou Sara', 'Kuki Shinobu',
  'Lan Yan', 'Lauma', 'Layla', 'Linnea', 'Lisa', 'Lohen', 'Lynette', 'Lyney', 'Mavuika',
  'Mika', 'Mona', 'Mualani', 'Nahida', 'Navia', 'Nefer', 'Neuvillette', 'Nicole',
  'Nilou', 'Ningguang', 'Noelle', 'Odette', 'Ororon', 'Prune', 'Qiqi', 'Raiden Shogun',
  'Razor', 'Rosaria', 'Sandrone', 'Sangonomiya Kokomi', 'Sayu', 'Sethos', 'Shenhe',
  'Shikanoin Heizou', 'Sigewinne', 'Skirk', 'Sucrose', 'Tartaglia', 'Thoma', 'Tighnari',
  'Traveler', 'Varesa', 'Varka', 'Venti', 'Wanderer', 'Wonderland Manekin', 'Wriothesley',
  'Xiangling', 'Xianyun', 'Xiao', 'Xilonen', 'Xingqiu', 'Xinyan', 'Yae Miko', 'Yanfei',
  'Yaoyao', 'Yelan', 'Yoimiya', 'Yumemizuki Mizuki', 'Yun Jin', 'Zhongli', 'Zibai',
];

const ALIASES = {
  'Arataki Itto': ['Itto'],
  'Kaedehara Kazuha': ['Kazuha'],
  'Kamisato Ayaka': ['Ayaka'],
  'Kamisato Ayato': ['Ayato'],
  'Kuki Shinobu': ['Shinobu'],
  'Raiden Shogun': ['Raiden Ei', 'Raiden', 'Ei'],
  'Sangonomiya Kokomi': ['Kokomi'],
  'Shikanoin Heizou': ['Heizou'],
  'Tartaglia': ['Childe'],
  'Traveler': ['Aether', 'Lumine'],
  'Wanderer': ['Scaramouche'],
  'Yumemizuki Mizuki': ['Mizuki'],
};

const SERIES_MARKERS = /genshin|原神|teyvat|mondstadt|liyue|inazuma|sumeru|fontaine|natlan|snezhnaya|nod[- ]?krai/i;
const SCENE_MARKERS = /rpg|lorebook|massive lore|world setting|multiple (?:people|characters)|scene|roleplay world|adventure/i;

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9一-鿿]+/g, ' ').trim();
}

function text(value, max = 20_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : value == null ? '' : String(value).slice(0, max);
}

function containsName(haystack, name) {
  const words = normalize(haystack).split(/\s+/).filter(Boolean);
  const needle = normalize(name).split(/\s+/).filter(Boolean);
  if (!needle.length || needle.length > words.length) return false;
  for (let index = 0; index <= words.length - needle.length; index += 1) {
    if (needle.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

function exactNameHit(item, names) {
  return names.some((name) => containsName(item.name, name));
}

function summaryNameHit(item, names) {
  return names.some((name) => containsName(`${item.name} ${item.summary}`, name));
}

function isScene(item) {
  return SCENE_MARKERS.test(`${item.name} ${item.summary} ${item.externalId}`);
}

function scoreCandidate(item, names) {
  const exact = exactNameHit(item, names);
  const named = summaryNameHit(item, names);
  const series = SERIES_MARKERS.test(`${item.name} ${item.summary} ${item.externalId}`);
  const scene = isScene(item);
  return (exact ? 50 : named ? 25 : 0) + (series ? 15 : 0) + (scene ? -40 : 0) + (item.summary ? Math.min(10, item.summary.length / 80) : 0);
}

function candidateKind(item, names) {
  if (isScene(item)) return 'scene-or-world';
  if (exactNameHit(item, names) && SERIES_MARKERS.test(`${item.name} ${item.summary} ${item.externalId}`)) return 'single-character';
  if (summaryNameHit(item, names)) return 'needs-review';
  return 'near-miss';
}

async function searchPages(provider, query) {
  const items = new Map();
  let total = null;
  let pagesRead = 0;
  let error = null;
  for (let page = 1; page <= maxPages; page += 1) {
    try {
      const result = await provider.search({ query, cursor: String(page), limit: searchLimit, signal: AbortSignal.timeout(15_000) });
      pagesRead += 1;
      total = result.total ?? total;
      for (const item of result.items) items.set(item.externalId, item);
      if (!result.nextCursor) break;
      // Keep reading the bounded page window. This provider often puts an
      // unrelated character with the same short name ahead of the Genshin card.
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      break;
    }
  }
  return { items: [...items.values()], total, pagesRead, error };
}

function detailMetrics(detail) {
  const card = detail.card || {};
  const personality = text(card.definition_personality);
  const description = text(card.definition_character_description);
  const firstMessage = text(card.definition_first_message);
  const examples = text(card.definition_example_messages, 40_000);
  const scenario = text(card.definition_scenario);
  const worldBook = card.characterBook ?? card.character_book;
  return {
    remoteVersion: detail.remoteVersion,
    tokenTotal: Number.isFinite(Number(card.tokenTotal)) ? Number(card.tokenTotal) : null,
    descriptionChars: description.length,
    personalityChars: personality.length,
    firstMessageChars: firstMessage.length,
    exampleChars: examples.length,
    scenarioChars: scenario.length,
    worldBookEntries: Array.isArray(worldBook) ? worldBook.length : worldBook && Array.isArray(worldBook.entries) ? worldBook.entries.length : 0,
    isNSFW: card.isNSFW === true,
  };
}

async function inspectCard(provider, item, detail) {
  const result = {
    providerId: item.providerId,
    externalId: item.externalId,
    name: item.name,
    author: item.author,
    summary: item.summary,
    tags: item.tags,
    sourceUrl: item.sourceUrl,
    thumbnail: item.thumbnail,
    remoteUpdatedAt: item.remoteUpdatedAt,
    kind: null,
    detail: detailMetrics(detail),
  };
  if (skipDownloads) return result;
  try {
    const download = await provider.download(item.externalId, AbortSignal.timeout(30_000));
    const parsed = parseCharacterCard({ bytes: download.bytes, mimeType: download.contentType });
    const mapped = parsed.card ? mapCharacterCard(parsed) : null;
    result.download = {
      bytes: download.bytes.length,
      sha256: createHash('sha256').update(download.bytes).digest('hex'),
      format: parsed.format,
      mimeType: parsed.mimeType,
      width: parsed.width,
      height: parsed.height,
      mappedIdentityChars: mapped?.candidate.draft.identity.length ?? 0,
      mappedPersonalityChars: mapped?.candidate.draft.personality.join('\n').length ?? 0,
      mappedExampleBlocks: mapped?.candidate.draft.speech.examples.length ?? 0,
      worldBookEntries: mapped?.compatibility.worldBookEntries ?? 0,
      isSceneCard: mapped?.compatibility.isSceneCard ?? false,
      warnings: mapped?.compatibility.warnings ?? [],
    };
  } catch (caught) {
    result.downloadError = caught instanceof Error ? caught.message : String(caught);
  }
  return result;
}

async function inspectRosterEntry(provider, name) {
  const aliases = [name, ...(ALIASES[name] || [])];
  const queries = [`${name} Genshin Impact`];
  if (ALIASES[name]?.length) queries.push(`${ALIASES[name][0]} Genshin Impact`);
  queries.push(name);
  const searchRuns = [];
  const allItems = new Map();
  for (const query of queries) {
    const run = await searchPages(provider, query);
    searchRuns.push({ query, total: run.total, pagesRead: run.pagesRead, hitCount: run.items.length, error: run.error });
    for (const item of run.items) allItems.set(item.externalId, item);
    if ([...allItems.values()].some((item) => summaryNameHit(item, aliases))) break;
  }
  const ranked = [...allItems.values()]
    .filter((item) => summaryNameHit(item, aliases))
    .sort((left, right) => scoreCandidate(right, aliases) - scoreCandidate(left, aliases));
  const selected = ranked.slice(0, 4);
  const inspected = [];
  for (const item of selected) {
    try {
      const detail = await provider.getDetail(item.externalId, AbortSignal.timeout(15_000));
      inspected.push(await inspectCard(provider, item, detail));
    } catch (caught) {
      inspected.push({
        providerId: item.providerId,
        externalId: item.externalId,
        name: item.name,
        author: item.author,
        summary: item.summary,
        tags: item.tags,
        sourceUrl: item.sourceUrl,
        thumbnail: item.thumbnail,
        remoteUpdatedAt: item.remoteUpdatedAt,
        kind: 'detail-unavailable',
        detailError: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
  for (const item of inspected) item.kind = item.kind === 'detail-unavailable' ? item.kind : candidateKind(item, aliases);
  const nonScene = inspected.filter((item) => item.kind === 'single-character');
  const ambiguous = inspected.filter((item) => item.kind === 'needs-review' || item.kind === 'detail-unavailable');
  const scene = inspected.filter((item) => item.kind === 'scene-or-world');
  const status = nonScene.length ? 'found' : scene.length && !ambiguous.length ? 'scene-only' : ambiguous.length ? 'review' : 'not-found';
  const nearMisses = [...allItems.values()]
    .filter((item) => !summaryNameHit(item, aliases))
    .sort((left, right) => scoreCandidate(right, aliases) - scoreCandidate(left, aliases))
    .slice(0, 3)
    .map((item) => ({ name: item.name, externalId: item.externalId, author: item.author, summary: item.summary, sourceUrl: item.sourceUrl }));
  return {
    name,
    aliases,
    status,
    searchRuns,
    candidates: inspected,
    nearMisses,
  };
}

async function mapWorkers(values, worker, count) {
  const results = new Array(values.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
      console.log(`[${index + 1}/${values.length}] ${values[index]} → ${results[index].status}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, values.length) }, () => run()));
  return results;
}

const provider = new CharacterTavernProvider();
console.log(`Collecting ${GENSHIN_ROSTER.length} roster entries from ${provider.name} (max ${maxPages} pages/query, ${workerCount} workers)…`);
const characters = await mapWorkers(GENSHIN_ROSTER, (name) => inspectRosterEntry(provider, name), workerCount);
const counts = Object.fromEntries(['found', 'scene-only', 'review', 'not-found'].map((status) => [status, characters.filter((entry) => entry.status === status).length]));
const catalog = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: {
    game: 'Genshin Impact',
    rosterType: 'playable characters',
    rosterCount: GENSHIN_ROSTER.length,
    rosterRetrievedAt: '2026-09-09',
    rosterSource: 'https://genshin-impact.fandom.com/wiki/Character/List',
    providerId: provider.id,
    providerName: provider.name,
    providerSearchBase: 'https://character-tavern.com/search/cards',
    selectionRule: '逐个角色搜索英文名及常用别名；只记录名称/摘要能与该角色对应的候选；场景、RPG、世界书卡单独标记。',
    rawCardPolicy: '本文件不保存第三方原始卡片字节；只保存来源元数据、详情字段长度、解析格式、哈希和兼容性结果。',
  },
  summary: {
    ...counts,
    searched: characters.length,
    candidateCards: characters.reduce((total, entry) => total + entry.candidates.length, 0),
    parsedCards: characters.reduce((total, entry) => total + entry.candidates.filter((candidate) => candidate.download).length, 0),
  },
  characters,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(JSON.stringify(catalog.summary));
