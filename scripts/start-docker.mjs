import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// 1. Ensure required security tokens have high entropy (at least 32 characters)
function ensureSecret(name) {
  let val = process.env[name]?.trim();
  if (!val || val.length < 32) {
    val = randomBytes(32).toString('hex');
    process.env[name] = val;
    console.log(`[SthStart Docker] 环境变量 ${name} 未配置或长度不足 32 位，已自动生成高熵随机安全凭据。`);
  }
}

ensureSecret('STHSTART_ADMIN_TOKEN');
ensureSecret('STHSTART_IMAGE_SIGNING_SECRET');
ensureSecret('STHSTART_SESSION_SECRET');

// 2. Ensure data directories exist
const dataDir = process.env.STHSTART_DATA_DIR || resolve(root, 'data');
const artifactsDir = process.env.STHSTART_ARTIFACT_DIR || resolve(dataDir, 'artifacts');
const logsDir = process.env.STHSTART_LOG_DIR || resolve(dataDir, 'logs');
mkdirSync(artifactsDir, { recursive: true });
mkdirSync(logsDir, { recursive: true });

// 3. Configure hosts and origins
process.env.SERVICE_HOST = '127.0.0.1'; // 内部公共服务严格绑定回环，防止未授权外部网络直连
process.env.SERVICE_PORT = process.env.SERVICE_PORT || '4100';
process.env.PORTAL_PORT = process.env.PORTAL_PORT || '4173';

const portalPort = process.env.PORTAL_PORT;
const configuredPublicOrigins = (process.env.STHSTART_PUBLIC_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const defaultOrigins = [`http://127.0.0.1:${portalPort}`, `http://localhost:${portalPort}`];
const portalOrigins = [...new Set([...defaultOrigins, ...configuredPublicOrigins])].join(',');
process.env.PORTAL_ORIGINS = process.env.PORTAL_ORIGINS || portalOrigins;

// 4. Run database migrations before starting services
console.log('[SthStart Docker] 正在执行数据库迁移与完整性校验...');
const migrateProcess = spawn(npmCommand, ['run', 'db:migrate'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

migrateProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[SthStart Docker] 数据库初始化失败，退出码：${code}`);
    process.exit(code ?? 1);
  }

  console.log(`[SthStart Docker] 正在启动 SthStart 容器服务 (Portal: 0.0.0.0:${portalPort}, Service: 127.0.0.1:${process.env.SERVICE_PORT})...`);

  const child = spawn(npmCommand, ['run', 'start:lan:processes'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  child.once('exit', (childCode, signal) => {
    process.exitCode = childCode ?? (signal ? 1 : 0);
  });

  process.once('SIGINT', () => child.kill('SIGINT'));
  process.once('SIGTERM', () => child.kill('SIGTERM'));
});
