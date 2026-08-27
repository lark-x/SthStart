import { hashToken, issueToken } from '../security.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

type GenerationConsumer = {
  id: string;
  name: string;
  capabilities: string[];
};

const CONSUMERS: readonly GenerationConsumer[] = [
  { id: 'characters', name: '角色库', capabilities: ['generation', 'artifact', 'persona'] },
  { id: 'narrative', name: '叙事档案', capabilities: ['generation', 'artifact'] },
];

/**
 * Generation-backed product modules are first-class service consumers. Their
 * credentials are intentionally not exposed: routes invoke the core in-process
 * and only need a managed_apps row for foreign keys, quota ownership and
 * artifact isolation.
 */
export function ensureGenerationConsumerApps(database: ServiceDatabase) {
  const now = nowIso();
  for (const consumer of CONSUMERS) {
    const tokenHash = hashToken(issueToken(`sth_${consumer.id}`));
    database.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at)
      VALUES (?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,capabilities_json=excluded.capabilities_json,enabled=1,updated_at=excluded.updated_at`)
      .run(consumer.id, consumer.name, tokenHash, JSON.stringify(consumer.capabilities), now, now);
    database.connection.prepare('INSERT OR IGNORE INTO storage_policies(app_id,mode) VALUES (?,?)').run(consumer.id, 'keep');
  }
}
