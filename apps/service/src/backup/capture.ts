import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type { BackupScope } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { SERVICE_DATABASE_MIGRATIONS } from '../database.js';
import { NARRATIVE_DATABASE_MIGRATIONS } from '../narrative-database.js';
import { ActivityStore } from '../activities/store.js';
import { collectExportEntries } from '../activities/exports.js';
import type { StagedObjectSource } from './objects.js';

/**
 * 备份维护窗口。
 *
 * 这是应用内可控的协调点，不是分布式写锁：
 * - 捕获期间标记「维护中」，写入型业务请求得到可重试的提示，而不是静默丢数据。
 * - 只负责协调本进程内已知的长任务与两个数据库快照之间的先后顺序。
 * - 用 try/finally 结束；异常和重启都不会让项目停在维护模式。
 */
export class MaintenanceCoordinator {
  private active = false;
  private startedAt: string | null = null;
  private label: string | null = null;

  begin(label: string): void {
    this.active = true;
    this.startedAt = new Date().toISOString();
    this.label = label;
  }

  end(): void {
    this.active = false;
    this.startedAt = null;
    this.label = null;
  }

  get state(): { active: boolean; startedAt: string | null; label: string | null } {
    return { active: this.active, startedAt: this.startedAt, label: this.label };
  }
}

export const backupMaintenance = new MaintenanceCoordinator();

export interface BackupCaptureSelection {
  scope: BackupScope;
  activityIds: string[];
  works: string[];
}

export interface BackupCaptureResult {
  items: StagedObjectSource[];
  excluded: Array<{ relativePath: string; reason: string; referencedBy: string[] }>;
  description: string;
  stagingDirectory: string;
  serviceSchemaVersion: number;
  narrativeSchemaVersion: number;
  /** 是否等到长任务收敛；未收敛时如实记录，不假装快照是空闲状态下拍的。 */
  idleWait: { drained: boolean; waitingOn: string[] };
}

function sqlString(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}

/** 备份自身、日志与暂存目录都不进入备份范围。 */
function isSelfReferential(targetPath: string, config: ServiceConfig, stagingDirectory: string) {
  const roots = [resolve(dirname(config.databasePath), 'backups'), resolve(config.logDirectory), resolve(stagingDirectory)];
  return roots.some((root) => targetPath === root || targetPath.startsWith(root + '/'));
}

function snapshotDatabase(sourcePath: string, targetPath: string): boolean {
  if (!existsSync(sourcePath)) return false;
  mkdirSync(dirname(targetPath), { recursive: true });
  const connection = new DatabaseSync(sourcePath, { readOnly: false });
  try {
    connection.exec('VACUUM INTO ' + sqlString(targetPath));
    return true;
  } finally {
    connection.close();
  }
}

function openSnapshot(targetPath: string) {
  return new DatabaseSync(targetPath, { readOnly: true });
}

function parseJsonList(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

interface Enumeration {
  items: StagedObjectSource[];
  excluded: BackupCaptureResult['excluded'];
}

/**
 * 完整工作区：两个数据库快照加上数据库可达的媒体与笔记附件。
 * 不省略仍被历史版本引用的媒体，避免「声称可完整恢复」的缩水。
 */
function enumerateWorkspace(snapshotPath: string, config: ServiceConfig, stagingDirectory: string): Enumeration {
  const items: StagedObjectSource[] = [];
  const excluded: BackupCaptureResult['excluded'] = [];
  const connection = openSnapshot(snapshotPath);
  try {
    const referenceMap = new Map<string, string[]>();
    const referenceTable = connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='artifact_references'").get();
    if (referenceTable) {
      for (const row of connection.prepare('SELECT artifact_id, app_id, ref_type FROM artifact_references').all() as Array<{ artifact_id: string; app_id: string; ref_type: string }>) {
        const key = String(row.artifact_id);
        const list = referenceMap.get(key) ?? [];
        list.push(String(row.app_id) + ':' + String(row.ref_type));
        referenceMap.set(key, list);
      }
    }

    const stagingArtifacts = resolve(stagingDirectory, 'artifacts');
    for (const row of connection.prepare('SELECT * FROM artifacts').all() as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const localPath = row.local_path ? String(row.local_path) : null;
      const referencedBy = referenceMap.get(id) ?? [String(row.app_id ?? 'general')];
      if (!localPath || !existsSync(localPath)) {
        excluded.push({ relativePath: 'artifacts/' + id, reason: '源文件缺失', referencedBy });
        continue;
      }
      if (isSelfReferential(localPath, config, stagingDirectory)) {
        excluded.push({ relativePath: 'artifacts/' + id, reason: '位于备份或日志目录内，不重复备份自身', referencedBy });
        continue;
      }
      const extension = extname(localPath);
      const stagedPath = resolve(stagingArtifacts, id + extension);
      mkdirSync(stagingArtifacts, { recursive: true });
      copyFileSync(localPath, stagedPath);
      items.push({
        relativePath: 'artifacts/' + id + extension,
        kind: row.task_id ? 'generated_media' : 'artifact',
        storage: 'artifact',
        resourceId: id,
        referencedBy,
        ...(row.content_type ? { contentType: String(row.content_type) } : {}),
        sourcePath: stagedPath,
      });
    }

    const stagingNotes = resolve(stagingDirectory, 'note-assets');
    const hasNoteAssets = connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='note_assets'").get();
    if (hasNoteAssets) {
      for (const row of connection.prepare('SELECT * FROM note_assets').all() as Array<Record<string, unknown>>) {
        const id = String(row.id);
        const localPath = String(row.local_path ?? '');
        const referencedBy = ['notebook:attachment' + (row.note_id ? ':' + String(row.note_id) : '')];
        if (!localPath || !existsSync(localPath)) {
          excluded.push({ relativePath: 'note-assets/' + id, reason: '笔记附件源文件缺失', referencedBy });
          continue;
        }
        mkdirSync(stagingNotes, { recursive: true });
        const stagedPath = resolve(stagingNotes, id + '-' + basename(localPath));
        copyFileSync(localPath, stagedPath);
        items.push({
          relativePath: 'note-assets/' + id + '-' + basename(localPath),
          kind: 'note_asset',
          storage: 'note_asset',
          resourceId: id,
          referencedBy,
          ...(row.content_type ? { contentType: String(row.content_type) } : {}),
          sourcePath: stagedPath,
        });
      }
    }
  } finally {
    connection.close();
  }
  return { items, excluded };
}

/**
 * 指定活动：复用工程导出规则枚举 entries，元数据合并为一个逻辑对象，
 * 媒体文件各自成为可增量复用的对象，不把整个工程 ZIP 当成唯一对象反复重传。
 */
async function enumerateActivities(input: {
  config: ServiceConfig;
  database: ServiceDatabase;
  snapshotPath: string;
  activityIds: string[];
  stagingDirectory: string;
}): Promise<Enumeration & { titles: string[] }> {
  const items: StagedObjectSource[] = [];
  const excluded: BackupCaptureResult['excluded'] = [];
  const titles: string[] = [];
  const snapshot = openSnapshot(input.snapshotPath);
  try {
    const store = new ActivityStore(input.database);
    for (const activityId of input.activityIds) {
      const row = snapshot.prepare('SELECT id, title FROM activities WHERE id=?').get(activityId) as { id: string; title?: string } | undefined;
      if (!row) {
        excluded.push({ relativePath: 'activities/' + activityId, reason: '活动不存在或未包含在快照中', referencedBy: ['activity:' + activityId] });
        continue;
      }
      const title = String(row.title ?? activityId);
      titles.push(title);
      const entries = await collectExportEntries(input.config, input.database, store, activityId, { format: 'project' });
      const metadata: Array<{ path: string; encoding: 'base64'; data: string }> = [];
      const mediaDirectory = resolve(input.stagingDirectory, 'activities', activityId, 'media');
      for (const entry of entries) {
        if (entry.filePath) {
          if (!existsSync(entry.filePath)) {
            excluded.push({ relativePath: 'activities/' + activityId + '/media/' + entry.path, reason: '工程媒体源文件缺失', referencedBy: ['activity:' + activityId] });
            continue;
          }
          const stagedPath = resolve(mediaDirectory, entry.path);
          mkdirSync(dirname(stagedPath), { recursive: true });
          copyFileSync(entry.filePath, stagedPath);
          items.push({
            relativePath: 'activities/' + activityId + '/media/' + entry.path,
            kind: 'activity_media',
            storage: 'artifact',
            resourceId: activityId,
            referencedBy: ['activity:' + activityId],
            sourcePath: stagedPath,
          });
          continue;
        }
        const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data ?? Buffer.alloc(0));
        metadata.push({ path: entry.path, encoding: 'base64', data: data.toString('base64') });
      }
      const packagePath = resolve(input.stagingDirectory, 'activities', activityId, 'package.json');
      mkdirSync(dirname(packagePath), { recursive: true });
      writeFileSync(packagePath, JSON.stringify({
        schemaVersion: 1,
        type: 'sthstart-activity-package',
        activityId,
        title,
        entries: metadata,
      }), 'utf8');
      items.push({
        relativePath: 'activities/' + activityId + '/package.json',
        kind: 'activity_package',
        storage: 'artifact',
        resourceId: activityId,
        referencedBy: ['activity:' + activityId],
        contentType: 'application/json',
        sourcePath: packagePath,
      });
    }
  } finally {
    snapshot.close();
  }
  return { items, excluded, titles };
}

/**
 * 创作资料：版本化逻辑包，只包含所选资料及其必要依赖，
 * 不把完整业务数据库当作「资料备份」夹带进去。
 */
function enumerateKnowledge(input: { snapshotPath: string; works: string[]; stagingDirectory: string }): Enumeration & { noteCount: number; characterCount: number } {
  const items: StagedObjectSource[] = [];
  const excluded: BackupCaptureResult['excluded'] = [];
  const connection = openSnapshot(input.snapshotPath);
  try {
    const hasTable = (name: string) => Boolean(connection.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(name));
    const notes = hasTable('creative_notes') ? connection.prepare('SELECT * FROM creative_notes').all() as Array<Record<string, unknown>> : [];
    const knowledge = hasTable('note_knowledge') ? connection.prepare('SELECT * FROM note_knowledge').all() as Array<Record<string, unknown>> : [];
    const knowledgeByNote = new Map<string, Record<string, unknown>>();
    for (const row of knowledge) knowledgeByNote.set(String(row.note_id), row);

    const worksFilter = new Set(input.works.filter(Boolean));
    const selectedNotes = notes.filter((note) => {
      if (!worksFilter.size) return true;
      const meta = knowledgeByNote.get(String(note.id));
      if (!meta) return false;
      return parseJsonList(meta.works_json).some((work) => worksFilter.has(work));
    });
    const selectedIds = new Set(selectedNotes.map((note) => String(note.id)));
    const selectedKnowledge = knowledge.filter((row) => selectedIds.has(String(row.note_id)));

    const sourceIds = new Set<string>();
    for (const row of selectedKnowledge) for (const ref of parseJsonList(row.sources_json)) sourceIds.add(ref);
    const sources = hasTable('knowledge_sources')
      ? (connection.prepare('SELECT * FROM knowledge_sources').all() as Array<Record<string, unknown>>).filter((row) => sourceIds.has(String(row.id)))
      : [];
    const collections = hasTable('knowledge_collections')
      ? (connection.prepare('SELECT * FROM knowledge_collections').all() as Array<Record<string, unknown>>).filter((row) => {
          if (!worksFilter.size) return true;
          return parseJsonList(row.works_json).some((work) => worksFilter.has(work));
        })
      : [];
    const assetRows = hasTable('note_assets')
      ? (connection.prepare('SELECT * FROM note_assets').all() as Array<Record<string, unknown>>).filter((row) => selectedIds.has(String(row.note_id)))
      : [];

    const characters = new Set<string>();
    for (const row of selectedKnowledge) for (const character of parseJsonList(row.characters_json)) characters.add(character);

    const packagePath = resolve(input.stagingDirectory, 'knowledge', 'package.json');
    mkdirSync(dirname(packagePath), { recursive: true });
    writeFileSync(packagePath, JSON.stringify({
      schemaVersion: 1,
      type: 'sthstart-knowledge-package',
      works: [...worksFilter],
      notes: selectedNotes,
      noteKnowledge: selectedKnowledge,
      sources,
      collections,
      assets: assetRows.map((row) => ({
        id: String(row.id),
        noteId: row.note_id ? String(row.note_id) : null,
        relativePath: 'knowledge/assets/' + String(row.id) + '-' + basename(String(row.local_path ?? 'attachment')),
        contentType: row.content_type ?? null,
        byteSize: row.byte_size ?? null,
        originalName: row.original_name ?? null,
        createdAt: row.created_at ?? null,
      })),
    }), 'utf8');
    items.push({
      relativePath: 'knowledge/package.json',
      kind: 'knowledge_package',
      storage: 'artifact',
      resourceId: 'knowledge',
      referencedBy: ['knowledge:package'],
      contentType: 'application/json',
      sourcePath: packagePath,
    });

    for (const row of assetRows) {
      const id = String(row.id);
      const localPath = String(row.local_path ?? '');
      if (!localPath || !existsSync(localPath)) {
        excluded.push({ relativePath: 'knowledge/assets/' + id, reason: '资料附件源文件缺失', referencedBy: ['knowledge:' + id] });
        continue;
      }
      const stagedPath = resolve(input.stagingDirectory, 'knowledge', 'assets', id + '-' + basename(localPath));
      mkdirSync(dirname(stagedPath), { recursive: true });
      copyFileSync(localPath, stagedPath);
      items.push({
        relativePath: 'knowledge/assets/' + id + '-' + basename(localPath),
        kind: 'knowledge_asset',
        storage: 'note_asset',
        resourceId: id,
        referencedBy: ['knowledge:' + (row.note_id ? String(row.note_id) : id)],
        sourcePath: stagedPath,
      });
    }
    return { items, excluded, noteCount: selectedNotes.length, characterCount: characters.size };
  } finally {
    connection.close();
  }
}

/**
 * 捕获一次备份快照：协调维护窗口 → 两个数据库快照 → 冻结所选范围的文件。
 * 之后的加密与上传都在窗口之外进行，不长期阻塞正常创作。
 */
export async function captureBackup(input: {
  config: ServiceConfig;
  database: ServiceDatabase;
  selection: BackupCaptureSelection;
  stagingRoot: string;
  snapshotId: string;
  waitForIdle?: () => Promise<{ drained: boolean; waitingOn: string[] }>;
}): Promise<BackupCaptureResult> {
  const stagingDirectory = resolve(input.stagingRoot, input.snapshotId);
  mkdirSync(stagingDirectory, { recursive: true });
  const databasesDirectory = resolve(stagingDirectory, 'databases');
  const serviceSnapshotPath = resolve(databasesDirectory, 'service.sqlite');
  const narrativeSnapshotPath = resolve(databasesDirectory, 'narrative.sqlite');

  backupMaintenance.begin('正在创建备份快照');
  let idleWait: { drained: boolean; waitingOn: string[] } = { drained: true, waitingOn: [] };
  const items: StagedObjectSource[] = [];
  const excluded: BackupCaptureResult['excluded'] = [];
  let description = '';
  try {
    // 让已有长任务到达安全点；等不到就在预算用尽后如实记录并未收敛的项。
    if (input.waitForIdle) idleWait = await input.waitForIdle();
    // 两个数据库各自做事务一致的快照；跨库一致性由维护窗口与空闲等待保证。
    if (!snapshotDatabase(input.config.databasePath, serviceSnapshotPath)) throw new Error('backup_source_database_missing');
    const hasNarrative = snapshotDatabase(input.config.narrativeDatabasePath, narrativeSnapshotPath);
    // 只有完整工作区范围才把数据库整体入包；活动与资料范围用版本化逻辑包表达，
    // 不把完整业务数据库夹带成「资料备份」。数据库快照始终生成，用于枚举引用。
    if (input.selection.scope === 'workspace') {
      items.push({
        relativePath: 'databases/service.sqlite',
        kind: 'database',
        storage: 'database',
        resourceId: 'service',
        referencedBy: ['database:service'],
        contentType: 'application/vnd.sqlite3',
        sourcePath: serviceSnapshotPath,
      });
      if (hasNarrative) {
        items.push({
          relativePath: 'databases/narrative.sqlite',
          kind: 'database',
          storage: 'database',
          resourceId: 'narrative',
          referencedBy: ['database:narrative'],
          contentType: 'application/vnd.sqlite3',
          sourcePath: narrativeSnapshotPath,
        });
      }
    }
    if (input.selection.scope === 'workspace') {
      const enumerated = enumerateWorkspace(serviceSnapshotPath, input.config, stagingDirectory);
      items.push(...enumerated.items);
      excluded.push(...enumerated.excluded);
      description = '完整工作区：数据库、媒体与笔记附件（' + enumerated.items.length + ' 个文件）';
    } else if (input.selection.scope === 'activities') {
      if (!input.selection.activityIds.length) throw new Error('backup_activity_selection_required');
      const enumerated = await enumerateActivities({
        config: input.config,
        database: input.database,
        snapshotPath: serviceSnapshotPath,
        activityIds: input.selection.activityIds,
        stagingDirectory,
      });
      items.push(...enumerated.items);
      excluded.push(...enumerated.excluded);
      description = '指定活动：' + enumerated.titles.join('、');
    } else {
      const enumerated = enumerateKnowledge({ snapshotPath: serviceSnapshotPath, works: input.selection.works, stagingDirectory });
      items.push(...enumerated.items);
      excluded.push(...enumerated.excluded);
      description = '创作资料：' + enumerated.noteCount + ' 篇资料、' + enumerated.characterCount + ' 个角色引用、' + enumerated.items.length + ' 个文件';
    }
  } finally {
    backupMaintenance.end();
  }

  return {
    items,
    excluded,
    description,
    stagingDirectory,
    serviceSchemaVersion: SERVICE_DATABASE_MIGRATIONS[SERVICE_DATABASE_MIGRATIONS.length - 1]?.version ?? 0,
    narrativeSchemaVersion: NARRATIVE_DATABASE_MIGRATIONS[NARRATIVE_DATABASE_MIGRATIONS.length - 1]?.version ?? 0,
    idleWait,
  };
}
