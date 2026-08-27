import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveLinsheEnvironment } from './linshe-env.mjs';

const root = resolve(import.meta.dirname, '..');
const environment = resolveLinsheEnvironment(root);
const line = (ok, label) => console.log(`${ok ? '✓' : '✗'} ${label}`);
const warnLine = (label) => console.log(`! ${label}`);
const envPath = resolve(root, '.env');
const fileEnvironment = existsSync(envPath) ? Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).map((row) => row.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match[1], match[2].trim()])) : {};
const configured = (name) => String(process.env[name] ?? fileEnvironment[name] ?? '').length >= 32;
const envValue = (name, fallback) => String(process.env[name] ?? fileEnvironment[name] ?? fallback);

// Keep these values in sync with the migration arrays in the service and
// narrative database modules. Doctor is an executable .mjs script and cannot
// import the TypeScript modules without bootstrapping the application.
const expectedMigrations = { service: 11, narrative: 1 };

function checkTool(cmd) {
  try {
    const result = spawnSync(cmd, ['-version'], { stdio: 'pipe', encoding: 'utf8', timeout: 2000 });
    if (result.status === 0) {
      const match = (result.stdout || '').match(/\bversion\s+([^\s]+)/i);
      return { ok: true, version: match ? match[1] : 'installed' };
    }
    return { ok: false, error: 'not_found' };
  } catch {
    return { ok: false, error: 'not_found' };
  }
}

function checkDirectoryWritable(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
    const testFile = resolve(dirPath, `.doctor_write_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    writeFileSync(testFile, 'ok', 'utf8');
    unlinkSync(testFile);
    return { ok: true, path: dirPath };
  } catch (error) {
    return { ok: false, path: dirPath, error: String(error) };
  }
}

function migrationStatus(path, expected) {
  if (!existsSync(path)) return { ok: true, label: `${path.replace(`${root}/`, '')}（首次启动时创建，目标 v${expected}）` };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
    if (!table) return { ok: false, label: `${path.replace(`${root}/`, '')} 仍是旧的无版本结构` };
    const check = database.prepare('PRAGMA quick_check').get();
    const versionRow = database.prepare('SELECT COALESCE(MAX(version),0) as version FROM schema_migrations').get();
    const version = Number(versionRow?.version ?? 0);
    const migrationOk = version === expected;
    const quickCheckOk = check.quick_check === 'ok';
    return {
      ok: migrationOk && quickCheckOk,
      label: `${path.replace(`${root}/`, '')}（v${version}/${expected}, quick_check: ${check.quick_check}${migrationOk ? '' : '，请先运行 npm run db:migrate'}）`,
    };
  } catch { return { ok: false, label: `${path.replace(`${root}/`, '')}（检查失败）` }; }
  finally { database.close(); }
}

console.log(`邻舍环境检查${environment.version ? `（v${environment.version}）` : ''}`);
line(environment.agentReady, 'Node 后端依赖');
line(environment.webReady, 'Web 前端依赖');
line(environment.python !== null, `Python 3.10+${environment.python ? `：${environment.python}` : ''}`);
line(environment.vectorDependenciesReady, '向量服务 Python 依赖');
line(environment.vectorModelReady, 'Jina 向量模型');
line(Number(process.versions.node.split('.')[0]) >= 22, `Node.js ${process.version}`);
line(configured('STHSTART_ADMIN_TOKEN'), '管理令牌（至少 32 字符）');
line(configured('STHSTART_SESSION_SECRET') || configured('STHSTART_ADMIN_TOKEN'), '管理会话签名密钥');
line(configured('STHSTART_IMAGE_SIGNING_SECRET') || configured('STHSTART_ADMIN_TOKEN'), '产物签名密钥（至少 32 字符）');

// 媒体工具检查
const ffmpeg = checkTool('ffmpeg');
const ffprobe = checkTool('ffprobe');
if (ffmpeg.ok) line(true, `ffmpeg 视频转码工具（${ffmpeg.version}）`);
else warnLine('ffmpeg 视频转码工具未检测到，视频生成后处理将受限');
if (ffprobe.ok) line(true, `ffprobe 媒体分析工具（${ffprobe.version}）`);
else warnLine('ffprobe 媒体分析工具未检测到，视频时长/元数据抽取将受限');

// 存储目录检查
const artifactDir = resolve(root, envValue('STHSTART_ARTIFACT_DIR', 'data/artifacts'));
const artifactWritable = checkDirectoryWritable(artifactDir);
line(artifactWritable.ok, `中央 Artifact 存储目录可写（${artifactDir.replace(`${root}/`, '')}）`);
if (!artifactWritable.ok) {
  console.error(`Artifact 目录不可写: ${artifactWritable.error}`);
  process.exitCode = 1;
}

const databasePath = resolve(root, envValue('STHSTART_DATABASE_PATH', 'data/sthstart.db'));
const narrativeDatabasePath = resolve(root, envValue('STHSTART_NARRATIVE_DATABASE_PATH', 'data/narrative.db'));
for (const [path, expected] of [[databasePath, expectedMigrations.service], [narrativeDatabasePath, expectedMigrations.narrative]]) {
  const status = migrationStatus(path, expected); line(status.ok, status.label);
  if (!status.ok) process.exitCode = 1;
}

// 生成配置与安全检查
const sthstartDbPath = databasePath;
if (existsSync(sthstartDbPath)) {
  try {
    const db = new DatabaseSync(sthstartDbPath, { readOnly: true });
    const engines = db.prepare("SELECT id, name, kind, base_url, enabled FROM generation_engines").all();
    const workers = db.prepare("SELECT engine_id, model, ip_allowlist_json, disk_warning_bytes, disk_stop_bytes FROM generation_workers").all();
    const workflows = db.prepare("SELECT id, name, latest_version, engine_kind FROM generation_workflows").all();
    db.close();

    if (engines.length > 0) {
      console.log(`✓ 生成引擎配置：已注册 ${engines.length} 个引擎（${engines.map(e => `${e.name}[${e.kind}]`).join(', ')}）`);
    }
    if (workers.length > 0) {
      console.log(`✓ Windows Worker：已注册 ${workers.length} 个 Worker 节点（单并发固定，磁盘水位监控已就绪）`);
    }
    if (workflows.length > 0) {
      console.log(`✓ 版本化工作流：已注册 ${workflows.length} 个工作流（${workflows.map(w => `${w.name} v${w.latest_version}`).join(', ')}）`);
    }
  } catch {
    // Ignore non-blocking probe errors
  }
}

// 安全告警与网络边界检查（绝不打印具体密钥）
const lanAccess = String(process.env.STHSTART_LAN_ACCESS ?? fileEnvironment.STHSTART_LAN_ACCESS ?? '').toLowerCase() === 'true';
if (lanAccess) {
  warnLine('局域网访问已启用（仅限受信任的家庭 Wi-Fi 网络使用，请勿在公共网络开启）');
}

if (!environment.vectorReady) {
  console.log('提示：门户、聊天和多数邻舍功能仍可启动；长期向量记忆会降级。');
  console.log('如需完整向量能力，请运行 npm run setup:vector。');
}

if (!environment.agentReady || !environment.webReady) {
  console.error('邻舍核心依赖未准备好，请先运行 npm run setup。');
  process.exitCode = 1;
}
