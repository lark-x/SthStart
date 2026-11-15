import type { FastifyInstance } from 'fastify';
import type {
  ApplyPublicModelRoute,
  ModelRouteCapability,
  ModelRouteScope,
  SaveModelRoute,
} from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { getModelRoute, inspectModelProfile, listModelRoutes } from './model-routing.js';

function roleForCapability(capability: ModelRouteCapability) {
  return capability;
}

function modelIsUsable(database: ServiceDatabase, modelId: string, capability: ModelRouteCapability): boolean {
  return inspectModelProfile(database, modelId, capability, 'openai-compatible-text').availability === 'ok';
}

function routeId(scope: ModelRouteScope, appId: string | null, capability: ModelRouteCapability) {
  return `route:${scope}:${appId ?? ''}:${capability}`;
}

/**
 * The legacy assignment endpoint writes `app_llm_assignments`. Keep the
 * explicit app route in the same transaction so the exception summary and
 * runtime selection cannot drift apart when that old surface is used.
 */
export function syncAppRouteWithAssignment(
  database: ServiceDatabase,
  appId: string,
  capability: ModelRouteCapability,
  modelId: string | null,
  now: string,
) {
  if (!modelId) {
    database.connection.prepare(
      'DELETE FROM model_routes WHERE scope=? AND app_id=? AND capability=?',
    ).run('app', appId, capability);
    return;
  }
  const existing = getModelRoute(database, 'app', appId, capability);
  database.connection.prepare(`
    INSERT INTO model_routes (
      id, scope, app_id, capability, primary_model_id, fallback_model_ids_json,
      inherit_public_fallbacks, created_at, updated_at
    ) VALUES (?, 'app', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, app_id, capability) DO UPDATE SET
      primary_model_id = excluded.primary_model_id,
      updated_at = excluded.updated_at
  `).run(
    routeId('app', appId, capability),
    appId,
    capability,
    modelId,
    JSON.stringify(existing?.fallbackModelIds ?? []),
    existing ? (existing.inheritPublicFallbacks ? 1 : 0) : 1,
    existing?.createdAt ?? now,
    now,
  );
}

function sendRouteError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: string, message: string) {
  return reply.code(400).send({ error, message });
}

function legacyKind(connectionKind: string): 'llm' | 'image' | 'vector' | null {
  if (connectionKind === 'openai-compatible-image') return 'image';
  if (connectionKind === 'vector') return 'vector';
  if (connectionKind === 'openai-compatible-text') return 'llm';
  return null;
}

/**
 * The old assignment endpoints and several runtime consumers still read
 * app_llm_assignments/provider_profiles. Saving an app route must update that
 * projection in the same transaction so the two surfaces cannot disagree.
 */
function syncLegacyAssignment(
  database: ServiceDatabase,
  appId: string,
  capability: ModelRouteCapability,
  modelId: string,
  now: string,
) {
  const row = database.connection.prepare(`
    SELECT mp.id,mp.name,mp.model_id,mp.enabled,mp.capabilities_json,mp.default_params_json,mp.advanced_json,
           sc.base_url,sc.credential_account,sc.headers_json,sc.options_json,sc.kind,sc.enabled AS connection_enabled
    FROM model_profiles mp
    JOIN service_connections sc ON sc.id = mp.connection_id
    WHERE mp.id = ?
  `).get(modelId) as {
    id: string; name: string; model_id: string; enabled: number; capabilities_json: string;
    default_params_json: string; advanced_json: string; base_url: string;
    credential_account: string | null; headers_json: string; options_json: string;
    kind: string; connection_enabled: number;
  } | undefined;
  if (!row) return false;
  const kind = legacyKind(row.kind);
  if (kind !== 'llm') return false;

  const advanced = JSON.parse(row.advanced_json || '{}') as Record<string, unknown>;
  const defaultParams = JSON.parse(row.default_params_json || '{}') as Record<string, unknown>;
  const connectionOptions = JSON.parse(row.options_json || '{}') as Record<string, unknown>;
  const thinkingMode = ['enabled', 'disabled', 'omit'].includes(String(advanced.thinkingMode))
    ? String(advanced.thinkingMode)
    : 'omit';
  const enabled = row.enabled === 1 && row.connection_enabled === 1 ? 1 : 0;

  database.connection.prepare(`
    INSERT INTO provider_profiles (id,name,kind,base_url,model,credential_account,enabled,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, kind=excluded.kind, base_url=excluded.base_url, model=excluded.model,
      credential_account=excluded.credential_account, enabled=excluded.enabled, updated_at=excluded.updated_at
  `).run(
    row.id, row.name, kind, row.base_url, row.model_id, row.credential_account, enabled, now, now,
  );
  database.connection.prepare(`
    INSERT INTO provider_profile_options (profile_id,thinking_mode,headers_json,extra_body_json,capabilities_json)
    VALUES (?,?,?,?,?)
    ON CONFLICT(profile_id) DO UPDATE SET
      thinking_mode=excluded.thinking_mode, headers_json=excluded.headers_json,
      extra_body_json=excluded.extra_body_json, capabilities_json=excluded.capabilities_json
  `).run(
    row.id,
    thinkingMode,
    row.headers_json || '{}',
    JSON.stringify({ ...connectionOptions, ...defaultParams, ...advanced }),
    row.capabilities_json || '["text"]',
  );
  database.connection.prepare(`
    INSERT INTO app_llm_assignments (app_id,role,profile_id,updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(app_id,role) DO UPDATE SET profile_id=excluded.profile_id,updated_at=excluded.updated_at
  `).run(appId, roleForCapability(capability), row.id, now);
  return true;
}

export function registerModelRouteRoutes(app: FastifyInstance, database: ServiceDatabase) {
  app.get('/api/v1/admin/model-routes', async () => ({ items: listModelRoutes(database) }));

  app.put<{ Body: SaveModelRoute }>('/api/v1/admin/model-routes', async (request, reply) => {
    const body = request.body;
    if (!body || !['public', 'app'].includes(body.scope)) return sendRouteError(reply, 'invalid_route_scope', '作用域无效。');
    if (!['text', 'multimodal'].includes(body.capability)) return sendRouteError(reply, 'invalid_route_capability', '能力类型无效。');
    if (typeof body.inheritPublicFallbacks !== 'boolean') return sendRouteError(reply, 'invalid_route_inheritance', '继承公共备用设置无效。');
    if (typeof body.primaryModelId !== 'string' || !body.primaryModelId.trim() || body.primaryModelId.length > 160) {
      return sendRouteError(reply, 'invalid_route_primary', '请选择有效的主模型。');
    }
    if (!Array.isArray(body.fallbackModelIds) || body.fallbackModelIds.length > 2
      || body.fallbackModelIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 160)) {
      return sendRouteError(reply, 'invalid_route_fallbacks', '备用模型最多两个，且必须是有效模型 ID。');
    }
    if (body.scope === 'app') {
      if (typeof body.appId !== 'string' || !body.appId.trim()
        || !database.connection.prepare('SELECT 1 FROM managed_apps WHERE id=?').get(body.appId)) {
        return sendRouteError(reply, 'route_app_not_found', '应用不存在。');
      }
    } else if (body.appId) {
      return sendRouteError(reply, 'public_route_app_forbidden', '公共模型路由不能绑定应用。');
    }
    const primaryModelId = body.primaryModelId.trim();
    if (!modelIsUsable(database, primaryModelId, body.capability)) {
      return sendRouteError(reply, 'route_primary_unavailable', '主模型不存在、未启用或能力不匹配。');
    }
    const fallbacks = [...new Set(body.fallbackModelIds.map((id) => id.trim()))];
    if (fallbacks.length > 2 || fallbacks.includes(primaryModelId)) {
      return sendRouteError(reply, 'invalid_route_fallbacks', '备用模型最多两个，且不能与主模型重复。');
    }
    for (const fallback of fallbacks) {
      if (!modelIsUsable(database, fallback, body.capability)) {
        return sendRouteError(reply, 'route_fallback_unavailable', `备用模型 ${fallback} 不存在、未启用或能力不匹配。`);
      }
    }

    const scope = body.scope;
    const appId = scope === 'public' ? '' : body.appId ?? '';
    const id = routeId(scope, scope === 'public' ? null : appId, body.capability);
    const now = nowIso();
    database.transaction(() => {
      database.connection.prepare(`
        INSERT INTO model_routes (
          id, scope, app_id, capability, primary_model_id, fallback_model_ids_json,
          inherit_public_fallbacks, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, app_id, capability) DO UPDATE SET
          primary_model_id = excluded.primary_model_id,
          fallback_model_ids_json = excluded.fallback_model_ids_json,
          inherit_public_fallbacks = excluded.inherit_public_fallbacks,
          updated_at = excluded.updated_at
      `).run(
        id,
        scope,
        appId,
        body.capability,
        primaryModelId,
        JSON.stringify(fallbacks),
        scope === 'app' && body.inheritPublicFallbacks ? 1 : 0,
        now,
        now,
      );

      if (scope === 'app') {
        syncLegacyAssignment(database, appId, body.capability, primaryModelId, now);
      }
    });

    const saved = getModelRoute(database, scope, scope === 'public' ? null : appId, body.capability);
    return saved ? reply.code(201).send(saved) : reply.code(500).send({ error: 'route_save_failed' });
  });

  app.delete<{ Params: { appId: string; capability: ModelRouteCapability } }>(
    '/api/v1/admin/model-routes/apps/:appId/:capability',
    async (request, reply) => {
      const { appId, capability } = request.params;
      if (!['text', 'multimodal'].includes(capability)) return sendRouteError(reply, 'invalid_route_capability', '能力类型无效。');
      const route = getModelRoute(database, 'app', appId, capability);
      const legacy = database.connection.prepare(
        'SELECT 1 FROM app_llm_assignments WHERE app_id=? AND role=?',
      ).get(appId, capability);
      if (!route && !legacy) return reply.code(404).send({ error: 'route_not_found' });
      database.transaction(() => {
        database.connection.prepare('DELETE FROM model_routes WHERE scope=? AND app_id=? AND capability=?')
          .run('app', appId, capability);
        database.connection.prepare('DELETE FROM app_llm_assignments WHERE app_id=? AND role=?')
          .run(appId, capability);
      });
      return { ok: true, inherited: Boolean(getModelRoute(database, 'public', null, capability)) };
    },
  );

  app.post<{ Body: ApplyPublicModelRoute }>('/api/v1/admin/model-routes/apply-public', async (request, reply) => {
    const capability = request.body?.capability;
    if (!capability || !['text', 'multimodal'].includes(capability)) {
      return sendRouteError(reply, 'invalid_route_capability', '能力类型无效。');
    }
    if (!getModelRoute(database, 'public', null, capability)) {
      return reply.code(409).send({ error: 'public_route_missing', message: '请先设置公共常用模型。' });
    }
    let removed = 0;
    database.transaction(() => {
      const routeResult = database.connection.prepare(
        'DELETE FROM model_routes WHERE scope=? AND capability=?',
      ).run('app', capability);
      const assignmentResult = database.connection.prepare(
        'DELETE FROM app_llm_assignments WHERE role=?',
      ).run(capability);
      removed = Number(routeResult.changes) + Number(assignmentResult.changes);
    });
    return { ok: true, removed };
  });
}
