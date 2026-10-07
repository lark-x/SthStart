import type { ImageOperationMetadata } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';

/**
 * 阶段 4C：三类图片历史响应共用的操作元数据读取（计划 §13.1）。
 *
 * 历史行本身只保存产物；细化关系保存在 `activity_studio_job_items`（native_job_id / candidate_id
 * 指向该行）。旧行没有任何关联时返回 `undefined`，界面按 render 显示，不回填旧数据。
 *
 * 这里只做读取，不写库、不触发同步，也不复制一份平行的素材图谱。
 */
export function readImageOperationMetadata(
  database: ServiceDatabase,
  nativeId: string | null | undefined,
): ImageOperationMetadata | undefined {
  if (!nativeId) return undefined;
  const row = database.connection.prepare(`SELECT i.job_id,i.input_json,j.input_json AS job_input_json
    FROM activity_studio_job_items i JOIN activity_studio_jobs j ON j.id=i.job_id
    WHERE i.native_job_id=? OR i.candidate_id=?
    ORDER BY i.created_at DESC LIMIT 1`).get(nativeId, nativeId) as
    { job_id: string; input_json: string; job_input_json: string } | undefined;
  if (!row) return undefined;
  let jobInput: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(row.job_input_json));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) jobInput = parsed as Record<string, unknown>;
  } catch { return undefined; }
  const operation = jobInput.operation === 'hires' ? 'hires' as const : 'render' as const;
  let parentArtifactId: string | null = null;
  if (operation === 'hires') {
    try {
      const item = JSON.parse(String(row.input_json)) as { sourceArtifactId?: unknown };
      parentArtifactId = typeof item.sourceArtifactId === 'string' ? item.sourceArtifactId : null;
    } catch { parentArtifactId = null; }
  }
  return { operation, parentArtifactId, studioJobId: String(row.job_id) };
}
