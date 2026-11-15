import type { WorldDefinition } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import type { ServiceConfig } from '../config.js';
import type { SecretStore } from '../security.js';
import { resolveEffectiveModelProfile } from '../providers.js';
import { executeTextLlm } from '../llm/common-llm.js';

export type WorldModelPurpose = keyof WorldDefinition['models'];
export interface WorldModelRequest {
  callId: string; runId: string; stepId: string; worldId: string; branchId: string;
  stage: string; purpose: WorldModelPurpose; profileId: string | null;
  system: string; input: unknown; correction?: { previous: string; issues: string };
}
export interface WorldModelResult { text: string; aiCallId?: string }
export type WorldCallResolution = { status: 'succeeded'; text: string; aiCallId?: string }
  | { status: 'failed'; error: string } | { status: 'unknown' };
/** Test adapters are explicitly injected; the default always uses the public model service. */
export interface WorldModelAdapter {
  prepare?(request: WorldModelRequest): Promise<{ profileId: string }>;
  execute(request: WorldModelRequest): Promise<string | WorldModelResult>;
  reconcile?(request: WorldModelRequest): Promise<WorldCallResolution>;
}
export class PublicWorldModelAdapter implements WorldModelAdapter {
  constructor(private readonly options: { database: ServiceDatabase; config: ServiceConfig; secrets: SecretStore; fetcher?: typeof fetch }) {}
  async prepare(request: WorldModelRequest) {
    const app = this.options.database.connection.prepare('SELECT enabled FROM managed_apps WHERE id=?').get('story-worlds') as { enabled: number } | undefined;
    if (app && !app.enabled) throw new Error('story_worlds_app_disabled: 故事世界应用已停用。');
    const profile = await resolveEffectiveModelProfile(this.options.database, this.options.secrets,
      'story-worlds', request.purpose, request.profileId ?? undefined);
    if (!profile?.model?.trim()) throw Object.assign(new Error(`story_model_unavailable: 请为故事世界的 ${request.purpose} 用途配置文本模型。`), { statusCode: 409 });
    const capabilities = this.options.database.connection.prepare('SELECT capabilities_json FROM model_profiles WHERE id=?').get(profile.id)
      ?? this.options.database.connection.prepare('SELECT capabilities_json FROM provider_profile_options WHERE profile_id=?').get(profile.id);
    const supported: unknown = JSON.parse(String(capabilities?.capabilities_json ?? '["text"]'));
    if (!Array.isArray(supported) || !supported.includes('text')) throw new Error('story_model_capability_mismatch: 所选模型不支持文本。');
    const url = new URL(profile.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('story_model_url_invalid');
    return { profileId: profile.id };
  }
  async execute(request: WorldModelRequest): Promise<WorldModelResult> {
    // Resolve configuration again immediately before dispatch. Removed/disabled
    // profiles do not consume an upstream request; runtime will reconcile this.
    let profile: Awaited<ReturnType<typeof resolveEffectiveModelProfile>>;
    try {
      await this.prepare(request);
      profile = await resolveEffectiveModelProfile(this.options.database, this.options.secrets,
        'story-worlds', request.purpose, request.profileId ?? undefined);
    } catch {
      throw Object.assign(new Error('story_model_not_dispatched'), { worldCallNotDispatched: true });
    }
    if (!profile?.model) throw Object.assign(new Error('story_model_not_dispatched'), { worldCallNotDispatched: true });
    let aiCallId: string | undefined;
    const text = await executeTextLlm({ profile, fetchFn: this.options.fetcher, jsonMode: true,
      systemPrompt: request.system, prompt: JSON.stringify({ input: request.input, correction: request.correction }),
      audit: { database: this.options.database, applicationId: 'story-worlds', feature: request.purpose,
        businessEvent: `story-worlds.${request.stage}`, objectType: 'world-run', objectId: request.runId,
        traceId: request.callId, parameters: { stepId: request.stepId, branchId: request.branchId } },
      onResult: (result) => { aiCallId = result.aiCallId; },
    });
    return { text, aiCallId };
  }
  async reconcile(request: WorldModelRequest): Promise<WorldCallResolution> {
    // A chat completion has no portable provider task lookup. Its durable audit is
    // the only safe positive evidence; a transport failure is NOT proof of failure.
    const row = this.options.database.connection.prepare(
      'SELECT id,status,response_text,error_message,error_code FROM ai_call_records WHERE trace_id=? ORDER BY requested_at DESC,rowid DESC LIMIT 1',
    ).get(request.callId) as { id: string; status: string; response_text: string | null; error_message: string | null; error_code: string | null } | undefined;
    if (row?.status === 'succeeded' && row.response_text) return { status: 'succeeded', text: row.response_text, aiCallId: row.id };
    // 408 is explicitly a timeout; 409/425 may describe an already-running
    // request. These cannot prove that the provider performed no work.
    if (row && (row.status === 'not_dispatched' || (row.status === 'failed' && /^http_4\d\d$/.test(row.error_code ?? '')
      && !['http_408', 'http_409', 'http_425'].includes(row.error_code ?? '')))) {
      return { status: 'failed', error: row.error_message ?? '模型调用被明确拒绝。' };
    }
    return { status: 'unknown' };
  }
}
