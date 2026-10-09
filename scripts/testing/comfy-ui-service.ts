/** Isolated browser fixture: all state is temporary and every upstream call is refused. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../../apps/service/src/server.js';
import { readConfig } from '../../apps/service/src/config.js';
import { SecretStore } from '../../apps/service/src/security.js';

const directory = mkdtempSync(join(tmpdir(), 'sth-comfy-ui-'));
const config = readConfig({
  SERVICE_PORT: '4374', PORTAL_ORIGINS: 'http://127.0.0.1:4373',
  STHSTART_ADMIN_TOKEN: 'comfy-ui-offline-token-0123456789',
  STHSTART_DATABASE_PATH: join(directory, 'service.db'),
  STHSTART_NARRATIVE_DATABASE_PATH: join(directory, 'narrative.db'),
  STHSTART_ARTIFACT_DIR: join(directory, 'artifacts'), STHSTART_LOG_DIR: join(directory, 'logs'),
});
const { app } = await createService({ config, secrets: new SecretStore({}),
  fetcher: async () => { throw new Error('Offline UI fixture refuses upstream calls'); } });
process.once('SIGTERM', () => { void app.close(); });
process.once('SIGINT', () => { void app.close(); });
await app.listen({ host: config.host, port: config.port });
