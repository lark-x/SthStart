import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createService } from './server.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const { app, config } = await createService();
let closing = false;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`[sthstart-service] received ${signal}, stopping managed services`);
  const forcedExit = setTimeout(() => process.exit(1), 15_000);
  forcedExit.unref();
  try { await app.close(); process.exitCode = 0; }
  catch (error) { console.error('[sthstart-service] graceful shutdown failed', error); process.exitCode = 1; }
  finally { clearTimeout(forcedExit); }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[sthstart-service] http://${config.host}:${config.port}`);
} catch (error) {
  console.error('[sthstart-service] failed to start', error);
  process.exitCode = 1;
}
