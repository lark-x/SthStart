import type {
  ActivityImagePromptKnowledgeMode,
  ActivityImagePromptOutputFormat,
  ActivityImagePromptPolicy,
  SaveActivityImagePromptPolicyRequest,
} from '@sthstart/contracts';
import { DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { parseEditorConfig } from '../generation/configuration.js';

type PolicyRow = {
  workflow_id: string;
  workflow_version: number;
  revision: number;
  enabled: number;
  instructions: string;
  positive_suffix: string;
  negative_prompt: string;
  output_format?: string | null;
  knowledge_mode?: string | null;
  created_at: string;
};

/** 旧行没有新列：读取时补兼容值，不批量重写历史修订。 */
function normalizeOutputFormat(value: unknown): ActivityImagePromptOutputFormat {
  return value === 'tags' ? 'tags' : 'prose';
}

function normalizeKnowledgeMode(value: unknown): ActivityImagePromptKnowledgeMode {
  return value === 'keyword' ? 'keyword' : 'none';
}

function toPolicy(row: PolicyRow): ActivityImagePromptPolicy {
  return {
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    revision: Number(row.revision),
    enabled: Boolean(row.enabled),
    instructions: String(row.instructions),
    positiveSuffix: String(row.positive_suffix ?? ''),
    negativePrompt: String(row.negative_prompt ?? ''),
    outputFormat: normalizeOutputFormat(row.output_format),
    knowledgeMode: normalizeKnowledgeMode(row.knowledge_mode),
    createdAt: String(row.created_at),
  };
}

/** 工作流是否声明了服务端组装方式（画风由活动画风管理）。 */
export function workflowUsesServiceFinalizedAssembly(
  database: ServiceDatabase,
  workflowId: string,
  workflowVersion: number,
): boolean {
  const row = database.connection.prepare(
    'SELECT editor_config_json FROM generation_workflow_versions WHERE workflow_id=? AND version=?',
  ).get(workflowId, workflowVersion) as { editor_config_json: string | null } | undefined;
  return parseEditorConfig(row?.editor_config_json ?? null)?.promptAssembly === 'service-finalized-v1';
}

export function getActivityImagePromptPolicy(
  database: ServiceDatabase,
  workflowId: string,
  workflowVersion: number,
): ActivityImagePromptPolicy | null {
  const row = database.connection.prepare(`
    SELECT workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,
      output_format,knowledge_mode,created_at
    FROM activity_image_prompt_policy_versions
    WHERE workflow_id=? AND workflow_version=?
    ORDER BY revision DESC LIMIT 1
  `).get(workflowId, workflowVersion) as PolicyRow | undefined;
  return row ? toPolicy(row) : null;
}

export function resolveActivityImagePromptPolicy(
  database: ServiceDatabase,
  workflowId: string,
  workflowVersion: number,
): ActivityImagePromptPolicy {
  return getActivityImagePromptPolicy(database, workflowId, workflowVersion) ?? {
    workflowId,
    workflowVersion,
    revision: 0,
    enabled: true,
    instructions: DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS,
    positiveSuffix: '',
    negativePrompt: '',
    outputFormat: 'prose',
    knowledgeMode: 'none',
    createdAt: '',
  };
}

export function saveActivityImagePromptPolicy(
  database: ServiceDatabase,
  input: SaveActivityImagePromptPolicyRequest,
): ActivityImagePromptPolicy {
  return database.transaction(() => {
    const published = database.connection.prepare(`SELECT 1 FROM generation_workflow_versions
      WHERE workflow_id=? AND version=? AND is_published=1`).get(input.workflowId, input.workflowVersion);
    if (!published) throw Object.assign(new Error('只能为已发布的工作流版本配置提示词策略。'), {
      code: 'workflow_version_not_found', statusCode: 404,
    });
    const outputFormat = normalizeOutputFormat(input.outputFormat);
    const knowledgeMode = normalizeKnowledgeMode(input.knowledgeMode);
    const serviceFinalized = workflowUsesServiceFinalizedAssembly(database, input.workflowId, input.workflowVersion);
    // 本轮 prose 只支持 knowledgeMode=none；其它组合明确拒绝而不是静默降级。
    if (outputFormat === 'prose' && knowledgeMode !== 'none') {
      throw Object.assign(new Error('“原有描述”模式暂不支持关键词补全，请改用结构化混合模式或关闭关键词补全。'), {
        code: 'prompt_policy_knowledge_mode_incompatible', statusCode: 409,
      });
    }
    if (outputFormat === 'tags' && !serviceFinalized) {
      throw Object.assign(new Error('结构化混合模式需要工作流支持服务端组装，请选择支持的新版本。'), {
        code: 'prompt_policy_workflow_incompatible', statusCode: 409,
      });
    }
    const positiveSuffix = input.positiveSuffix.trim();
    if (serviceFinalized && positiveSuffix) {
      throw Object.assign(new Error('画风由活动设置管理，避免重复添加；请清空画风后缀并到活动画风中选择。'), {
        code: 'prompt_policy_style_managed_by_activity', statusCode: 409,
      });
    }
    const current = getActivityImagePromptPolicy(database, input.workflowId, input.workflowVersion);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.revision) {
      throw Object.assign(new Error('提示词策略已在其他窗口更新，请刷新后再保存。'), {
        code: 'prompt_policy_revision_conflict', statusCode: 409,
      });
    }
    const policy: ActivityImagePromptPolicy = {
      workflowId: input.workflowId,
      workflowVersion: input.workflowVersion,
      revision: currentRevision + 1,
      enabled: input.enabled,
      instructions: input.instructions.trim(),
      positiveSuffix,
      negativePrompt: input.negativePrompt.trim(),
      outputFormat,
      knowledgeMode,
      createdAt: nowIso(),
    };
    database.connection.prepare(`
      INSERT INTO activity_image_prompt_policy_versions
        (workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,
         output_format,knowledge_mode,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(policy.workflowId, policy.workflowVersion, policy.revision, policy.enabled ? 1 : 0,
      policy.instructions, policy.positiveSuffix, policy.negativePrompt,
      policy.outputFormat, policy.knowledgeMode, policy.createdAt);
    return policy;
  });
}
