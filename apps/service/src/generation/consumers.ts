import { hashToken, issueToken } from '../security.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { PublicCapability } from '@sthstart/contracts';

type GenerationConsumer = {
  id: string;
  name: string;
  capabilities: PublicCapability[];
};

/**
 * characters/activities 直接调用文本模型（角色草稿、试演识图、活动企划与阶段文案），
 * 必须声明 llm，否则「应用路由」按 llm 过滤后不展示它们，用户无从绑定。
 */
const CONSUMERS: readonly GenerationConsumer[] = [
  { id: 'characters', name: '角色库', capabilities: ['llm', 'generation', 'artifact', 'persona'] },
  { id: 'narrative', name: '叙事档案', capabilities: ['generation', 'artifact'] },
  { id: 'activities', name: '活动工作室', capabilities: ['llm', 'generation', 'artifact', 'activities'] },
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
