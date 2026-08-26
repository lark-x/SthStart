import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');
let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(examplePath, 'utf8');
const configured = [];

for (const key of ['STHSTART_ADMIN_TOKEN', 'STHSTART_IMAGE_SIGNING_SECRET', 'STHSTART_SESSION_SECRET']) {
  const pattern = new RegExp(`^${key}=(.*)$`, 'm');
  const match = content.match(pattern);
  if (match?.[1]?.trim()) continue;
  const value = randomBytes(32).toString('hex');
  content = match ? content.replace(pattern, `${key}=${value}`) : `${content.trimEnd()}\n${key}=${value}\n`;
  configured.push(key);
}

const temporaryPath = `${envPath}.tmp`;
writeFileSync(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
renameSync(temporaryPath, envPath);
chmodSync(envPath, 0o600);
console.log(configured.length ? `已安全配置：${configured.join('、')}` : '环境密钥已经配置，无需修改。');
