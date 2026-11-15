import type { ModelInferenceTestResult } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import type { SecretStore } from './security.js';
import { connectionSupportsModelType, listModelRoutes } from './model-routing.js';

export function modelReferences(database: ServiceDatabase, id: string): string[] {
  const refs = listModelRoutes(database).filter(r => r.primaryModelId === id || r.fallbackModelIds.includes(id))
    .map(r => `${r.appId ?? '公共默认'}·${r.capability}`);
  for (const row of database.connection.prepare('SELECT app_id FROM app_llm_assignments WHERE profile_id=? UNION SELECT app_id FROM purpose_bindings WHERE target_type=\'model\' AND target_id=?').all(id, id) as Array<{app_id: string}>) refs.push(row.app_id);
  for (const row of database.connection.prepare('SELECT character_id FROM character_model_assignments WHERE profile_id=?').all(id) as Array<{character_id: string}>) refs.push(`角色 ${row.character_id}`);
  for (const row of database.connection.prepare("SELECT workflow_id FROM generation_workflow_versions WHERE json_extract(definition_json,'$.modelProfileId')=?").all(id) as Array<{workflow_id: string}>) refs.push(`绘图方案 ${row.workflow_id}`);
  return [...new Set(refs)];
}

export async function embedWithModel(database: ServiceDatabase, secrets: SecretStore, id: string, text: unknown, fetcher: typeof fetch) {
  const row = database.connection.prepare(`SELECT mp.*, sc.base_url, sc.credential_account, sc.headers_json, sc.kind,
    sc.enabled AS connection_enabled, sc.timeout_ms AS connection_timeout_ms FROM model_profiles mp
    JOIN service_connections sc ON sc.id=mp.connection_id WHERE mp.id=?`).get(id) as Record<string, unknown> | undefined;
  if (!row || !row.enabled || !row.connection_enabled || row.model_type !== 'embedding' || !connectionSupportsModelType(String(row.kind), 'embedding')) throw new Error('embedding_model_unavailable');
  if (!(typeof text === 'string' && text.trim()) && !(Array.isArray(text) && text.length > 0 && text.every(t => typeof t === 'string' && t.trim()))) throw new Error('invalid_embedding_input');
  let secret = row.credential_account ? (await secrets.get(String(row.credential_account), `STHSTART_SECRET_${String(row.connection_id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)).value : null;
  if (!secret && row.credential_account) secret = (await secrets.get(String(row.credential_account), `STHSTART_SECRET_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`)).value;
  const legacy = row.kind === 'vector';
  const response = await fetcher(`${String(row.base_url).replace(/\/+$/, '')}/${legacy ? 'embed' : 'embeddings'}`, {
    method: 'POST', headers: { ...JSON.parse(String(row.headers_json)), 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(legacy ? { text } : { model: row.model_id, input: text }),
    signal: AbortSignal.timeout(Number(row.timeout_ms || row.connection_timeout_ms || 60000)),
  });
  if (!response.ok) throw new Error(`embedding_http_${response.status}`);
  const payload = await response.json() as { embeddings?: unknown; data?: Array<{embedding: unknown; index: number}> };
  const expected = Array.isArray(text) ? text.length : 1;
  const validData = Array.isArray(payload.data) && payload.data.length === expected
    && payload.data.every(item => item && Number.isInteger(item.index) && item.index >= 0 && item.index < expected)
    && new Set(payload.data.map(item => item.index)).size === expected;
  const embeddings = legacy ? payload.embeddings : validData ? payload.data!.sort((a,b) => a.index-b.index).map(v => v.embedding) : undefined;
  if (!Array.isArray(embeddings) || embeddings.length !== expected || !embeddings.every(v => Array.isArray(v) && v.length > 0 && v.length === (embeddings[0] as unknown[]).length && v.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new Error('invalid_embedding_response');
  return { embeddings };
}

export async function testEmbeddingModel(database: ServiceDatabase, secrets: SecretStore, row: Record<string, unknown>, fetcher: typeof fetch): Promise<ModelInferenceTestResult> {
  const start = Date.now();
  let result: ModelInferenceTestResult;
  try {
    const output = await embedWithModel(database, secrets, String(row.id), '连接测试', fetcher);
    result = { success: true, output: `向量计算成功，维度 ${(output.embeddings[0] as number[]).length}`, latencyMs: Date.now()-start, tokenUsage: null, aiCallId: null, error: null };
  } catch {
    result = { success: false, output: null, latencyMs: Date.now()-start, tokenUsage: null, aiCallId: null, error: '向量调用失败，请检查模型、地址和密钥。' };
  }
  database.connection.prepare('UPDATE model_profiles SET test_status=?,last_tested_at=? WHERE id=?').run(result.success ? 'passed' : 'failed', nowIso(), String(row.id));
  return result;
}
