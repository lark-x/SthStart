import type { LlmBindingStatus, LlmModelRole } from '@sthstart/contracts';
import type { ServiceDatabase } from './database.js';
import type { SecretStore } from './security.js';

/**
 * 应用模型绑定的统一状态判定：模型实际调用与配置状态查询共享同一套规则，
 * 避免出现「列表显示已就绪、调用却报未配置」这类互相矛盾的提示。
 * 判定只读数据库结构配置，不对上游发起联网探测。
 */

export const LLM_STATUS_MESSAGES: Record<LlmBindingStatus['status'], string> = {
  ready: '模型配置就绪。',
  app_disabled: '所属应用已被停用，请先在公共服务中启用该应用。',
  unassigned: '尚未绑定文本模型。',
  profile_missing: '绑定的模型配置已被删除，请重新选择模型。',
  profile_disabled: '绑定的模型已被停用，请启用该模型或重新选择。',
  capability_mismatch: '所选模型不支持当前角色（文本/图文），请更换模型或修正能力标签。',
  model_missing: '所选模型没有填写模型 ID，请编辑模型模板补充。',
};

/** 配置入口：门户公共服务页的应用路由分类，带 app 深链接。 */
export function llmConfigurationPath(appId: string) {
  return `/settings/public-services?section=routing&app=${encodeURIComponent(appId)}`;
}

function configurationMessage(status: LlmBindingStatus['status'], appId: string, appName: string, role: LlmModelRole) {
  const roleLabel = role === 'text' ? '文本' : '多模态';
  switch (status) {
    case 'ready': return null;
    case 'unassigned': return `${appName} 尚未选择${roleLabel}模型。`;
    case 'profile_missing': return `${appName} 绑定的${roleLabel}模型不存在（可能已被删除）。`;
    case 'profile_disabled': return `${appName} 绑定的${roleLabel}模型已停用。`;
    case 'capability_mismatch': return `${appName} 绑定的${roleLabel}模型不支持${roleLabel}调用。`;
    case 'model_missing': return `${appName} 绑定的${roleLabel}模型缺少模型 ID。`;
    case 'app_disabled': return `${appName} 应用已停用，无法调用模型。`;
  }
}

interface BindingRow {
  app_enabled: number;
  app_name: string;
  profile_id: string | null;
  profile_name: string | null;
  profile_model: string | null;
  profile_enabled: number | null;
  credential_account: string | null;
  capabilities_json: string | null;
}

function bindingRow(database: ServiceDatabase, appId: string, role: LlmModelRole): BindingRow | null {
  const app = database.connection.prepare('SELECT id,name,enabled FROM managed_apps WHERE id=?').get(appId) as { id: string; name: string; enabled: number } | undefined;
  if (!app) return null;
  const row = database.connection.prepare(
    `SELECT a.profile_id, p.name AS profile_name, p.model AS profile_model, p.enabled AS profile_enabled,
            p.credential_account, o.capabilities_json
     FROM app_llm_assignments a
     LEFT JOIN provider_profiles p ON p.id = a.profile_id AND p.kind = 'llm'
     LEFT JOIN provider_profile_options o ON o.profile_id = p.id
     WHERE a.app_id = ? AND a.role = ?`,
  ).get(appId, role) as Omit<BindingRow, 'app_enabled' | 'app_name'> | undefined;
  return {
    app_enabled: app.enabled,
    app_name: app.name,
    profile_id: row?.profile_id ?? null,
    profile_name: row?.profile_name ?? null,
    profile_model: row?.profile_model ?? null,
    profile_enabled: row?.profile_enabled ?? null,
    credential_account: row?.credential_account ?? null,
    capabilities_json: row?.capabilities_json ?? null,
  };
}

function credentialEnvName(profileId: string) {
  return `STHSTART_SECRET_${profileId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

async function credentialSource(secrets: SecretStore, row: BindingRow): Promise<LlmBindingStatus['credentialSource']> {
  if (!row.credential_account || !row.profile_id) return 'none';
  const credential = await secrets.get(row.credential_account, credentialEnvName(row.profile_id));
  return credential.source;
}

/** 结构配置判定：应用启用 → 绑定存在 → profile 存在且为 LLM → profile 启用 → 能力包含角色 → 模型 ID 非空。 */
export async function resolveAppLlmBindingStatus(
  database: ServiceDatabase,
  secrets: SecretStore,
  appId: string,
  role: LlmModelRole,
): Promise<LlmBindingStatus> {
  const row = bindingRow(database, appId, role);
  if (!row) {
    return {
      appId, role, status: 'profile_missing', ready: false, profile: null, credentialSource: 'none',
      message: `应用 ${appId} 不存在。`, configurationPath: llmConfigurationPath(appId),
    };
  }
  const base = {
    appId,
    role,
    profile: row.profile_id ? { id: row.profile_id, name: row.profile_name ?? row.profile_id, model: row.profile_model } : null,
    configurationPath: llmConfigurationPath(appId),
  };
  if (!row.app_enabled) {
    return { ...base, status: 'app_disabled', ready: false, credentialSource: 'none', message: configurationMessage('app_disabled', appId, row.app_name, role) };
  }
  if (!row.profile_id) {
    return { ...base, status: 'unassigned', ready: false, credentialSource: 'none', message: configurationMessage('unassigned', appId, row.app_name, role) };
  }
  if (row.profile_enabled == null) {
    return { ...base, status: 'profile_missing', ready: false, credentialSource: await credentialSource(secrets, row), message: configurationMessage('profile_missing', appId, row.app_name, role) };
  }
  if (!row.profile_enabled) {
    return { ...base, status: 'profile_disabled', ready: false, credentialSource: await credentialSource(secrets, row), message: configurationMessage('profile_disabled', appId, row.app_name, role) };
  }
  let capabilities: string[] = [];
  // options 行缺失时与现有调用保持一致：LLM 模板默认具备文本能力。
  try { capabilities = JSON.parse(row.capabilities_json ?? '["text"]'); } catch { capabilities = ['text']; }
  if (!capabilities.includes(role)) {
    return { ...base, status: 'capability_mismatch', ready: false, credentialSource: await credentialSource(secrets, row), message: configurationMessage('capability_mismatch', appId, row.app_name, role) };
  }
  if (!row.profile_model) {
    return { ...base, status: 'model_missing', ready: false, credentialSource: await credentialSource(secrets, row), message: configurationMessage('model_missing', appId, row.app_name, role) };
  }
  return { ...base, status: 'ready', ready: true, credentialSource: await credentialSource(secrets, row), message: LLM_STATUS_MESSAGES.ready };
}

export interface CharacterLlmBindingStatus extends LlmBindingStatus {
  /** character 专属绑定失效时为 true：调用会失败，界面必须提示修复而不是静默改用其他模型。 */
  overridden: boolean;
}

/**
 * 角色专属绑定优先：有专属绑定就使用专属绑定，失效时显示错误状态，不静默回退到角色库应用配置。
 */
export async function resolveCharacterLlmBindingStatus(
  database: ServiceDatabase,
  secrets: SecretStore,
  characterId: string,
  role: LlmModelRole,
): Promise<CharacterLlmBindingStatus> {
  const specific = database.connection.prepare(
    `SELECT a.profile_id, p.name AS profile_name, p.model AS profile_model, p.enabled AS profile_enabled,
            p.credential_account, o.capabilities_json
     FROM character_model_assignments a
     LEFT JOIN provider_profiles p ON p.id = a.profile_id AND p.kind = 'llm'
     LEFT JOIN provider_profile_options o ON o.profile_id = p.id
     WHERE a.character_id = ? AND a.role = ?`,
  ).get(characterId, role) as { profile_id: string; profile_name: string | null; profile_model: string | null; profile_enabled: number | null; credential_account: string | null; capabilities_json: string | null } | undefined;

  if (specific) {
    const appStatus = await resolveAppLlmBindingStatus(database, secrets, 'characters', role);
    const credential = specific.credential_account
      ? await secrets.get(specific.credential_account, credentialEnvName(specific.profile_id))
      : { source: 'none' as const };
    const base = {
      appId: 'characters',
      role,
      profile: { id: specific.profile_id, name: specific.profile_name ?? specific.profile_id, model: specific.profile_model },
      credentialSource: credential.source,
      configurationPath: llmConfigurationPath('characters'),
      overridden: true,
    };
    if (specific.profile_enabled == null) {
      return { ...base, status: 'profile_missing', ready: false, message: `该角色绑定的专属${role === 'text' ? '文本' : '多模态'}模型不存在，请重新选择。` };
    }
    if (!specific.profile_enabled) {
      return { ...base, status: 'profile_disabled', ready: false, message: `该角色绑定的专属${role === 'text' ? '文本' : '多模态'}模型已停用。` };
    }
    let capabilities: string[] = [];
    try { capabilities = JSON.parse(specific.capabilities_json ?? '[]'); } catch { capabilities = []; }
    if (!capabilities.includes(role)) {
      return { ...base, status: 'capability_mismatch', ready: false, message: `该角色绑定的专属模型不支持${role === 'text' ? '文本' : '多模态'}调用。` };
    }
    if (!specific.profile_model) {
      return { ...base, status: 'model_missing', ready: false, message: `该角色绑定的专属模型缺少模型 ID。` };
    }
    return { ...base, status: 'ready', ready: true, message: LLM_STATUS_MESSAGES.ready };
  }

  const fallback = await resolveAppLlmBindingStatus(database, secrets, 'characters', role);
  return { ...fallback, overridden: false };
}

/** 面向用户的统一错误：不把所有失败折叠成「未配置模型」。 */
export function llmNotReadyError(status: LlmBindingStatus): Error & { statusCode: number; code: string; configurationPath: string } {
  const error = new Error([
    status.message || LLM_STATUS_MESSAGES[status.status],
    `请在「设置 → 公共服务 → 应用路由」为对应应用配置模型：${status.configurationPath}`,
  ].filter(Boolean).join(' ')) as Error & { statusCode: number; code: string; configurationPath: string };
  error.statusCode = 409;
  error.code = 'llm_not_ready';
  error.configurationPath = status.configurationPath;
  return error;
}

/** 提取结构化错误附加字段，便于路由在现有错误响应风格中返回配置路径。 */
export function errorConfigurationPath(error: unknown): string | undefined {
  const path = (error as { configurationPath?: unknown }).configurationPath;
  return typeof path === 'string' ? path : undefined;
}
