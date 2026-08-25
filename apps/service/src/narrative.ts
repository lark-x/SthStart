import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AkashaMcpConnector, type AkashaWorld } from './narrative-connectors.js';
import type { NarrativeDatabase } from './narrative-database.js';
import type { NarrativeImportBundle, NarrativeSourceConnector } from './narrative-types.js';
import type { ServiceDatabase } from './database.js';

const nowIso = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? {});
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateBundle(value: unknown): { bundle?: NarrativeImportBundle; errors: string[] } {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { errors: ['导入内容必须是 JSON 对象。'] };
  const bundle = value as NarrativeImportBundle;
  if (bundle.schemaVersion !== 1) errors.push('仅支持 schemaVersion: 1。');
  if (!bundle.source?.id?.trim() || !bundle.source?.name?.trim() || !['json', 'mcp'].includes(bundle.source?.kind)) errors.push('source 配置无效。');
  if (!bundle.work?.externalId?.trim() || !bundle.work?.title?.trim() || !bundle.work?.locale?.trim()) errors.push('work.externalId、title 和 locale 必填。');
  if (!bundle.release?.externalId?.trim() || !bundle.release?.label?.trim()) errors.push('release 配置无效。');
  for (const key of ['nodes', 'scenes', 'utterances'] as const) if (!Array.isArray(bundle[key])) errors.push(`${key} 必须是数组。`);
  if (errors.length) return { errors };

  const unique = (items: Array<{ externalId?: string }>, label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.externalId?.trim()) errors.push(`${label} 存在空 externalId。`);
      else if (ids.has(item.externalId)) errors.push(`${label} externalId 重复：${item.externalId}`);
      else ids.add(item.externalId);
    }
    return ids;
  };
  const nodeIds = unique(bundle.nodes, 'nodes'); const sceneIds = unique(bundle.scenes, 'scenes');
  unique(bundle.utterances, 'utterances'); if (bundle.entities) unique(bundle.entities, 'entities');
  for (const node of bundle.nodes) if (node.parentExternalId && !nodeIds.has(node.parentExternalId)) errors.push(`节点 ${node.externalId} 的父节点不存在。`);
  for (const scene of bundle.scenes) if (!nodeIds.has(scene.nodeExternalId)) errors.push(`场景 ${scene.externalId} 引用了不存在的节点。`);
  for (const utterance of bundle.utterances) {
    if (!sceneIds.has(utterance.sceneExternalId)) errors.push(`发言 ${utterance.externalId} 引用了不存在的场景。`);
    if (!utterance.text?.trim()) errors.push(`发言 ${utterance.externalId} 没有文本。`);
  }
  return errors.length ? { errors } : { bundle, errors };
}

function previewReport(database: NarrativeDatabase, bundle: NarrativeImportBundle) {
  const work = database.connection.prepare('SELECT id FROM narrative_works WHERE source_id=? AND external_id=?').get(bundle.source.id, bundle.work.externalId) as { id: string } | undefined;
  let existing = { nodes: 0, scenes: 0, utterances: 0, entities: 0 };
  if (work) {
    existing = database.connection.prepare(`SELECT
      (SELECT COUNT(*) FROM narrative_nodes WHERE work_id=?) nodes,
      (SELECT COUNT(*) FROM narrative_scenes s JOIN narrative_nodes n ON n.id=s.node_id WHERE n.work_id=?) scenes,
      (SELECT COUNT(*) FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id WHERE n.work_id=?) utterances,
      (SELECT COUNT(*) FROM narrative_entities WHERE work_id=?) entities`).get(work.id, work.id, work.id, work.id) as typeof existing;
  }
  const incoming = { nodes: bundle.nodes.length, scenes: bundle.scenes.length, utterances: bundle.utterances.length, entities: bundle.entities?.length ?? 0 };
  return {
    contentHash: hash(bundle), workExists: Boolean(work), incoming, existing,
    note: '同步采用稳定 externalId 更新或新增；上游缺失记录不会自动删除。',
  };
}

function stageBundle(database: NarrativeDatabase, bundle: NarrativeImportBundle) {
  const id = randomUUID(); const report = previewReport(database, bundle);
  database.connection.prepare('INSERT INTO narrative_import_batches VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, bundle.source.id, bundle.work.externalId, bundle.release.externalId, 'preview', JSON.stringify(bundle), JSON.stringify(report), nowIso(), null);
  return { id, status: 'preview' as const, report };
}

function commitBundle(database: NarrativeDatabase, bundle: NarrativeImportBundle) {
  const db = database.connection; const now = nowIso();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO narrative_sources VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,kind=excluded.kind,version=excluded.version,updated_at=excluded.updated_at`)
      .run(bundle.source.id, bundle.source.name.trim(), bundle.source.kind, bundle.source.version ?? null, '[]', 'ready', now);
    let work = db.prepare('SELECT id FROM narrative_works WHERE source_id=? AND external_id=?').get(bundle.source.id, bundle.work.externalId) as { id: string } | undefined;
    const workId = work?.id ?? randomUUID();
    db.prepare(`INSERT INTO narrative_works VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET
      title=excluded.title,description=excluded.description,locale=excluded.locale,updated_at=excluded.updated_at`)
      .run(workId, bundle.source.id, bundle.work.externalId, bundle.work.title.trim(), bundle.work.description?.trim() ?? '', bundle.work.locale, now, now);
    work = { id: workId };
    const releaseRow = db.prepare('SELECT id FROM narrative_releases WHERE work_id=? AND external_id=?').get(workId, bundle.release.externalId) as { id: string } | undefined;
    const releaseId = releaseRow?.id ?? randomUUID();
    db.prepare(`INSERT INTO narrative_releases VALUES (?,?,?,?,?) ON CONFLICT(work_id,external_id) DO UPDATE SET label=excluded.label`)
      .run(releaseId, workId, bundle.release.externalId, bundle.release.label.trim(), now);

    const nodeIds = new Map<string, string>();
    for (const node of bundle.nodes) {
      const row = db.prepare('SELECT id FROM narrative_nodes WHERE release_id=? AND external_id=?').get(releaseId, node.externalId) as { id: string } | undefined;
      const id = row?.id ?? randomUUID(); nodeIds.set(node.externalId, id);
      db.prepare(`INSERT INTO narrative_nodes VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(release_id,external_id) DO UPDATE SET
        kind=excluded.kind,title=excluded.title,sort_order=excluded.sort_order,summary=excluded.summary,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
        .run(id, workId, releaseId, null, node.externalId, node.kind ?? 'story', node.title.trim(), node.order, node.summary?.trim() ?? '', json(node.metadata), now);
    }
    for (const node of bundle.nodes) db.prepare('UPDATE narrative_nodes SET parent_id=? WHERE id=?').run(node.parentExternalId ? nodeIds.get(node.parentExternalId)! : null, nodeIds.get(node.externalId)!);

    const sceneIds = new Map<string, string>();
    for (const scene of bundle.scenes) {
      const nodeId = nodeIds.get(scene.nodeExternalId)!;
      const row = db.prepare('SELECT id FROM narrative_scenes WHERE node_id=? AND external_id=?').get(nodeId, scene.externalId) as { id: string } | undefined;
      const id = row?.id ?? randomUUID(); sceneIds.set(scene.externalId, id);
      db.prepare(`INSERT INTO narrative_scenes VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(node_id,external_id) DO UPDATE SET
        title=excluded.title,sort_order=excluded.sort_order,summary=excluded.summary,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
        .run(id, nodeId, scene.externalId, scene.title?.trim() ?? '', scene.order, scene.summary?.trim() ?? '', json(scene.metadata), now);
    }
    for (const utterance of bundle.utterances) {
      const sceneId = sceneIds.get(utterance.sceneExternalId)!;
      const row = db.prepare('SELECT id FROM narrative_utterances WHERE scene_id=? AND external_id=?').get(sceneId, utterance.externalId) as { id: string } | undefined;
      db.prepare(`INSERT INTO narrative_utterances VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scene_id,external_id) DO UPDATE SET
        sort_order=excluded.sort_order,kind=excluded.kind,speaker=excluded.speaker,body=excluded.body,condition_text=excluded.condition_text,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
        .run(row?.id ?? randomUUID(), sceneId, utterance.externalId, utterance.order, utterance.kind ?? 'dialogue', utterance.speaker?.trim() || null, utterance.text.trim(), utterance.condition?.trim() || null, json(utterance.metadata), now);
    }
    for (const entity of bundle.entities ?? []) {
      const row = db.prepare('SELECT id FROM narrative_entities WHERE work_id=? AND external_id=?').get(workId, entity.externalId) as { id: string } | undefined;
      const id = row?.id ?? randomUUID();
      db.prepare(`INSERT INTO narrative_entities VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(work_id,external_id) DO UPDATE SET
        type=excluded.type,name=excluded.name,description=excluded.description,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
        .run(id, workId, entity.externalId, entity.type, entity.name.trim(), entity.description?.trim() ?? '', json(entity.metadata), now);
      db.prepare('DELETE FROM narrative_entity_aliases WHERE entity_id=?').run(id);
      for (const alias of new Set(entity.aliases?.map((item) => item.trim()).filter(Boolean) ?? [])) db.prepare('INSERT INTO narrative_entity_aliases VALUES (?,?)').run(id, alias);
    }
    db.prepare('DELETE FROM narrative_fts WHERE work_id=?').run(workId);
    db.prepare(`INSERT INTO narrative_fts(work_id,kind,ref_id,title,body)
      SELECT n.work_id,'utterance',u.id,COALESCE(u.speaker,''),u.body FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id WHERE n.work_id=?`).run(workId);
    db.prepare(`INSERT INTO narrative_fts(work_id,kind,ref_id,title,body) SELECT work_id,'entity',id,name,description FROM narrative_entities WHERE work_id=?`).run(workId);
    db.prepare(`INSERT INTO narrative_fts(work_id,kind,ref_id,title,body) SELECT work_id,'node',id,title,summary FROM narrative_nodes WHERE work_id=?`).run(workId);
    db.exec('COMMIT'); return { workId, releaseId };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function registerNarrativeRoutes(app: FastifyInstance, database: NarrativeDatabase, serviceDatabase: ServiceDatabase, narrativeConnectors: readonly NarrativeSourceConnector[]) {
  const akasha = narrativeConnectors.find((item): item is AkashaMcpConnector => item instanceof AkashaMcpConnector);
  app.get('/api/v1/admin/narrative/connectors', async () => ({ items: narrativeConnectors.map((connector) => ({ id: connector.id, name: connector.name, kind: connector.kind, ...connector.describe() })) }));
  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/connectors/:id/probe', async (request, reply) => {
    const connector = narrativeConnectors.find((item) => item.id === request.params.id);
    return connector ? { id: connector.id, ...await connector.probe() } : reply.code(404).send({ error: 'connector_not_found' });
  });
  app.post<{ Body: unknown }>('/api/v1/admin/narrative/imports/preview', async (request, reply) => {
    const validation = validateBundle(request.body);
    if (!validation.bundle) return reply.code(400).send({ error: 'invalid_bundle', details: validation.errors });
    return reply.code(201).send(stageBundle(database, validation.bundle));
  });
  app.post<{ Body: { world?: AkashaWorld; keyword?: string; maxResults?: number } }>('/api/v1/admin/narrative/connectors/akasha-mcp/search', async (request, reply) => {
    const { world, keyword, maxResults } = request.body ?? {};
    if (!akasha) return reply.code(503).send({ error: 'akasha_not_configured' });
    if (!['gi', 'hsr', 'bh3'].includes(world ?? '') || !keyword?.trim()) return reply.code(400).send({ error: 'invalid_search' });
    try { return { items: await akasha.search(world!, keyword.trim(), maxResults ?? 10) }; }
    catch (error) { return reply.code(502).send({ error: 'mcp_search_failed', message: String(error) }); }
  });
  app.post<{ Body: { world?: AkashaWorld; pathHash?: string; offset?: number; limit?: number } }>('/api/v1/admin/narrative/connectors/akasha-mcp/read', async (request, reply) => {
    const { world, pathHash, offset, limit } = request.body ?? {};
    if (!akasha) return reply.code(503).send({ error: 'akasha_not_configured' });
    if (!['gi', 'hsr', 'bh3'].includes(world ?? '') || !pathHash?.match(/^doc_[a-z0-9]+$/i)) return reply.code(400).send({ error: 'invalid_read' });
    try { return await akasha.read(world!, pathHash, offset, limit); }
    catch (error) { return reply.code(502).send({ error: 'mcp_read_failed', message: String(error) }); }
  });
  app.post<{ Body: { world?: AkashaWorld; pathHash?: string; title?: string } }>('/api/v1/admin/narrative/connectors/akasha-mcp/imports/preview', async (request, reply) => {
    const { world, pathHash, title } = request.body ?? {};
    if (!akasha) return reply.code(503).send({ error: 'akasha_not_configured' });
    if (!['gi', 'hsr', 'bh3'].includes(world ?? '') || !pathHash?.match(/^doc_[a-z0-9]+$/i)) return reply.code(400).send({ error: 'invalid_import' });
    try {
      const document = await akasha.readAll(world!, pathHash); const bundle = await akasha.normalize({ world, document, title });
      const validation = validateBundle(bundle); if (!validation.bundle) return reply.code(502).send({ error: 'mcp_normalize_failed', details: validation.errors });
      return reply.code(201).send(stageBundle(database, validation.bundle));
    } catch (error) { return reply.code(502).send({ error: 'mcp_import_failed', message: String(error) }); }
  });
  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/imports/:id/commit', async (request, reply) => {
    const row = database.connection.prepare("SELECT bundle_json,status FROM narrative_import_batches WHERE id=?").get(request.params.id) as { bundle_json: string; status: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.status !== 'preview') return reply.code(409).send({ error: 'batch_not_pending' });
    try {
      const result = commitBundle(database, JSON.parse(row.bundle_json) as NarrativeImportBundle);
      database.connection.prepare("UPDATE narrative_import_batches SET status='committed',committed_at=? WHERE id=?").run(nowIso(), request.params.id);
      return { id: request.params.id, status: 'committed', ...result };
    } catch (error) {
      database.connection.prepare("UPDATE narrative_import_batches SET status='failed',report_json=? WHERE id=?").run(JSON.stringify({ error: String(error) }), request.params.id);
      throw error;
    }
  });
  app.delete<{ Params: { id: string } }>('/api/v1/admin/narrative/imports/:id', async (request, reply) => {
    const result = database.connection.prepare("UPDATE narrative_import_batches SET status='cancelled' WHERE id=? AND status='preview'").run(request.params.id);
    return result.changes ? { ok: true } : reply.code(409).send({ error: 'batch_not_pending' });
  });
  app.get('/api/v1/admin/narrative/works', async () => ({ items: database.connection.prepare(`SELECT w.id,w.title,w.description,w.locale,w.updated_at updatedAt,s.name sourceName,
    (SELECT COUNT(*) FROM narrative_nodes n WHERE n.work_id=w.id) nodeCount FROM narrative_works w JOIN narrative_sources s ON s.id=w.source_id ORDER BY w.updated_at DESC`).all() }));
  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/works/:id/tree', async (request) => ({ items: database.connection.prepare(`SELECT id,parent_id parentId,kind,title,sort_order sortOrder,summary FROM narrative_nodes WHERE work_id=? ORDER BY sort_order,title`).all(request.params.id) }));
  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/nodes/:id/read', async (request, reply) => {
    const node = database.connection.prepare('SELECT id,work_id workId,title,summary FROM narrative_nodes WHERE id=?').get(request.params.id);
    if (!node) return reply.code(404).send({ error: 'not_found' });
    const scenes = database.connection.prepare('SELECT id,title,summary,sort_order sortOrder FROM narrative_scenes WHERE node_id=? ORDER BY sort_order,id').all(request.params.id) as Array<Record<string, unknown>>;
    const utteranceQuery = database.connection.prepare('SELECT id,kind,speaker,body text,condition_text condition,sort_order sortOrder FROM narrative_utterances WHERE scene_id=? ORDER BY sort_order,id');
    return { node, scenes: scenes.map((scene) => ({ ...scene, utterances: utteranceQuery.all(scene.id as string) })) };
  });
  app.get<{ Params: { id: string } }>('/api/v1/admin/narrative/works/:id/entities', async (request) => ({ items: database.connection.prepare(`SELECT e.id,e.type,e.name,e.description,group_concat(a.alias,'|') aliases FROM narrative_entities e LEFT JOIN narrative_entity_aliases a ON a.entity_id=e.id WHERE e.work_id=? GROUP BY e.id ORDER BY e.type,e.name`).all(request.params.id) }));
  app.get<{ Querystring: { q?: string; workId?: string } }>('/api/v1/admin/narrative/search', async (request, reply) => {
    const q = request.query.q?.trim(); if (!q) return { items: [] };
    if (Array.from(q).length < 3) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`; const workId = request.query.workId ?? null;
      return { items: database.connection.prepare(`SELECT * FROM (
        SELECT n.work_id workId,'utterance' kind,u.id refId,n.id nodeId,COALESCE(u.speaker,'') title,u.body excerpt FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id WHERE u.body LIKE ? ESCAPE '\\'
        UNION ALL SELECT e.work_id,'entity',e.id,NULL,e.name,e.description FROM narrative_entities e WHERE e.name LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\'
        UNION ALL SELECT n.work_id,'node',n.id,n.id,n.title,n.summary FROM narrative_nodes n WHERE n.title LIKE ? ESCAPE '\\' OR n.summary LIKE ? ESCAPE '\\'
      ) WHERE (? IS NULL OR workId=?) LIMIT 100`).all(like, like, like, like, like, workId, workId) };
    }
    const match = q.split(/\s+/).map((word) => `"${word.replaceAll('"', '""')}"*`).join(' AND ');
    try { return { items: database.connection.prepare(`SELECT narrative_fts.work_id workId,narrative_fts.kind,narrative_fts.ref_id refId,
        CASE narrative_fts.kind WHEN 'node' THEN narrative_fts.ref_id WHEN 'utterance' THEN s.node_id ELSE NULL END nodeId,
        narrative_fts.title,snippet(narrative_fts,4,'<mark>','</mark>','…',24) excerpt
        FROM narrative_fts
        LEFT JOIN narrative_utterances u ON narrative_fts.kind='utterance' AND narrative_fts.ref_id=u.id
        LEFT JOIN narrative_scenes s ON u.scene_id=s.id
        WHERE narrative_fts MATCH ? AND (? IS NULL OR narrative_fts.work_id=?) LIMIT 100`).all(match, request.query.workId ?? null, request.query.workId ?? null) }; }
    catch { return reply.code(400).send({ error: 'invalid_search' }); }
  });
  app.get<{ Querystring: { workId?: string; status?: string } }>('/api/v1/admin/narrative/claims', async (request) => ({ items: database.connection.prepare(`SELECT id,work_id workId,type,body,status,origin,created_at createdAt FROM narrative_claims WHERE (? IS NULL OR work_id=?) AND (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT 300`).all(request.query.workId ?? null, request.query.workId ?? null, request.query.status ?? null, request.query.status ?? null) }));
  app.post<{ Params: { id: string } }>('/api/v1/admin/narrative/utterances/:id/to-note', async (request, reply) => {
    const row = database.connection.prepare(`SELECT u.id,u.body,u.speaker,s.title scene,n.title node,w.id work_id,w.title work_title
      FROM narrative_utterances u JOIN narrative_scenes s ON s.id=u.scene_id JOIN narrative_nodes n ON n.id=s.node_id JOIN narrative_works w ON w.id=n.work_id WHERE u.id=?`).get(request.params.id) as { id: string; body: string; speaker: string | null; scene: string; node: string; work_id: string; work_title: string } | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const id = randomUUID(); const now = nowIso(); const locator = `${row.work_title} / ${row.node}${row.scene ? ` / ${row.scene}` : ''}`;
    const content = [{ id: randomUUID(), type: 'archive-reference', workId: row.work_id, targetType: 'utterance', targetId: row.id, quote: `${row.speaker ? `${row.speaker}：` : ''}${row.body}`, locator }];
    serviceDatabase.connection.prepare('INSERT INTO creative_notes VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, `摘录：${row.node}`, 'story', row.body.slice(0, 180), JSON.stringify(content), JSON.stringify(['叙事档案', row.work_title]), 'story-candidate', 0, now, now);
    return reply.code(201).send({ id, href: `/apps/notebook/${id}` });
  });
  app.put<{ Params: { id: string }; Body: { status?: string; body?: string } }>('/api/v1/admin/narrative/claims/:id', async (request, reply) => {
    if (!['pending', 'accepted', 'rejected'].includes(request.body?.status ?? '')) return reply.code(400).send({ error: 'invalid_status' });
    const result = database.connection.prepare('UPDATE narrative_claims SET status=?,body=COALESCE(?,body),updated_at=? WHERE id=?').run(request.body.status!, request.body.body?.trim() || null, nowIso(), request.params.id);
    return result.changes ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });
}
