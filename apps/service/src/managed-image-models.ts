import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { publishWorkflowVersion } from './generation/workflow-publish.js';

/** Uses existing workflow/version lifecycle; creating a recipe never submits an image task. */
export function registerManagedImageModels(app: FastifyInstance, database: ServiceDatabase) {
  app.post<{Params: {id: string}; Body: {operation?: string}}>('/api/v1/admin/models/:id/image-workflow', async (request, reply) => {
    const row = database.connection.prepare(`SELECT mp.*,sc.base_url,sc.credential_account,sc.headers_json,sc.enabled AS connection_enabled,sc.kind
      FROM model_profiles mp JOIN service_connections sc ON sc.id=mp.connection_id WHERE mp.id=?`).get(request.params.id) as Record<string,unknown> | undefined;
    if (!row || row.model_type !== 'image' || !row.enabled || !row.connection_enabled || ['comfyui','worker','vector'].includes(String(row.kind))) return reply.code(400).send({error:'image_model_unavailable',message:'请选择已启用的 OpenAI 兼容绘图模型。'});
    const operation = request.body?.operation ?? 'text-to-image';
    if (!['text-to-image','image-to-image'].includes(operation)) return reply.code(400).send({error:'invalid_operation'});
    const workflowId = `image-${randomUUID()}`;
    const engineId = `managed-${row.connection_id}`;
    try {
      database.transaction(() => {
        const now = nowIso();
        database.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,credential_account,enabled,concurrency_limit,created_at,updated_at,connection_id)
          VALUES(?,?,'cloud',?,?,1,1,?,?,?) ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url,credential_account=excluded.credential_account,enabled=excluded.enabled,updated_at=excluded.updated_at`)
          .run(engineId, String(row.name), String(row.base_url), row.credential_account ? String(row.credential_account) : null, now, now, String(row.connection_id));
        database.connection.prepare(`INSERT INTO generation_engine_options(engine_id,headers_json) VALUES(?,?) ON CONFLICT(engine_id) DO UPDATE SET headers_json=excluded.headers_json`).run(engineId,String(row.headers_json));
        database.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,category,latest_version,created_at,updated_at) VALUES(?,?,?,'cloud','image',0,?,?)`)
          .run(workflowId, `${row.name} · ${operation === 'text-to-image' ? '文生图' : '参考图'}`, '使用模型库中的供应商连接',now,now);
      });
      publishWorkflowVersion(database, { workflowId, engineId, definition: { type: 'cloud_recipe', modelId: String(row.model_id), modelProfileId: String(row.id), operation },
        inputSchema: { prompt: {type:'string',required:true} },
        inputCapabilities: operation === 'image-to-image' ? { referenceImage: { semantic: 'init_image', mediaTypes: ['image/*'], maxCount: 1, required: true } } : {},
        nodeBindings: {}, outputDeclarations: ['image'], category: 'image' });
      return reply.code(201).send({workflowId,engineId});
    } catch {
      database.connection.prepare('DELETE FROM generation_workflows WHERE id=? AND latest_version=0').run(workflowId);
      return reply.code(400).send({error:'image_workflow_failed',message:'绘图方案创建失败，请检查模型配置。'});
    }
  });
}
