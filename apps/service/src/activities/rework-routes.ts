import type { FastifyInstance } from 'fastify';
import { normalizeCreationProfile } from '@sthstart/contracts';
import { getImageConfigDraft, saveImageConfigDraft, commitImageConfigRevision } from './image-configs.js';
import type { ContentDocument, ActivityReviewItem } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { authenticateAdmin } from '../access.js';
import { getActivityPreset } from './presets.js';
import { ActivityStore } from './store.js';
import { analyzeActivityChanges, valueHash, recordPlaybackImpact } from './change-impact.js';
import { listReviewItems, decideReviewItems, startReviewItems } from './review-items.js';
import { compareCandidate, applyCandidateSelection } from './candidate-review.js';
export function registerReworkRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, secrets: SecretStore, fetcher?: typeof fetch) {
    const store = new ActivityStore(database);
    app.register(async (router) => {
        router.addHook('preHandler', async (request, reply) => { if (config.adminToken && !authenticateAdmin(config.adminToken, request))
            return reply.code(401).send({ error: 'unauthorized' }); });
        router.setErrorHandler((error, request, reply) => { const e = error as Error & {
            statusCode?: number;
            code?: string;
        }; reply.code(e.statusCode || 400).send({ error: e.code || 'rework_failed', message: e.message }); });
        router.get('/api/v1/admin/activity-creation-profile/default', async () => {
            const row = database.connection.prepare("SELECT value_json FROM runtime_settings WHERE key='activities.creation_profile_default'").get() as {
                value_json: string;
            } | undefined;
            const id = row ? JSON.parse(row.value_json) : null;
            return { id: typeof id === 'string' && getActivityPreset(database, id)?.kind === 'creation_profile' ? id : null };
        });
        router.post<{
            Body: {
                id: string | null;
            };
        }>('/api/v1/admin/activity-creation-profile/default', async (request) => {
            const id = request.body.id;
            if (id !== null && getActivityPreset(database, id)?.kind !== 'creation_profile')
                throw new Error('创作配置不存在');
            database.connection.prepare("INSERT INTO runtime_settings(key,value_json,updated_at) VALUES('activities.creation_profile_default',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(id), new Date().toISOString());
            return { id };
        });
        router.post<{
            Params: {
                id: string;
            };
            Body: {
                presetId: string | null;
                presetVersion: number;
                expectedHeadVersion: number;
                expectedDraftVersion: number;
            };
        }>('/api/v1/admin/activities/:id/creation-profile/apply', async (request) => {
            const id = request.params.id;
            const preset = request.body.presetId ? getActivityPreset(database, request.body.presetId) : null;
            const activity = store.getActivity(id);
            const draft = store.getDraft(id);
            if (!activity || !draft || (request.body.presetId && preset?.kind !== 'creation_profile'))
                throw new Error('活动或创作配置不存在');
            if ((preset && preset.version !== request.body.presetVersion) || activity.headVersion !== request.body.expectedHeadVersion || draft.draftVersion !== request.body.expectedDraftVersion)
                throw Object.assign(new Error('活动或配置版本已变化，请重新查看套用预览'), { statusCode: 409 });
            if (valueHash(draft.document) !== valueHash(store.getContentRevision(id, activity.currentContentRevisionId!)?.document))
                throw new Error('请先保存活动新版本，再套用创作配置');
            const values = normalizeCreationProfile(preset?.payload || {});
            return database.transaction(() => {
                const next = structuredClone(draft.document);
                if (preset)
                    next.activity.creationProfile = { presetId: preset.id, name: preset.name, version: preset.version, values };
                else
                    delete next.activity.creationProfile;
                const saved = store.updateDraft(id, draft.draftVersion, next);
                const committed = store.commitDraft(id, activity.headVersion, saved.draftVersion, { skipTransaction: true });
                const configDraft = getImageConfigDraft(database, id);
                const savedConfig = saveImageConfigDraft(database, id, configDraft.draftVersion, { ...configDraft.document, globalStylePrompt: values.globalStylePrompt, globalNegativePrompt: values.globalNegativePrompt });
                const config = commitImageConfigRevision(database, store, id, savedConfig.draftVersion, committed.activity.headVersion, { skipTransaction: true });
                if (activity.currentPlaybackRevisionId)
                    recordPlaybackImpact(database.connection, id, '已套用新的创作配置，请确认回放编排', config.revision.id);
                return { activity: config.activity };
            });
        });
        router.get<{
            Params: {
                id: string;
            };
        }>('/api/v1/admin/activities/:id/review-items', async (request) => ({ items: listReviewItems(database, store, request.params.id) }));
        router.post<{
            Params: {
                id: string;
            };
            Body: {
                document: ContentDocument;
            };
        }>('/api/v1/admin/activities/:id/change-impact/preview', async (request) => {
            const activity = store.getActivity(request.params.id);
            const before = activity?.currentContentRevisionId ? store.getContentRevision(activity.id, activity.currentContentRevisionId)?.document : null;
            if (!before || !request.body.document?.actors)
                throw new Error('活动或文档不存在');
            return { items: analyzeActivityChanges(activity!.id, before, request.body.document) };
        });
        router.post<{
            Params: {
                id: string;
            };
            Body: {
                items: Array<{
                    id: string;
                    changeKey: string;
                }>;
                decision: ActivityReviewItem['decision'];
                expectedHeadVersion: number;
            };
        }>('/api/v1/admin/activities/:id/review-items/decide', async (request) => decideReviewItems(database, store, request.params.id, request.body));
        router.post<{
            Params: {
                id: string;
            };
            Body: {
                ids: string[];
            };
        }>('/api/v1/admin/activities/:id/review-items/start', async (request) => startReviewItems(database, secrets, store, request.params.id, request.body, fetcher));
        router.get<{
            Params: {
                id: string;
                candidateId: string;
            };
        }>('/api/v1/admin/activities/:id/candidates/:candidateId/comparison', async (request) => compareCandidate(database, store, request.params.id, request.params.candidateId));
        router.post<{
            Params: {
                id: string;
                candidateId: string;
            };
            Body: {
                unitIds: string[];
                expectedHeadVersion: number;
                expectedDraftVersion: number;
                idempotencyKey: string;
            };
        }>('/api/v1/admin/activities/:id/candidates/:candidateId/apply-selection', async (request) => applyCandidateSelection(database, store, request.params.id, request.params.candidateId, request.body));
        router.post<{
            Params: {
                id: string;
                candidateId: string;
            };
            Body: {
                dismissed: boolean;
            };
        }>('/api/v1/admin/activities/:id/candidates/:candidateId/dismiss', async (request) => {
            const candidate = store.getCandidate(request.params.id, request.params.candidateId);
            if (!candidate)
                throw new Error('候选不存在');
            database.connection.prepare('UPDATE activity_candidates SET scope_json=? WHERE activity_id=? AND id=?').run(JSON.stringify({ ...candidate.scope, dismissed: request.body.dismissed === true }), request.params.id, candidate.id);
            return { ok: true };
        });
    });
}
