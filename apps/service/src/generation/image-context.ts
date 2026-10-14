import { createHash } from 'node:crypto';
import { buildCharacterVisualContext, toCharacterRuntime, type ActivityLora, type ImageContextSelection } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { compileSnapshot, referencePromptBlock } from '../knowledge/references.js';
import { mergeActivityLoras, readActivityLoraPolicy } from '../activities/image-render-common.js';
import { imageConfigurationError } from './image-configuration.js';

export const contextDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Resolve owned local references; request text never substitutes for authoritative versions. */
export function buildImageContext(database: ServiceDatabase, selection: ImageContextSelection = {}, workflow?: { id: string; version: number }) {
  const sources: Array<{ id: string; label: string; revision: string; hash: string }> = [];
  const actors: Array<{ actorId: string; displayName: string }> = [];
  const blocks: string[] = [];
  const characterLoras: ActivityLora[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const character of selection.characters ?? []) {
    if (seen.has(character.characterId)) throw imageConfigurationError('duplicate_image_character', '同一角色不能重复选择。', 400);
    seen.add(character.characterId);
    const row = database.connection.prepare('SELECT draft_json,draft_revision FROM character_profiles WHERE id=? AND archived=0')
      .get(character.characterId) as { draft_json: string; draft_revision: number } | undefined;
    if (!row) throw imageConfigurationError('image_character_not_found', '所选角色不可用。');
    if (character.draftRevision !== undefined && character.draftRevision !== row.draft_revision)
      throw imageConfigurationError('image_context_changed', '角色资料已变化，请重新准备。');
    const draft = JSON.parse(row.draft_json) as Record<string, unknown>;
    const runtime = toCharacterRuntime(draft);
    const visual = buildCharacterVisualContext(draft, { outfitOverride: character.outfitOverride });
    actors.push({ actorId: character.characterId, displayName: runtime.displayName });
    sources.push({ id: character.characterId, label: runtime.displayName, revision: String(row.draft_revision), hash: contextDigest(draft) });
    blocks.push(`[actorId: ${character.characterId}] ${runtime.displayName}${runtime.englishName ? ` (${runtime.englishName})` : ''}${runtime.work ? ` — ${runtime.work}` : ''}\n${visual.text}`,
      ...(character.outfitOverride !== undefined ? ['本次服饰整体替换基础外观中冲突的衣服，不混搭；未覆盖的辨识特征保持。'] : []));
    if (Array.isArray(draft.visualLoras)) characterLoras.push(...draft.visualLoras as ActivityLora[]);
  }
  const lore = compileSnapshot({ database, narrativeDatabase: null }, [...new Set(selection.noteIds ?? [])].map(sourceId => ({ sourceKind: 'note' as const, sourceId, usage: 'background' as const })));
  if (lore.unresolved.length) throw imageConfigurationError('image_lore_unavailable', '所选设定资料不可用，请重新选择。');
  for (const ref of lore.snapshot.references) sources.push({ id: ref.sourceId, label: ref.title, revision: String(ref.sourceVersion ?? ''),
    hash: contextDigest({ contentHash: ref.sourceContentHash ?? ref.contentHash, nature: ref.nature, usage: ref.usage, excerpt: ref.excerpt }) });
  if (lore.truncated) warnings.push('设定资料超过预算，已截取；请在最终提示词中核对关键视觉约束。');
  const loreText = referencePromptBlock(lore.snapshot);
  if (loreText) blocks.push('仅提取与本画面相关的地点、材料、服装、时间及视觉约束，不新增角色。', loreText);
  const loras = workflow ? mergeActivityLoras(readActivityLoraPolicy(database, workflow.id, workflow.version).entries, characterLoras, [], { rejectActorConflicts: true }) : characterLoras;
  const hash = contextDigest({ selection, sources, loras });
  return { hash, sources, actors, text: blocks.join('\n\n'), loras, warnings };
}

/** Planning references are already frozen; never substitute current notebook contents. */
export function activityImageLore(database: ServiceDatabase, activityId: string) {
  const draftRow = database.connection.prepare('SELECT document_json FROM activity_drafts WHERE activity_id=?').get(activityId) as { document_json: string } | undefined;
  if (draftRow) {
    const document = JSON.parse(draftRow.document_json);
    const bound = document.activity?.planningBasis?.knowledge;
    if (bound) return referencePromptBlock(bound);
  }
  const row = database.connection.prepare('SELECT form_json,snapshot_json FROM activity_planning_sessions WHERE activity_id=? ORDER BY updated_at DESC LIMIT 1').get(activityId) as { form_json: string; snapshot_json: string } | undefined;
  if (!row) return '';
  const form = JSON.parse(row.form_json || '{}');
  const snapshot = JSON.parse(row.snapshot_json || '{}');
  return referencePromptBlock(snapshot.knowledge ?? snapshot.request?.knowledge ?? form.knowledgeSnapshot);
}

export function assertPreparedImageContext(database: ServiceDatabase, appId: string, preparationId?: string, contextHash?: string, expectedCharacterId?: string,
  expected?: { workflowId: string; workflowVersion: number; configurationHash: string }) {
  if ((preparationId !== undefined && (typeof preparationId !== 'string' || !preparationId))
    || (contextHash !== undefined && (typeof contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(contextHash))))
    throw imageConfigurationError('invalid_image_preparation', '提示词准备身份格式无效。', 400);
  if (!preparationId) {
    if (contextHash) throw imageConfigurationError('prompt_preparation_mismatch', '缺少提示词准备记录。');
    return { loras: [] as ActivityLora[], contextHash: null };
  }
  const row = database.connection.prepare("SELECT request_snapshot_json FROM ai_call_records WHERE id=? AND application_id=? AND feature='image-prompt-preparation' AND status='succeeded'").get(preparationId, appId) as { request_snapshot_json: string } | undefined;
  if (!row) throw imageConfigurationError('prompt_preparation_mismatch', '提示词准备记录不可用。');
  const snapshot = JSON.parse(row.request_snapshot_json);
  if (expected && (snapshot.workflow?.id !== expected.workflowId || snapshot.workflow?.version !== expected.workflowVersion
    || snapshot.result?.configurationHash !== expected.configurationHash))
    throw imageConfigurationError('prompt_preparation_mismatch', '提示词准备记录不属于当前工作流配置。');
  if (expectedCharacterId && !(snapshot.context?.characters ?? []).some((item: { characterId: string }) => item.characterId === expectedCharacterId))
    throw imageConfigurationError('prompt_preparation_mismatch', '提示词准备记录不属于当前角色。');
  const current = buildImageContext(database, snapshot.context, snapshot.workflow);
  if (!contextHash || snapshot.contextHash !== contextHash || current.hash !== contextHash)
    throw imageConfigurationError('image_context_changed', '角色、设定或 LoRA 已变化，请重新准备提示词。');
  return { loras: snapshot.loras as ActivityLora[], contextHash };
}
