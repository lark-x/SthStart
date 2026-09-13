#!/usr/bin/env node
/**
 * 人设 V2 精简的只读基线审计（规划 P0 / 第 7 节 / 第 9 节）。
 *
 * 设计约束：
 * - 只用原始只读连接打开数据库，绝不实例化 ServiceDatabase，避免启动时自动迁移旧库。
 * - 默认拒绝写入；仅输出统计与冲突清单，供迁移前的决策和备份核对。
 * - 报告可能包含角色正文，默认不打印原文，只打印统计与记录 ID；--show-text 才输出截断原文。
 *
 * 用法：
 *   node scripts/character-model-audit.mjs [--db <path>] [--json] [--show-text]
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function option(name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}
const showText = flag('--show-text');
const asJson = flag('--json');

const projectRoot = resolve(import.meta.dirname, '..');
function resolveDatabasePath() {
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

const databasePath = resolveDatabasePath();
if (!existsSync(databasePath)) {
  console.error(`找不到数据库：${databasePath}`);
  console.error('如需指定：node scripts/character-model-audit.mjs --db <path>');
  process.exit(1);
}

// fileMustExist + readOnly：绝不创建新库，也绝不触发迁移。
const database = new DatabaseSync(databasePath, { readOnly: true, fileMustExist: true });

function scalar(sql, ...params) {
  const row = database.prepare(sql).get(...params);
  return row ? Object.values(row)[0] : null;
}
function rows(sql, ...params) { return database.prepare(sql).all(...params); }
function hasTable(name) { return Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name)); }
function columns(table) {
  if (!hasTable(table)) return [];
  return rows(`PRAGMA table_info(${table})`).map((row) => String(row.name));
}
function preview(value, max = 80) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return showText ? (text.length > max ? `${text.slice(0, max)}…` : text) : '<省略>';
}
function safeJsonParse(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
}

const report = { databasePath, generatedAt: new Date().toISOString(), readOnly: true };

// ── 迁移版本 ────────────────────────────────────────────────────────────────
report.schema = {
  migrationTable: hasTable('schema_migrations'),
  latestMigration: hasTable('schema_migrations') ? Number(scalar('SELECT COALESCE(MAX(version),0) FROM schema_migrations')) : 0,
};

// ── 角色草稿版本分布 ────────────────────────────────────────────────────────
const draftRows = hasTable('character_profiles')
  ? rows(`SELECT id, display_name, draft_json, latest_version, avatar_asset_id${columns('character_profiles').includes('default_outfit_id') ? ', default_outfit_id' : ''} FROM character_profiles`)
  : [];
const draftStats = {
  total: draftRows.length,
  withSchemaVersion2: 0,
  withLegacyPrompt: 0,
  withStructuredAppearance: 0,
  appearanceAsString: 0,
  appearanceDescriptionWithOutfitWords: [],
  withMultipleOutfits: [],
  summaryOnly: 0,
  emptyPersona: 0,
  defaultOutfitConflicts: [],
};
const OUTFIT_HINT = /(?:礼[服裙]|大衣|外套|制服|裙|衬衫|西装|披风|斗篷|和服|泳装|睡衣|女仆|校服|装备|铠甲|盔甲|服[装饰]|套装|outfit|dress|uniform|costume)/i;
for (const row of draftRows) {
  const draft = safeJsonParse(row.draft_json) ?? {};
  const id = String(row.id);
  if (Number(draft.schemaVersion) === 2) draftStats.withSchemaVersion2 += 1;
  if (typeof draft.legacyPrompt === 'string' && draft.legacyPrompt.trim()) draftStats.withLegacyPrompt += 1;
  const isV2 = Number(draft.schemaVersion) === 2;
  const appearance = draft.appearance;
  if (isV2) {
    const baseText = appearance && typeof appearance === 'object' && typeof appearance.baseText === 'string' ? appearance.baseText : '';
    if (baseText.trim()) draftStats.withStructuredAppearance += 1;
    // 迁移自己写下的部位标签（含「服装」二字）不能算作正文夹带服装，剔除后再判断。
    const authored = baseText
      .split(/\r?\n/)
      .filter((line) => !/^(发型与发色|眼睛|体态|配饰|稳定辨识特征)[（(]?[^：:]*[）)]?[：:]/.test(line.trim()))
      .join('\n');
    if (OUTFIT_HINT.test(authored)) draftStats.appearanceDescriptionWithOutfitWords.push({ id, preview: preview(authored) });
    const hasPersona = typeof draft.personaText === 'string' && draft.personaText.trim();
    const hasSummaryV2 = typeof draft.summary === 'string' && draft.summary.trim();
    if (hasSummaryV2 && !hasPersona) draftStats.summaryOnly += 1;
    if (!hasPersona && !hasSummaryV2) draftStats.emptyPersona += 1;
    continue;
  }
  if (typeof appearance === 'string') {
    draftStats.appearanceAsString += 1;
  } else if (appearance && typeof appearance === 'object') {
    draftStats.withStructuredAppearance += 1;
    const description = typeof appearance.description === 'string' ? appearance.description : '';
    if (OUTFIT_HINT.test(description)) draftStats.appearanceDescriptionWithOutfitWords.push({ id, preview: preview(description) });
  }
  const outfits = appearance && typeof appearance === 'object' && Array.isArray(appearance.outfits) ? appearance.outfits : [];
  if (outfits.length > 1) draftStats.withMultipleOutfits.push({ id, count: outfits.length });

  const hasIdentity = typeof draft.identity === 'string' && draft.identity.trim();
  const hasBackground = typeof draft.background === 'string' && draft.background.trim();
  const hasSummary = typeof draft.summary === 'string' && draft.summary.trim();
  const personality = Array.isArray(draft.personality) ? draft.personality.filter((item) => typeof item === 'string' && item.trim()) : [];
  if (hasSummary && !hasIdentity && !hasBackground && personality.length === 0) draftStats.summaryOnly += 1;
  if (!hasSummary && !hasIdentity && !hasBackground && personality.length === 0) draftStats.emptyPersona += 1;

  // default_outfit_id 已在迁移 21 移除；只在旧库上做这项一致性检查。
  if (Object.prototype.hasOwnProperty.call(row, 'default_outfit_id')) {
    const draftDefault = appearance && typeof appearance === 'object' ? appearance.defaultOutfitId : null;
    const profileDefault = row.default_outfit_id == null ? null : String(row.default_outfit_id);
    if ((draftDefault ?? null) !== (profileDefault ?? null)) {
      draftStats.defaultOutfitConflicts.push({ id, draftDefaultOutfitId: draftDefault ?? null, profileDefaultOutfitId: profileDefault });
    }
  }
}
report.drafts = draftStats;

// ── 本项目服装表（规划第 7.5 节）─────────────────────────────────────────────
const outfitColumns = columns('character_outfits');
const outfitRows = hasTable('character_outfits') ? Number(scalar('SELECT COUNT(*) FROM character_outfits')) : null;
report.localOutfitsTable = {
  exists: hasTable('character_outfits'),
  rowCount: outfitRows,
  columns: outfitColumns,
  sample: hasTable('character_outfits') && outfitRows
    ? rows('SELECT id, character_id, label, description, enabled FROM character_outfits LIMIT 20')
      .map((row) => ({ id: String(row.id), characterId: String(row.character_id), label: preview(row.label), enabled: Number(row.enabled) }))
    : [],
};

// ── 参考图表重复列差异（规划第 7.3 节）────────────────────────────────────────
const assetColumns = columns('character_assets');
const referenceColumns = columns('character_visual_references');
function duplicateDiff(column) {
  if (!assetColumns.includes(column) || !referenceColumns.includes(column)) return { column, comparable: false };
  const total = Number(scalar('SELECT COUNT(*) FROM character_visual_references')) || 0;
  const bothNull = Number(scalar(`SELECT COUNT(*) FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id WHERE r.${column} IS NULL AND a.${column} IS NULL`)) || 0;
  const equal = Number(scalar(`SELECT COUNT(*) FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id WHERE r.${column} IS a.${column}`)) || 0;
  const mismatched = rows(`SELECT r.id, r.character_id, r.asset_id, r.${column} AS reference_value, a.${column} AS asset_value
    FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id
    WHERE r.${column} IS NOT a.${column} LIMIT 50`);
  return { column, comparable: true, references: total, bothNull, equal, mismatchedCount: total - equal, mismatched: mismatched.map((row) => ({ referenceId: String(row.id), referenceValue: preview(row.reference_value), assetValue: preview(row.asset_value) })) };
}
report.referenceAssetDuplicates = {
  assetColumns,
  referenceColumns,
  diffs: ['artifact_id', 'sha256', 'source_page', 'original_url', 'author_note', 'user_note', 'outfit_id', 'purposes_json', 'enabled', 'crop_json'].map(duplicateDiff),
};

// ── 媒体完整性（规划第 7.4 节）──────────────────────────────────────────────
// 迁移 21 之后资产表不再镜像文件路径；只有在旧库上才用 local_path 判断文件是否存在。
const assetHasLocalPath = assetColumns.includes('local_path');
const assetsWithoutArtifact = hasTable('character_assets') && assetColumns.includes('artifact_id')
  ? rows(`SELECT id, character_id, kind${assetHasLocalPath ? ', local_path' : ''} FROM character_assets WHERE artifact_id IS NULL OR artifact_id='' LIMIT 100`)
  : [];
report.assets = {
  total: hasTable('character_assets') ? Number(scalar('SELECT COUNT(*) FROM character_assets')) : null,
  withoutArtifact: assetsWithoutArtifact.map((row) => ({ id: String(row.id), characterId: String(row.character_id), kind: String(row.kind), fileExists: assetHasLocalPath && row.local_path ? existsSync(String(row.local_path)) : false })),
  orphanReferences: hasTable('character_visual_references')
    ? Number(scalar('SELECT COUNT(*) FROM character_visual_references r WHERE NOT EXISTS(SELECT 1 FROM character_assets a WHERE a.id=r.asset_id)'))
    : null,
  artworkOwnerMismatch: hasTable('character_visual_references')
    ? Number(scalar('SELECT COUNT(*) FROM character_visual_references r JOIN character_assets a ON a.id=r.asset_id WHERE r.character_id <> a.character_id'))
    : null,
};

// ── 参考图用途分布（用途是图片用途，不是命名服装）────────────────────────────
if (hasTable('character_visual_references')) {
  const purposes = new Map();
  for (const row of rows('SELECT purposes_json FROM character_visual_references')) {
    const list = safeJsonParse(row.purposes_json);
    for (const item of Array.isArray(list) ? list : []) purposes.set(String(item), (purposes.get(String(item)) ?? 0) + 1);
  }
  report.referencePurposes = Object.fromEntries([...purposes.entries()].sort((a, b) => b[1] - a[1]));
}

// ── 旧 persona 兼容存储（规划第 7.6 节）────────────────────────────────────
report.legacyPersonas = {
  personas: hasTable('personas') ? Number(scalar('SELECT COUNT(*) FROM personas')) : null,
  personaVersions: hasTable('persona_versions') ? Number(scalar('SELECT COUNT(*) FROM persona_versions')) : null,
  appPersonas: hasTable('app_personas') ? Number(scalar('SELECT COUNT(*) FROM app_personas')) : null,
};

database.close();

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const line = (label, value) => console.log(`${label.padEnd(38, ' ')} ${value}`);
  console.log(`数据库：${report.databasePath}`);
  console.log(`最高迁移版本：${report.schema.latestMigration}`);
  line('角色总数', report.drafts.total);
  line('  schemaVersion=2', report.drafts.withSchemaVersion2);
  line('  仅旧 legacyPrompt', report.drafts.withLegacyPrompt);
  line('  结构化外观 / 字符串外观', `${report.drafts.withStructuredAppearance} / ${report.drafts.appearanceAsString}`);
  line('  外观描述疑似夹带服装', report.drafts.appearanceDescriptionWithOutfitWords.length);
  line('  多套旧服装', report.drafts.withMultipleOutfits.length);
  line('  仅摘要 / 无人设正文', `${report.drafts.summaryOnly} / ${report.drafts.emptyPersona}`);
  line('  默认造型两侧不一致', report.drafts.defaultOutfitConflicts.length);
  console.log('');
  line('character_outfits 存在/行数', `${report.localOutfitsTable.exists} / ${report.localOutfitsTable.rowCount}`);
  line('character_assets 无 artifact', report.assets.withoutArtifact.length);
  line('参考图悬空 / 归属不一致', `${report.assets.orphanReferences} / ${report.assets.artworkOwnerMismatch}`);
  console.log('');
  console.log('重复列差异：');
  for (const diff of report.referenceAssetDuplicates.diffs) {
    if (!diff.comparable) { console.log(`  ${diff.column.padEnd(16)} 不可比较（缺列）`); continue; }
    console.log(`  ${diff.column.padEnd(16)} 总 ${diff.references}  相等 ${diff.equal}  不一致 ${diff.mismatchedCount}`);
  }
  console.log('');
  console.log(`旧 persona：personas=${report.legacyPersonas.personas}  versions=${report.legacyPersonas.personaVersions}  app_personas=${report.legacyPersonas.appPersonas}`);
  console.log('（默认不打印角色正文；需要时加 --show-text。完整结构化结果加 --json。）');
}
