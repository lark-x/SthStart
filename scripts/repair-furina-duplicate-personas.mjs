/** Repair the two duplicate Furina records without deleting user data. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const db = new DatabaseSync(resolve(root, process.env.STHSTART_DATABASE_PATH || './data/sthstart.db'));
const now = new Date().toISOString();
const rows = db.prepare("SELECT * FROM character_profiles WHERE display_name IN ('芙宁娜','Furina — The hydro archon') ORDER BY display_name,id").all();
const canonical = rows
  .filter((row) => String(row.display_name) === '芙宁娜')
  .map((row) => ({ row, draft: JSON.parse(String(row.draft_json)) }))
  .sort((left, right) => JSON.stringify(right.draft).length - JSON.stringify(left.draft).length)[0];
if (!canonical) throw new Error('完整的芙宁娜基准卡不存在。');

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const bullets = (values) => values.map((value) => `- ${value}`).join('\n');
function compile(draft) {
  const identity = [draft.identity, draft.background, draft.currentSituation].filter(Boolean).join('\n\n') || draft.summary;
  const personality = [...draft.personality, draft.speech.tone ? `说话语气：${draft.speech.tone}` : '', draft.speech.habits ? `表达习惯：${draft.speech.habits}` : '', draft.motivations.length ? `核心动机：${draft.motivations.join('；')}` : '', draft.beliefs.length ? `信念：${draft.beliefs.join('；')}` : ''].filter(Boolean);
  const visual = [draft.appearance.description, draft.appearance.hair && `发型与发色：${draft.appearance.hair}`, draft.appearance.eyes && `眼睛：${draft.appearance.eyes}`, draft.appearance.build && `体态：${draft.appearance.build}`, draft.appearance.outfits.length && `服装：${draft.appearance.outfits.join('；')}`, draft.appearance.accessories.length && `饰品：${draft.appearance.accessories.join('；')}`].filter(Boolean).join('\n');
  return [`你是${draft.displayName}(${draft.englishName})，来自《${draft.work}》。`, `## 你的身份\n${identity}`, `## 你的性格\n${bullets(personality)}`, `## 你的好恶\n- 你喜欢：${draft.likes.join('；')}\n- 你不喜欢：${draft.dislikes.join('；')}\n- 你害怕：${draft.fears.join('；')}`, `## 你的外观\n${visual}`, `## 你的边界\n${bullets(draft.boundaries)}`, `## 对话示例\n${bullets(draft.speech.examples)}`].join('\n\n');
}

const nextDrafts = new Map();
for (const item of rows) {
  if (String(item.id) === String(canonical.row.id)) continue;
  const draft = clone(canonical.draft);
  draft.displayName = String(item.display_name);
  draft.englishName = 'Furina';
  draft.aliases = [...new Set([...(draft.aliases || []), '芙宁娜'])];
  nextDrafts.set(String(item.id), draft);
}

db.exec('BEGIN IMMEDIATE');
try {
  for (const [id, draft] of nextDrafts) {
    const row = db.prepare('SELECT * FROM character_profiles WHERE id=?').get(id);
    const nextRevision = Number(row.draft_revision || 1) + 1;
    db.prepare('UPDATE character_profiles SET display_name=?,draft_json=?,tags_json=?,draft_revision=?,updated_at=? WHERE id=?')
      .run(draft.displayName, JSON.stringify(draft), JSON.stringify(draft.tags), nextRevision, now, id);
    const source = db.prepare("SELECT source_snapshot_id FROM character_sources WHERE character_id=? AND provider_id='akasha-mcp' ORDER BY fetched_at DESC LIMIT 1").get(id);
    if (source?.source_snapshot_id) {
      const evidence = JSON.stringify({ tool: 'mcp__akasha__listCharacters', note: 'Duplicate Furina card normalized from the complete Chinese Furina card.' });
      for (const [fieldPath, value] of [['/identity', draft.identity], ['/personality', draft.personality], ['/speech', draft.speech]]) {
        db.prepare(`INSERT INTO character_field_provenance
          (id,character_id,version,field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,derived_from_json,confirmed,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), id, null, fieldPath, sha256(value), 'source_extract', source.source_snapshot_id, '/characters/10000089', evidence, '[]', 1, now);
      }
    }
    if (row.latest_version != null) {
      const version = Number(row.latest_version) + 1;
      const prompt = compile(draft);
      const relationships = JSON.stringify(db.prepare('SELECT * FROM character_relationships WHERE from_character_id=? OR to_character_id=? ORDER BY updated_at DESC').all(id, id));
      const appearanceSnapshot = JSON.stringify({ ...draft.appearance, avatarAssetId: row.avatar_asset_id ?? null });
      const provenance = JSON.stringify(db.prepare('SELECT field_path,value_hash,source_kind,source_snapshot_id,source_pointer,evidence_json,confirmed FROM character_field_provenance WHERE character_id=? ORDER BY created_at DESC').all(id));
      db.prepare(`INSERT INTO character_versions
        (character_id,version,data_json,compiled_linshe_prompt,created_at,relationships_json,draft_revision,appearance_snapshot_json,provenance_json)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, version, JSON.stringify(draft), prompt, now, relationships, nextRevision, appearanceSnapshot, provenance);
      db.prepare('UPDATE character_profiles SET latest_version=?,updated_at=? WHERE id=?').run(version, now, id);
      db.prepare(`INSERT INTO personas(id,display_name,tags_json,source,latest_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,tags_json=excluded.tags_json,latest_version=excluded.latest_version,updated_at=excluded.updated_at`)
        .run(id, draft.displayName, JSON.stringify(draft.tags), 'character-library', version, String(row.created_at), now);
      db.prepare('INSERT OR REPLACE INTO persona_versions(persona_id,version,display_name,persona_prompt,appearance_prompt,avatar_artifact_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, version, draft.displayName, prompt, draft.appearance.description || null, row.avatar_asset_id ? String(row.avatar_asset_id) : null, JSON.stringify({ characterData: draft }), now);
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

console.log(JSON.stringify({ repaired: [...nextDrafts.keys()], canonicalId: canonical.row.id }, null, 2));
db.close();
