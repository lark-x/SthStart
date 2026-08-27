import { createHash, createHmac } from 'node:crypto';
import type { GenerationTaskDescriptor } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import type { ResolvedProfile } from '../providers.js';
import type { SecretStore } from '../security.js';
import { createGenerationTask, getGenerationTask } from '../generation.js';

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function compatibleHeaders(headers: Record<string, string>) {
  return Object.fromEntries(Object.entries(headers)
    .filter(([key, value]) => typeof value === 'string' && !/^(host|content-length|authorization)$/i.test(key)));
}

function ensureLegacyResources(database: ServiceDatabase, profile: ResolvedProfile, workflow: Record<string, unknown>) {
  const profileRow = database.connection.prepare(
    'SELECT name, credential_account FROM provider_profiles WHERE id = ? AND kind = \'image\'',
  ).get(profile.id) as { name: string; credential_account: string | null } | undefined;
  if (!profileRow) throw Object.assign(new Error('图片服务配置已不存在。'), { code: 'image_unavailable' });

  const engineId = `legacy-image-${digest(profile.id)}`;
  const definitionJson = JSON.stringify(workflow);
  const workflowId = `legacy-image-${digest(`${profile.id}:${definitionJson}`)}`;
  const now = nowIso();
  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO generation_engines
        (id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at)
      VALUES (?,?,'comfyui',?,?,1,1,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,
        credential_account=excluded.credential_account,enabled=1,updated_at=excluded.updated_at
    `).run(
      engineId,
      `兼容：${profileRow.name}`,
      profile.baseUrl,
      profileRow.credential_account,
      now,
      now,
    );
    database.connection.prepare(`INSERT INTO generation_engine_options(engine_id,headers_json) VALUES (?,?)
      ON CONFLICT(engine_id) DO UPDATE SET headers_json=excluded.headers_json`)
      .run(engineId, JSON.stringify(compatibleHeaders(profile.headers)));
    database.connection.prepare(`
      INSERT INTO generation_workflows
        (id,name,description,engine_kind,latest_version,created_at,updated_at)
      VALUES (?,?,'由旧图片接口自动维护。','comfyui',1,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
    `).run(workflowId, `旧图片工作流 ${workflowId.slice(-8)}`, now, now);
    database.connection.prepare(`
      INSERT OR IGNORE INTO generation_workflow_versions
        (workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at)
      VALUES (?,1,?,'{}','{}','[]',?,1,?)
    `).run(workflowId, engineId, definitionJson, now);
  });
  return { engineId, workflowId };
}

export async function createLegacyImageTask(
  config: ServiceConfig,
  database: ServiceDatabase,
  secrets: SecretStore,
  input: { appId: string; idempotencyKey: string; profile: ResolvedProfile; workflow: Record<string, unknown> },
  fetcher: typeof fetch,
) {
  const { workflowId } = ensureLegacyResources(database, input.profile, input.workflow);
  const created = await createGenerationTask(config, database, secrets, {
    appId: input.appId,
    idempotencyKey: input.idempotencyKey,
    purpose: 'legacy-image',
    workflowId,
    workflowVersion: 1,
    isInternal: true,
  }, fetcher);
  const deadline = Date.now() + 30_000;
  let current = created;
  while (Date.now() < deadline && !current.providerTaskId && ['queued', 'submitting'].includes(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    current = getGenerationTask(database, created.id, input.appId) ?? current;
  }
  return current;
}

export function legacyImageTaskDescriptor(config: ServiceConfig, task: GenerationTaskDescriptor) {
  const status = task.status === 'succeeded'
    ? 'complete'
    : task.status === 'queued' || task.status === 'submitting'
      ? 'accepted'
      : task.status;
  const expires = Date.now() + 5 * 60_000;
  return {
    id: task.id,
    status,
    providerTaskId: task.providerTaskId,
    provider_task_id: task.providerTaskId,
    error: task.errorMessage,
    errorCode: task.errorCode,
    upstreamMayContinue: task.upstreamMayContinue,
    cancellationScope: task.cancellationScope,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    artifacts: task.artifacts.map((artifact) => ({
      id: artifact.artifactId,
      artifactId: artifact.artifactId,
      content_type: artifact.contentType,
      byte_size: artifact.byteSize,
      url: `/api/v1/images/artifacts/${artifact.artifactId}?expires=${expires}&signature=${createHmac('sha256', config.imageSigningSecret)
        .update(`${artifact.artifactId}.${expires}`)
        .digest('base64url')}`,
    })),
  };
}
