/**
 * Use the captured Akasha MCP character catalog to repair the active Genshin
 * persona drafts without replacing their existing relationship and personality
 * writing.
 *
 * The script is intentionally idempotent at the draft level. It keeps the
 * existing character-specific sections, removes dataset boilerplate that made
 * every card sound identical, adds source-backed facts, and records the MCP
 * snapshot/provenance in the shared character library.
 *
 * Usage:
 *   node scripts/remediate-genshin-character-personas.mjs
 *   node scripts/remediate-genshin-character-personas.mjs --dry-run
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const envPath = resolve(root, '.env');
const catalogPath = resolve(root, 'scripts/akasha-genshin-character-catalog.json');

function readEnv() {
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].trim()]),
  );
}

const env = { ...readEnv(), ...process.env };
const dbPath = resolve(root, env.STHSTART_DATABASE_PATH || './data/sthstart.db');
const catalogPayload = JSON.parse(readFileSync(catalogPath, 'utf8'));
const catalog = Array.isArray(catalogPayload.characters) ? catalogPayload.characters : [];

if (!catalog.length) throw new Error('Akasha catalog is empty.');
if (!existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const byName = new Map(catalog.map((character) => [character.name, character]));
const travelerFacts = {
  空: {
    id: 'traveler-aether', name: '空', nameEn: 'Aether', region: '旅行者', element: '元素随旅途变化',
    visionSource: '旅行者自身的元素力', title: '旅行者', firstVersion: '1.0', releaseDate: '2020-09-28',
  },
  荧: {
    id: 'traveler-lumine', name: '荧', nameEn: 'Lumine', region: '旅行者', element: '元素随旅途变化',
    visionSource: '旅行者自身的元素力', title: '旅行者', firstVersion: '1.0', releaseDate: '2020-09-28',
  },
};

const regionTag = (region) => ({ 其它: '异界', 待定: '待定' }[region] || region);
const regionWorld = (region) => `提瓦特·${region === '其它' ? '异界' : region === '待定' ? '未定地区' : region}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const unique = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];

function sectionContent(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const contentStart = start + heading.length;
  const next = text.indexOf('\n【', contentStart);
  return text.slice(contentStart, next < 0 ? text.length : next).trim();
}

function replaceSection(text, heading, content) {
  const start = text.indexOf(heading);
  if (start < 0) return `${text.trim()}\n${heading}${content}`.trim();
  const next = text.indexOf('\n【', start + heading.length);
  const end = next < 0 ? text.length : next;
  return `${text.slice(0, start)}${heading}${content}${text.slice(end)}`.trim();
}

function removeSection(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return text;
  const next = text.indexOf('\n【', start + heading.length);
  return `${text.slice(0, start)}${next < 0 ? '' : text.slice(next)}`.trim();
}

function factsFor(displayName) {
  if (byName.has(displayName)) return { facts: byName.get(displayName), source: 'akasha-catalog' };
  if (travelerFacts[displayName]) return { facts: travelerFacts[displayName], source: 'project-traveler-alias' };
  if (/^Furina\s*[—-]/i.test(displayName) && byName.has('芙宁娜')) return { facts: byName.get('芙宁娜'), source: 'akasha-catalog-duplicate-alias' };
  return null;
}

function mcpFactLine(facts) {
  return `【MCP角色索引】《原神》·${facts.region}；${facts.element}；元素力来源：${facts.visionSource}；称号：${facts.title || '未登记'}；首发版本：${facts.firstVersion || '未登记'}；解锁日期：${facts.releaseDate || '未登记'}。`;
}

function continuitySections(identity, displayName, facts) {
  let text = String(identity || '').trim();
  text = text.replace(/^【MCP角色索引】[^\n]*\n?/m, '').trim();
  text = text.replace(/以《原神》当前已公开角色设定为基准，?/g, '');
  text = text.replace(/保持《原神》官方设定、时代背景和角色口吻。?/g, '');

  const current = sectionContent(text, '【当前状态】').replace(/^[；;，,\s]+/, '').trim();
  if (text.includes('【当前状态】')) {
    replaceSection(text, '【当前状态】', current || `在${facts.region}及提瓦特各地继续自己的职责与生活；与用户的关系从当前对话自然发展，不默认恋爱、主从或过度亲密。`);
    text = replaceSection(text, '【当前状态】', current || `在${facts.region}及提瓦特各地继续自己的职责与生活；与用户的关系从当前对话自然发展，不默认恋爱、主从或过度亲密。`);
  }

  text = removeSection(text, '【行为边界】');
  text = removeSection(text, '【扮演原则】');
  const continuity = `不会因用户要求就突然否定${displayName}的核心价值观、重要职责或既有关系；未明确的日常细节可以自然补全，但不凭空改写身份、重大经历、血缘或核心关系。`;
  const dialogue = `默认从${displayName}的视角说话，不主动提及角色卡、资料库或外部说明；对资料未明确的剧情按未知处理，不把推测说成已经发生的经历。`;
  text = `${text}\n【角色连续性】${continuity}\n【对话边界】${dialogue}`.trim();
  return `${mcpFactLine(facts)}\n${text}`.trim();
}

function normalizeAppearance(draft, displayName) {
  const original = draft.appearance && typeof draft.appearance === 'object' ? clone(draft.appearance) : {};
  const description = String(original.description || '').trim();
  const generic = !description || /保持《原神》官方默认角色造型|官方默认服装/.test(description);
  const appearance = {
    description: generic
      ? `${displayName}的视觉锚点保持既有角色形象：发型、发色、瞳色、体态、标志性服装与饰品保持连续；没有录入的细节不自行补写，场景服装可以变化但不改变这些识别特征。`
      : description,
    hair: String(original.hair || '').trim(), eyes: String(original.eyes || '').trim(), build: String(original.build || '').trim(),
    outfits: unique(Array.isArray(original.outfits) ? original.outfits : []).filter((item) => !item.includes('官方默认服装')),
    accessories: unique(Array.isArray(original.accessories) ? original.accessories : []),
    ...(Array.isArray(original.stableFeatures) ? { stableFeatures: unique(original.stableFeatures) } : {}),
    ...(Object.prototype.hasOwnProperty.call(original, 'defaultOutfitId') ? { defaultOutfitId: original.defaultOutfitId } : {}),
    ...(Array.isArray(original.referenceIds) ? { referenceIds: unique(original.referenceIds) } : {}),
  };
  if (!appearance.outfits.length) appearance.outfits = ['角色既有默认服装'];
  appearance.stableFeatures = unique([...(appearance.stableFeatures || []), '既有发型与发色', '既有瞳色与体态', '标志性服装与饰品']);
  return { appearance, changed: generic || description !== appearance.description || JSON.stringify(original.outfits || []) !== JSON.stringify(appearance.outfits) };
}

function bullets(values) { return values.map((value) => `- ${value}`).join('\n'); }

function compileLinshePrompt(draft) {
  if (draft.legacyPrompt && !draft.identity && draft.personality.length === 0) return draft.legacyPrompt;
  const heading = `你是${draft.displayName}` + (draft.englishName ? `(${draft.englishName})` : '') + (draft.originType === 'ip' && draft.work ? `，来自《${draft.work}》` : '') + '。';
  const identity = [draft.identity, draft.background, draft.currentSituation].filter(Boolean).join('\n\n') || draft.summary;
  const personality = [
    ...draft.personality,
    draft.speech.tone ? `说话语气：${draft.speech.tone}` : '',
    draft.speech.habits ? `表达习惯：${draft.speech.habits}` : '',
    draft.speech.catchphrases.length ? `常用表达：${draft.speech.catchphrases.join('；')}` : '',
    draft.motivations.length ? `核心动机：${draft.motivations.join('；')}` : '',
    draft.beliefs.length ? `信念：${draft.beliefs.join('；')}` : '',
  ].filter(Boolean);
  const preferences = [
    draft.likes.length ? `- 你喜欢：${draft.likes.join('；')}` : '',
    draft.dislikes.length ? `- 你不喜欢：${draft.dislikes.join('；')}` : '',
    draft.fears.length ? `- 你害怕：${draft.fears.join('；')}` : '',
  ].filter(Boolean).join('\n');
  const visual = [
    draft.appearance.description,
    draft.appearance.hair && `发型与发色：${draft.appearance.hair}`,
    draft.appearance.eyes && `眼睛：${draft.appearance.eyes}`,
    draft.appearance.build && `体态：${draft.appearance.build}`,
    draft.appearance.outfits.length && `服装：${draft.appearance.outfits.join('；')}`,
    draft.appearance.accessories.length && `饰品：${draft.appearance.accessories.join('；')}`,
  ].filter(Boolean).join('\n');
  return [
    heading, `## 你的身份\n${identity || '尚未补充。'}`, `## 你的性格\n${bullets(personality) || '- 尚未补充。'}`,
    preferences && `## 你的好恶\n${preferences}`, `## 你的外观\n${visual || '尚未补充。'}`,
    draft.boundaries.length && `## 你的边界\n${bullets(draft.boundaries)}`,
    draft.secrets.length && `## 你不会轻易说出的事\n${bullets(draft.secrets)}`,
    draft.speech.examples.length && `## 对话示例\n${bullets(draft.speech.examples)}`,
    draft.extraRules && `## 额外规则\n${draft.extraRules}`,
  ].filter(Boolean).join('\n\n');
}

function relationshipRows(db, characterId) {
  return db.prepare('SELECT * FROM character_relationships WHERE from_character_id=? OR to_character_id=? ORDER BY updated_at DESC')
    .all(characterId, characterId)
    .map((row) => ({ id: String(row.id), fromCharacterId: String(row.from_character_id), toCharacterId: String(row.to_character_id), relationType: String(row.relation_type), description: String(row.description), updatedAt: String(row.updated_at) }));
}

const db = new DatabaseSync(dbPath);
const rows = db.prepare('SELECT * FROM character_profiles WHERE archived=0 ORDER BY display_name').all();
const canonicalFurina = rows.find((row) => String(row.display_name) === '芙宁娜');
const canonicalFurinaDraft = canonicalFurina ? JSON.parse(String(canonicalFurina.draft_json)) : null;
const updatedDrafts = new Map();
const report = { dryRun, catalogCount: catalog.length, databaseCount: rows.length, matched: 0, specialAliases: 0, changed: 0, genericIdentityRemoved: 0, genericAppearanceReplaced: 0, published: 0, skipped: [] };
const now = new Date().toISOString();
const sourcePayload = JSON.stringify({ provider: catalogPayload.provider || 'Akasha MCP', tool: catalogPayload.tool || 'mcp__akasha__listCharacters', retrievedAt: catalogPayload.retrievedAt || null, characters: catalog });
const sourceHash = sha256(sourcePayload);

for (const row of rows) {
  const displayName = String(row.display_name);
  const match = factsFor(displayName);
  if (!match) { report.skipped.push(displayName); continue; }
  const facts = match.facts;
  const currentDraft = JSON.parse(String(row.draft_json));
  const duplicateFurina = /^Furina\s*[—-]/i.test(displayName) && canonicalFurinaDraft;
  const draft = duplicateFurina ? { ...clone(canonicalFurinaDraft), appearance: clone(currentDraft.appearance || canonicalFurinaDraft.appearance || {}) } : clone(currentDraft);
  draft.displayName = displayName;
  draft.englishName = facts.nameEn || draft.englishName || '';
  draft.aliases = unique([...(Array.isArray(draft.aliases) ? draft.aliases : []), ...(duplicateFurina ? ['芙宁娜'] : [])]);
  draft.originType = 'ip';
  draft.work = '原神';
  draft.world = regionWorld(facts.region);
  if (duplicateFurina && canonicalFurinaDraft?.summary) draft.summary = canonicalFurinaDraft.summary;
  if (!draft.summary || /^Personality\s*$/i.test(String(draft.summary).trim())) draft.summary = `来自《原神》${facts.region}的角色，${facts.title || '拥有明确职责与个人经历'}。`;

  const originalIdentity = String(draft.identity || '');
  draft.identity = continuitySections(originalIdentity, displayName, facts);
  if (originalIdentity.includes('以《原神》当前已公开角色设定为基准') || originalIdentity.includes('保持《原神》官方设定')) report.genericIdentityRemoved++;

  const appearanceResult = normalizeAppearance(draft, displayName);
  draft.appearance = appearanceResult.appearance;
  if (appearanceResult.changed) report.genericAppearanceReplaced++;
  draft.tags = unique([...(Array.isArray(JSON.parse(String(row.tags_json))) ? JSON.parse(String(row.tags_json)) : []), '原神', regionTag(facts.region), facts.element && `元素:${facts.element}`, facts.visionSource && `元素力:${facts.visionSource}`]);
  updatedDrafts.set(String(row.id), { draft, facts, matchSource: match.source, appearanceChanged: appearanceResult.changed, originalDraft: currentDraft });
  report.matched++;
  if (match.source !== 'akasha-catalog') report.specialAliases++;
}

if (!dryRun) {
  db.exec('BEGIN IMMEDIATE');
  try {
    let snapshotId = db.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id=? AND payload_hash=?').get('akasha-mcp', 'genshin-character-catalog', sourceHash)?.id;
    if (!snapshotId) {
      snapshotId = randomUUID();
      db.prepare(`INSERT INTO character_source_snapshots
        (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        snapshotId, 'akasha-mcp', 'genshin-character-catalog', 'https://akasha.daidr.me/service/mcp', 'Akasha MCP', String(catalogPayload.retrievedAt || ''), null, now,
        sourceHash, 'json', 'akasha-listCharacters-v1', null, sourcePayload, now,
      );
    }

    const updateProfile = db.prepare('UPDATE character_profiles SET display_name=?,draft_json=?,tags_json=?,draft_revision=?,updated_at=? WHERE id=?');
    const upsertSource = db.prepare('SELECT id FROM character_sources WHERE character_id=? AND provider_id=? AND external_id=? ORDER BY fetched_at DESC LIMIT 1');
    const updateSource = db.prepare(`UPDATE character_sources SET title=?,url=?,excerpt=?,source_type=?,fetched_at=?,payload_hash=?,source_snapshot_id=? WHERE id=?`);
    const insertSource = db.prepare(`INSERT INTO character_sources
      (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insertProvenance = db.prepare(`INSERT INTO character_field_provenance
      (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);

    for (const row of rows) {
      const result = updatedDrafts.get(String(row.id));
      if (!result) continue;
      const { draft, facts, appearanceChanged, originalDraft } = result;
      const currentRevision = Number(row.draft_revision || 1);
      updateProfile.run(displayNameForRow(draft, row), JSON.stringify(draft), JSON.stringify(draft.tags), currentRevision + 1, now, String(row.id));
      const factLine = mcpFactLine(facts);
      const excerpt = `${factLine}\n来源工具：mcp__akasha__listCharacters。此次修正仅更新作品归属、角色索引事实与模板化边界；原有个性、关系和对话示例保留。`;
      const source = upsertSource.get(String(row.id), 'akasha-mcp', String(facts.id));
      // The provider remains `akasha-mcp` for provenance/filtering, while the
      // contract-level source category must be one of the supported values.
      if (source) updateSource.run(`Akasha MCP：${draft.displayName}`, 'https://akasha.daidr.me/service/mcp', excerpt, 'web', now, sourceHash, snapshotId, String(source.id));
      else insertSource.run(randomUUID(), String(row.id), `Akasha MCP：${draft.displayName}`, 'https://akasha.daidr.me/service/mcp', excerpt, 'web', now, 'akasha-mcp', String(facts.id), sourceHash, snapshotId);

      const evidence = JSON.stringify({ tool: 'mcp__akasha__listCharacters', facts, note: 'Structured catalog facts used to remove generic dataset wording and complete character metadata.' });
      const fields = [
        ['/englishName', draft.englishName], ['/originType', draft.originType], ['/work', draft.work], ['/world', draft.world],
        ['/identity', draft.identity], ['/tags', draft.tags],
      ];
      if (appearanceChanged) fields.push(['/appearance/description', draft.appearance.description], ['/appearance/outfits', draft.appearance.outfits]);
      for (const [fieldPath, value] of fields) {
        insertProvenance.run(randomUUID(), String(row.id), null, fieldPath, sha256(value), 'source_extract', snapshotId, `/characters/${facts.id}`, evidence, '[]', 1, now);
      }
      report.changed++;
    }

    const published = rows.filter((row) => row.latest_version != null && updatedDrafts.has(String(row.id)));
    for (const row of published) {
      const result = updatedDrafts.get(String(row.id));
      const draft = result.draft;
      const version = Number(row.latest_version) + 1;
      const prompt = compileLinshePrompt(draft);
      const relationships = JSON.stringify(relationshipRows(db, String(row.id)));
      const appearanceSnapshot = JSON.stringify({ ...draft.appearance, avatarAssetId: row.avatar_asset_id ?? null });
      const provenance = JSON.stringify(db.prepare('SELECT field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed FROM character_field_provenance WHERE character_id=? ORDER BY created_at DESC').all(String(row.id)));
      db.prepare(`INSERT INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(String(row.id), version, JSON.stringify(draft), prompt, now, relationships, Number(row.draft_revision || 1) + 1, appearanceSnapshot, provenance);
      db.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, String(row.id));
      const tagsJson = JSON.stringify(draft.tags);
      db.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,source=excluded.source,latest_version=excluded.latest_version,updated_at=excluded.updated_at`)
        .run(String(row.id), draft.displayName, tagsJson, 'character-library', version, String(row.created_at), now);
      db.prepare('INSERT OR REPLACE INTO persona_versions(persona_id,version,display_name,persona_prompt,appearance_prompt,avatar_artifact_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(String(row.id), version, draft.displayName, prompt, draft.appearance.description || null, row.avatar_asset_id ? String(row.avatar_asset_id) : null, JSON.stringify({ characterData: draft }), now);
      report.published++;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function displayNameForRow(draft, row) { return draft.displayName || String(row.display_name); }

const remainingBoilerplate = rows
  .map((row) => updatedDrafts.get(String(row.id))?.draft)
  .filter(Boolean)
  .filter((draft) => JSON.stringify(draft).includes('以《原神》当前已公开角色设定为基准') || JSON.stringify(draft).includes('保持《原神》官方默认角色造型'))
  .map((draft) => draft.displayName);
report.remainingBoilerplate = remainingBoilerplate;
console.log(JSON.stringify(report, null, 2));
db.close();
