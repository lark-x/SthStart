import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ResearchCharacterCandidate, ResearchLocationCandidate } from '@sthstart/contracts';
import { authenticateAdmin } from '../access.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { ResearchStore } from './research-store.js';
import { runResearch, type ResearchServiceOptions } from './research.js';
import { ActivityPlanningStore } from '../activities/planning.js';

function checkAdmin(config: ServiceConfig, request: FastifyRequest, reply: FastifyReply): boolean {
  if (config.adminToken && !authenticateAdmin(config.adminToken, request)) {
    reply.code(401).send({ error: 'unauthorized', message: '未授权的管理请求。' });
    return false;
  }
  return true;
}

function errorResponse(reply: FastifyReply, error: unknown) {
  const status = (error as { statusCode?: number }).statusCode || 400;
  const code = (error as { code?: string }).code || 'research_failed';
  return reply.code(status).send({ error: code, message: (error as Error).message });
}

/** 研究输入以企划会话已保存的表单为基准：body 只作为覆盖，不丢用户已填内容。 */
function sessionLeadName(database: ServiceDatabase, session: { document: { actors: Array<{ id: string; displayName: string; sourceCharacterId?: string }> } }, leadCharacterId?: string) {
  if (!leadCharacterId) return '';
  const row = database.connection.prepare('SELECT display_name FROM character_profiles WHERE id=?').get(leadCharacterId) as { display_name?: string } | undefined;
  if (row?.display_name) return String(row.display_name);
  return session.document.actors.find((actor) => actor.sourceCharacterId === leadCharacterId)?.displayName ?? '';
}

export function registerResearchRoutes(app: FastifyInstance, options: ResearchServiceOptions) {
  const { database, config } = options;
  const research = new ResearchStore(database);
  research.recoverDanglingTasks();

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/v1/admin/activity-planning-sessions/:id/research', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const sessionId = request.params.id;
    const session = new ActivityPlanningStore(database).getSession(sessionId);
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    if (session.status === 'created') return reply.code(409).send({ error: 'session_created', message: '该企划已创建活动，不能再发起研究。' });
    const body = request.body ?? {};
    const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
    if (!sourceIds.length) return reply.code(400).send({ error: 'source_ids_required', message: '请至少选择一个资料源。' });
    // 表单里已填的主角、联动范围、人数与剧情范围会冻结进研究修订，避免只靠请求体兜底。
    const form = session.form;
    const bodyWorks = Array.isArray(body.crossoverWorks) ? body.crossoverWorks.filter((item): item is string => typeof item === 'string') : [];
    const input = {
      leadCharacterId: form.leadCharacterId || form.characters[0]?.characterId,
      leadCharacter: String(body.leadCharacter ?? '').trim() || sessionLeadName(database, session, form.leadCharacterId) || session.document.actors[0]?.displayName || '',
      leadWork: String(body.leadWork ?? '').trim() || String(JSON.parse(String(database.connection.prepare('SELECT draft_json FROM character_profiles WHERE id=?').get(form.leadCharacterId || form.characters[0]?.characterId || '')?.draft_json || '{}')).work || ''),
      activityType: String(body.activityType ?? '').trim() || session.form.type,
      userRequest: String(body.userRequest ?? '').trim() || form.instruction || '',
      crossoverWorks: bodyWorks.length ? bodyWorks : (form.crossoverWorks ?? []),
      unrestrictedWorks: form.unrestrictedWorks === true,
      guestCountPreference: typeof body.guestCountPreference === 'number' ? body.guestCountPreference : form.guestCountPreference,
      storyScopeNote: typeof body.storyScopeNote === 'string' ? body.storyScopeNote : form.storyScopeNote,
      sourceIds,
    };
    try {
      const task = await runResearch(options, sessionId, input);
      return reply.code(202).send(task);
    } catch (error) { return errorResponse(reply, error); }
  });

  app.get<{ Params: { id: string } }>('/api/v1/admin/activity-planning-sessions/:id/research', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    return { items: research.listTasks(request.params.id) };
  });

  app.get<{ Params: { id: string; taskId: string } }>('/api/v1/admin/activity-planning-sessions/:id/research/:taskId', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const task = research.getTask(request.params.taskId);
    if (!task || task.sessionId !== request.params.id) return reply.code(404).send({ error: 'research_task_not_found' });
    return task;
  });

  app.post<{ Params: { id: string; taskId: string } }>('/api/v1/admin/activity-planning-sessions/:id/research/:taskId/cancel', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const task = research.getTask(request.params.taskId);
    if (!task || task.sessionId !== request.params.id) return reply.code(404).send({ error: 'research_task_not_found' });
    if (task.status === 'queued' || task.status === 'running') {
      research.updateTask(task.id, { status: 'cancelled', progressLabel: '用户取消' });
    }
    return research.getTask(task.id);
  });

  app.put<{ Params: { id: string; taskId: string }; Body: {
    characters?: Array<{ id: string; status: 'required' | 'optional' | 'excluded' }>;
    locations?: Array<{ id: string; status: 'required' | 'optional' | 'excluded'; locked?: boolean }>;
    addLocations?: Array<{ id: string; name: string; note?: string; status?: 'required' | 'optional' | 'excluded'; locked?: boolean }>;
  } }>('/api/v1/admin/activity-planning-sessions/:id/research/:taskId/selection', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const task = research.getTask(request.params.taskId);
    if (!task || task.sessionId !== request.params.id) return reply.code(404).send({ error: 'research_task_not_found' });
    if (!['succeeded', 'incomplete'].includes(task.status)) return reply.code(409).send({ error: 'research_not_ready', message: '请等待研究完成后保存选择。' });
    // 用户自填地点：客户端生成稳定 id，重复提交不会产生重复条目。
    const existingLocationIds = new Set(task.locationCandidates.map((item) => item.id));
    const additions: ResearchLocationCandidate[] = [];
    for (const item of request.body?.addLocations ?? []) {
      const id = String(item?.id ?? '');
      const name = String(item?.name ?? '').trim();
      if (!/^user_loc_[a-zA-Z0-9-]{1,64}$/.test(id)) continue;
      if (!name || name.length > 60) continue;
      if (existingLocationIds.has(id)) continue;
      if (additions.some((entry) => entry.name === name)) continue;
      if (additions.length >= 5) break;
      existingLocationIds.add(id);
      additions.push({
        id,
        name,
        work: '',
        environment: '',
        reasonForActivity: String(item?.note ?? '').trim().slice(0, 300) || '由用户自行指定的活动地点。',
        originalBasis: '',
        activityArrangement: '',
        basis: 'creative',
        evidenceIds: [],
        userStatus: item?.status === 'required' ? 'required' : item?.status === 'excluded' ? 'excluded' : 'optional',
        userProvided: true,
        locked: Boolean(item?.locked),
      });
    }
    const incoming = [...task.locationCandidates, ...additions];
    const characterStatus = new Map((request.body?.characters ?? []).map((item) => [item.id, item.status]));
    const locationStatus = new Map((request.body?.locations ?? []).map((item) => [item.id, item.status]));
    const locationLock = new Map((request.body?.locations ?? []).map((item) => [item.id, Boolean(item.locked)]));
    const characters: ResearchCharacterCandidate[] = task.characterCandidates.map((item) => ({
      ...item,
      userStatus: characterStatus.get(item.id) ?? item.userStatus,
    }));
    const locations: ResearchLocationCandidate[] = incoming.map((item) => ({
      ...item,
      userStatus: locationStatus.get(item.id) ?? item.userStatus,
      locked: (locationStatus.get(item.id) ?? item.userStatus) === 'excluded' ? false : locationLock.get(item.id) ?? item.locked ?? false,
    }))
      // 锁定的主要地点最多一个，避免前端误传导致多主地点。
      .reduce<ResearchLocationCandidate[]>((list, item) => {
        if (item.locked && list.some((entry) => entry.locked)) return [...list, { ...item, locked: false }];
        return [...list, item];
      }, []);
    research.updateTask(task.id, { characterCandidates: characters, locationCandidates: locations });
    const saved = research.getTask(task.id)!;
    const selection = research.buildSelectionFromTask(saved);
    research.writeSelection(request.params.id, selection);
    const revisionId = research.createRevision({ sessionId: task.sessionId, taskId: task.id, version: 1, inputSnapshot: task.inputSnapshot });
    research.setSessionResearchRevision(task.sessionId, revisionId);
    return { task: saved, selection };
  });

  app.get<{ Params: { id: string; revisionId: string } }>('/api/v1/admin/activity-planning-sessions/:id/research-revisions/:revisionId', async (request, reply) => {
    if (!checkAdmin(config, request, reply)) return;
    const revision = research.getRevision(request.params.revisionId);
    if (!revision || revision.sessionId !== request.params.id) return reply.code(404).send({ error: 'research_revision_not_found' });
    return revision;
  });
}
