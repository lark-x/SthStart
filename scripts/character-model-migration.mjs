#!/usr/bin/env node
/**
 * 人设 V2 结构迁移（规划 P2 / 第 6 节）。
 *
 * 语义：
 * - 先用原始载荷归档（character_source_snapshots + character_sources 的 migration_archive 来源），
 *   再改写草稿；归档失败则不改写，保证原文可恢复。
 * - 迁移是纯函数映射，不调用 AI，不替用户消解语义冲突；冲突只记录在报告里。
 * - 可重复执行：已是 V2 的草稿跳过；快照按 (provider, externalId, payloadHash) 唯一去重。
 *
 * 用法：
 *   node scripts/character-model-migration.mjs preview [--db <path>] [--json]
 *   node scripts/character-model-migration.mjs apply   [--db <path>] [--json]
 *
 * 注意：apply 会写入数据库。请先对副本执行，确认报告无误后再对日常库执行。
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isCharacterDraftV2, migrateCharacterDraftToV2 } from '@sthstart/contracts';

const MIGRATION_PROVIDER = 'sthstart-draft-migration';
const MIGRATION_PARSER_VERSION = 'character-draft-v1-to-v2';

const args = process.argv.slice(2);
const command = args[0] ?? 'preview';
function option(name, fallback = null) { const index = args.indexOf(name); return index === -1 ? fallback : (args[index + 1] ?? fallback); }
const asJson = args.includes('--json');
const nowIso = () => new Date().toISOString();
function hash(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }

const projectRoot = resolve(import.meta.dirname, '..');
function databasePath() {
  const explicit = option('--db');
  if (explicit) return resolve(explicit);
  const fromEnv = process.env.STHSTART_DATABASE_PATH;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  const envFile = resolve(projectRoot, '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*STHSTART_DATABASE_PATH\s*=\s*(.+?)\s*$/.exec(line);
      if (match) return resolve(projectRoot, match[1].replace(/^"|"$/g, ''));
    }
  }
  return resolve(projectRoot, 'data/sthstart.db');
}

const path = databasePath();
if (!existsSync(path)) { console.error('找不到数据库：' + path); process.exit(1); }
if (command !== 'preview' && command !== 'apply') { console.error('用法：character-model-migration.mjs preview|apply [--db <path>] [--json]'); process.exit(1); }

const database = new DatabaseSync(path, command === 'apply' ? {} : { readOnly: true, fileMustExist: true });
database.exec('PRAGMA foreign_keys = ON');

const rows = database.prepare('SELECT id,display_name,draft_json,draft_revision FROM character_profiles ORDER BY display_name').all();
const report = { databasePath: path, command, generatedAt: nowIso(), total: rows.length, migratedNow: 0, alreadyV2: 0, pending: [], conflicts: [], archivedSnapshots: 0, outfitRows: 0, outfitCharacters: 0, outfitDefaultsApplied: 0 };

// 本项目不使用命名服装库，但迁移 20 会删除 character_outfits。若旧库里有行，
// 必须在删表前归档，否则就是静默的数据丢失（与服务端迁移 guard 对应）。
function tableExists(name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
}
const outfitGroups = new Map();
if (tableExists('character_outfits')) {
  const outfitRows = database.prepare('SELECT * FROM character_outfits ORDER BY character_id, created_at, id').all();
  for (const row of outfitRows) {
    const characterId = String(row.character_id);
    if (!outfitGroups.has(characterId)) outfitGroups.set(characterId, []);
    outfitGroups.get(characterId).push(row);
  }
  report.outfitRows = outfitRows.length;
  report.outfitCharacters = outfitGroups.size;
}

/** 可确定的默认穿着：优先启用中的那条，否则按创建顺序取第一条。 */
function pickDefaultOutfit(outfits) {
  if (!outfits?.length) return '';
  const chosen = outfits.find((row) => Number(row.enabled) === 1) ?? outfits[0];
  const description = String(chosen.description ?? '').trim();
  return description || String(chosen.label ?? '').trim();
}

function archive(draft, characterId) {
  const raw = JSON.stringify(draft);
  const payloadHash = hash(raw);
  const existing = database.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id IS ? AND payload_hash=?')
    .get(MIGRATION_PROVIDER, characterId, payloadHash);
  let snapshotId = existing ? String(existing.id) : null;
  if (!snapshotId) {
    snapshotId = randomUUID();
    const now = nowIso();
    database.prepare(`INSERT INTO character_source_snapshots
      (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
      VALUES (?,?,?,NULL,NULL,NULL,NULL,?,?,?,?,NULL,?,?)`)
      .run(snapshotId, MIGRATION_PROVIDER, characterId, now, payloadHash, 'sthstart-draft-json-v1', MIGRATION_PARSER_VERSION, raw, now);
    report.archivedSnapshots += 1;
  }
  const linked = database.prepare('SELECT 1 FROM character_sources WHERE source_snapshot_id=?').get(snapshotId);
  if (!linked) {
    database.prepare(`INSERT INTO character_sources
      (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
      VALUES (?,?,?,NULL,?,'migration_archive',?,?,?,?,?)`)
      .run(randomUUID(), characterId, '迁移前原文（V1 草稿）', '人设结构升级到 V2 前的完整草稿 JSON，可在来源中查看原文。', nowIso(), MIGRATION_PROVIDER, characterId, payloadHash, snapshotId);
  }
  return snapshotId;
}

/**
 * 归档一个角色的旧服装行原文，并挂一条可定位的 migration_archive 来源。
 * 与草稿归档同构：先用原始载荷落库，删表后仍能恢复。
 */
function archiveOutfits(outfits, characterId) {
  const raw = JSON.stringify(outfits);
  const payloadHash = hash(raw);
  const existing = database.prepare('SELECT id FROM character_source_snapshots WHERE provider_id=? AND external_id IS ? AND payload_hash=?')
    .get(MIGRATION_PROVIDER, characterId, payloadHash);
  let snapshotId = existing ? String(existing.id) : null;
  if (!snapshotId) {
    snapshotId = randomUUID();
    const now = nowIso();
    database.prepare(`INSERT INTO character_source_snapshots
      (id,provider_id,external_id,source_url,author,remote_version,remote_updated_at,fetched_at,payload_hash,format,parser_version,raw_file_path,raw_payload_json,created_at)
      VALUES (?,?,?,NULL,NULL,NULL,NULL,?,?,?,?,NULL,?,?)`)
      .run(snapshotId, MIGRATION_PROVIDER, characterId, now, payloadHash, 'sthstart-outfits-json-v1', MIGRATION_PARSER_VERSION, raw, now);
    report.archivedSnapshots += 1;
  }
  const linked = database.prepare('SELECT 1 FROM character_sources WHERE source_snapshot_id=?').get(snapshotId);
  if (!linked) {
    database.prepare(`INSERT INTO character_sources
      (id,character_id,title,url,excerpt,source_type,fetched_at,provider_id,external_id,payload_hash,source_snapshot_id)
      VALUES (?,?,?,NULL,?,'migration_archive',?,?,?,?,?)`)
      .run(randomUUID(), characterId, '迁移前服装原文', '结构升级前 character_outfits 的完整行数据，可在来源中查看原文。', nowIso(), MIGRATION_PROVIDER, characterId, payloadHash, snapshotId);
  }
  return snapshotId;
}

for (const row of rows) {
  const characterId = String(row.id);
  const displayName = String(row.display_name ?? '');
  let draft = null;
  try { draft = JSON.parse(String(row.draft_json)); } catch { report.pending.push({ id: characterId, displayName, status: 'unparsable' }); continue; }
  const outfits = outfitGroups.get(characterId) ?? [];
  // 旧服装先归档再删表；这一步与草稿是否已升级无关。
  if (outfits.length && command === 'apply') archiveOutfits(outfits, characterId);

  if (isCharacterDraftV2(draft)) {
    report.alreadyV2 += 1;
    // 已升级的草稿不会走迁移映射，但旧服装里的默认穿着仍有信息价值（仅填空缺，不覆盖用户已有选择）。
    if (outfits.length && !String(draft.appearance?.defaultOutfitText ?? '').trim() && command === 'apply') {
      const preferred = pickDefaultOutfit(outfits);
      if (preferred) {
        const next = { ...draft, appearance: { ...(draft.appearance ?? {}), defaultOutfitText: preferred } };
        database.prepare('UPDATE character_profiles SET draft_json=?,draft_revision=?,updated_at=? WHERE id=? AND draft_revision=?')
          .run(JSON.stringify(next), Number(row.draft_revision ?? 1) + 1, nowIso(), characterId, Number(row.draft_revision ?? 1));
        report.outfitDefaultsApplied += 1;
      }
    }
    continue;
  }
  const result = migrateCharacterDraftToV2(draft);
  // 旧服装表里可确定的默认穿着补进默认穿着字段（V1 草稿本身没有服装记录时）。
  if (outfits.length && !result.draft.appearance.defaultOutfitText.trim()) {
    const preferred = pickDefaultOutfit(outfits);
    if (preferred) { result.draft.appearance.defaultOutfitText = preferred; report.outfitDefaultsApplied += 1; }
  }
  const entry = { id: characterId, displayName, status: 'pending', personaChars: result.draft.personaText.length };
  report.pending.push(entry);
  for (const conflict of result.conflicts) report.conflicts.push({ id: characterId, displayName, kind: conflict.kind, detail: conflict.detail });
  if (command !== 'apply') continue;
  const snapshotId = archive(draft, characterId);
  const nextRevision = Number(row.draft_revision ?? 1) + 1;
  database.prepare('UPDATE character_profiles SET draft_json=?,draft_revision=?,updated_at=? WHERE id=? AND draft_revision=?')
    .run(JSON.stringify(result.draft), nextRevision, nowIso(), characterId, Number(row.draft_revision ?? 1));
  entry.status = 'migrated';
  entry.snapshotId = snapshotId;
  report.migratedNow += 1;
}

if (command === 'apply' && report.outfitRows) {
  // 归档完成后再清空旧表，服务端迁移 20 才能安全删除它（否则 guard 会一直中止）。
  database.prepare('DELETE FROM character_outfits').run();
}

database.close();

if (asJson) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); } else {
  console.log('数据库：' + report.databasePath);
  console.log((command === 'apply' ? '已迁移' : '待迁移') + ' ' + report.pending.filter((item) => item.status === 'pending').length + ' / 已是 V2 ' + report.alreadyV2 + ' / 共 ' + report.total);
  if (report.outfitRows) {
    console.log('旧服装表 ' + report.outfitRows + ' 行 / ' + report.outfitCharacters + ' 个角色'
      + (command === 'apply' ? '，已归档并补默认穿着 ' + report.outfitDefaultsApplied + ' 处' : '，尚未归档（preview 不写库）'));
  }
  if (command === 'apply') console.log('本次新增归档快照：' + report.archivedSnapshots + '，迁移角色：' + report.migratedNow);
  const buckets = new Map();
  for (const conflict of report.conflicts) buckets.set(conflict.kind, (buckets.get(conflict.kind) ?? 0) + 1);
  if (buckets.size) { console.log('需人工复核：'); for (const [kind, count] of buckets) console.log('  ' + kind + ' × ' + count); }
  else console.log('无需要人工复核的语义冲突。');
  if (command !== 'apply' && report.pending.length) console.log('如确认无误，对数据库副本执行 apply，再对日常库执行。');
}
