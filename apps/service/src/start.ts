import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createService } from './server.js';

const envFile = resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) loadEnvFile(envFile);

const { app, config } = await createService();

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(`[sthstart-service] http://${config.host}:${config.port}`);
} catch (error) {
  console.error('[sthstart-service] failed to start', error);
  process.exitCode = 1;
}
