import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { resolveLinsheEnvironment } from './linshe-env.mjs';

const root = resolve(import.meta.dirname, '..');
const environment = resolveLinsheEnvironment(root);
const line = (ok, label) => console.log(`${ok ? '✓' : '✗'} ${label}`);
const envPath = resolve(root, '.env');
const fileEnvironment = existsSync(envPath) ? Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).map((row) => row.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match[1], match[2].trim()])) : {};
const configured = (name) => String(process.env[name] ?? fileEnvironment[name] ?? '').length >= 32;

function migrationStatus(path) {
  if (!existsSync(path)) return { ok: true, label: `${path.replace(`${root}/`, '')}（首次启动时创建）` };
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const table = database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
    if (!table) return { ok: false, label: `${path.replace(`${root}/`, '')} 仍是旧的无版本结构` };
    const check = database.prepare('PRAGMA quick_check').get();
    return { ok: check.quick_check === 'ok', label: `${path.replace(`${root}/`, '')}（quick_check: ${check.quick_check}）` };
  } catch (error) { return { ok: false, label: `${path.replace(`${root}/`, '')}（${String(error)}）` }; }
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
for (const path of [resolve(root, fileEnvironment.STHSTART_DATABASE_PATH || 'data/sthstart.db'), resolve(root, fileEnvironment.STHSTART_NARRATIVE_DATABASE_PATH || 'data/narrative.db')]) {
  const status = migrationStatus(path); line(status.ok, status.label);
  if (!status.ok) process.exitCode = 1;
}

if (!environment.vectorReady) {
  console.log('提示：门户、聊天和多数邻舍功能仍可启动；长期向量记忆会降级。');
  console.log('如需完整向量能力，请运行 npm run setup:vector。');
}

if (!environment.agentReady || !environment.webReady) {
  console.error('邻舍核心依赖未准备好，请先运行 npm run setup。');
  process.exitCode = 1;
}
