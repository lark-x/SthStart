import type {
  ActivityImagePromptPolicy,
  SaveActivityImagePromptPolicyRequest,
} from '@sthstart/contracts';
import { DEFAULT_ACTIVITY_IMAGE_PROMPT_INSTRUCTIONS } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

type PolicyRow = {
  workflow_id: string;
  workflow_version: number;
  revision: number;
  enabled: number;
  instructions: string;
  positive_suffix: string;
  negative_prompt: string;
  created_at: string;
};

function toPolicy(row: PolicyRow): ActivityImagePromptPolicy {
  return {
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    revision: Number(row.revision),
    enabled: Boolean(row.enabled),
    instructions: String(row.instructions),
    positiveSuffix: String(row.positive_suffix ?? ''),
    negativePrompt: String(row.negative_prompt ?? ''),
    createdAt: String(row.created_at),
  };
}

export function getActivityImagePromptPolicy(
  database: ServiceDatabase,
  workflowId: string,
  workflowVersion: number,
): ActivityImagePromptPolicy | null {
  const row = database.connection.prepare(`
    SELECT workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,created_at
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
      positiveSuffix: input.positiveSuffix.trim(),
      negativePrompt: input.negativePrompt.trim(),
      createdAt: nowIso(),
    };
    database.connection.prepare(`
      INSERT INTO activity_image_prompt_policy_versions
        (workflow_id,workflow_version,revision,enabled,instructions,positive_suffix,negative_prompt,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(policy.workflowId, policy.workflowVersion, policy.revision, policy.enabled ? 1 : 0,
      policy.instructions, policy.positiveSuffix, policy.negativePrompt, policy.createdAt);
    return policy;
  });
}
