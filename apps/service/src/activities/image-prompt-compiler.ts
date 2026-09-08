import { createHash, randomUUID } from 'node:crypto';
import type {
  ActorSnapshot,
  ContentDocument,
  ImageConfigDocument,
  MediaSlot,
  PromptBlock,
  PromptCompilation,
  PromptRecipe,
  PromptRecipeOverride,
  ReferenceInput,
  SourceRef,
} from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { resolveWorkflowAndEngine } from '../generation.js';
import type { ImageExecutionPlan } from '@sthstart/contracts';

export function resolveImageExecutionPlan(database: ServiceDatabase, hasReferences: boolean): ImageExecutionPlan | null {
  const preferred = hasReferences ? 'activity_image_edit' : 'activity_image_text';
  const assigned = database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE app_id = ? AND purpose = ?').get('activities', preferred);
  const purpose = assigned ? preferred : 'activity_media_slot';
  if (!database.connection.prepare('SELECT 1 FROM app_generation_assignments WHERE app_id = ? AND purpose = ?').get('activities', purpose)) return null;
  const resolved = resolveWorkflowAndEngine(database, 'activities', { purpose });
  const capabilityRow = database.connection.prepare(`SELECT v.input_capabilities_json, m.input_capabilities_json AS legacy_input_capabilities_json
    FROM generation_workflow_versions v
    LEFT JOIN generation_workflow_media_versions m ON m.workflow_id=v.workflow_id AND m.version=v.version
    WHERE v.workflow_id=? AND v.version=?`).get(resolved.workflow.id, resolved.workflow.version) as { input_capabilities_json?: string; legacy_input_capabilities_json?: string } | undefined;
  let directCapabilities: Record<string, unknown> = {};
  let legacyCapabilities: Record<string, unknown> = {};
  try { directCapabilities = JSON.parse(capabilityRow?.input_capabilities_json ?? '{}') as Record<string, unknown>; } catch { directCapabilities = {}; }
  try { legacyCapabilities = JSON.parse(capabilityRow?.legacy_input_capabilities_json ?? '{}') as Record<string, unknown>; } catch { legacyCapabilities = {}; }
  const inputCapabilities = Object.keys(directCapabilities).length ? directCapabilities : legacyCapabilities;
  return { purpose, workflowId: resolved.workflow.id, workflowVersion: resolved.workflow.version, engineId: resolved.engine.id,
    definitionHash: createHash('sha256').update(JSON.stringify(resolved.workflow.definition)).digest('hex'), nodeBindings: resolved.workflow.nodeBindings,
    ...(Object.keys(inputCapabilities).length ? { inputCapabilities: inputCapabilities as ImageExecutionPlan['inputCapabilities'] } : {}) };
}

import { createSourceRef, extractEntityFieldValue } from './image-provenance.js';
import { buildCharacterVisualPrompt, normalizeCharacterAppearance } from '../characters/persona-compiler.js';

export const PROMPT_COMPILER_VERSION = 'v1.0.0';
export const DEFAULT_TEMPLATE_ID = 'activity-image-v1';
export const DEFAULT_TEMPLATE_VERSION = '1.0.0';

export interface PrepareRecipeOptions {
  activityId: string;
  contentRevisionId: string;
  contentDoc: ContentDocument;
  imageConfigRevisionId: string;
  imageConfigDoc: ImageConfigDocument;
  slotId: string;
  overrides?: PromptRecipeOverride[];
  references?: ReferenceInput[];
  customParams?: Record<string, unknown>;
  workflowId?: string;
  workflowVersion?: number;
  nodeBindings?: Record<string, string[]>;
  executionPlan?: ImageExecutionPlan | null;
}

export function computeSlotFingerprint(slot: MediaSlot, contentDoc: ContentDocument): string {
  const stage = contentDoc.stages.find((s) => s.id === slot.stageId);
  const actors = contentDoc.actors.filter((a) => slot.actorIds.includes(a.id));
  const facts = contentDoc.facts.filter((f) => slot.sourceFactIds.includes(f.id));

  const fingerprintPayload = {
    slotId: slot.id,
    kind: slot.kind,
    caption: slot.caption,
    shotDescription: slot.shotDescription,
    stage: stage ? { id: stage.id, title: stage.title, location: stage.location } : null,
    actors: actors.map((a) => ({ id: a.id, name: a.displayName, role: a.activityRole, outfit: a.outfitDescription })),
    facts: facts.map((f) => ({ id: f.id, text: f.text })),
  };

  return createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex');
}

export function compilePromptRecipe(options: PrepareRecipeOptions): {
  recipe: PromptRecipe;
  compilation: PromptCompilation;
} {
  const {
    activityId,
    contentRevisionId,
    contentDoc,
    imageConfigRevisionId,
    imageConfigDoc,
    slotId,
    overrides = [],
    references = [],
    customParams = {},
    workflowId,
    workflowVersion,
    nodeBindings = {},
  } = options;

  const slot = contentDoc.mediaSlots.find((s) => s.id === slotId);
  if (!slot) {
    throw new Error(`media_slot_not_found: slotId '${slotId}' not found in content document`);
  }

  const stage = contentDoc.stages.find((s) => s.id === slot.stageId);
  const actors = contentDoc.actors.filter((a) => slot.actorIds.includes(a.id));
  const facts = contentDoc.facts.filter((f) => slot.sourceFactIds.includes(f.id));
  const slotConfig = imageConfigDoc.slotConfigs.find((sc) => sc.slotId === slot.id);

  const slotFingerprint = computeSlotFingerprint(slot, contentDoc);
  const recipeId = `recipe_${randomUUID().replace(/-/g, '')}`;
  const compilationId = `comp_${randomUUID().replace(/-/g, '')}`;
  const now = nowIso();
  const sourceRefs: SourceRef[] = [];
  const blocks: PromptBlock[] = [];

  const overrideMap = new Map<string, PromptRecipeOverride>(
    overrides.map((o) => [o.fieldPath, o])
  );

  // 1. Style source refs & blocks
  const styleSourceRef = createSourceRef({
    activityId,
    ownerKind: 'image_config',
    ownerRevisionId: imageConfigRevisionId,
    entityKind: 'style',
    entityId: 'global_style',
    fieldPath: '/globalStylePrompt',
    valueSnapshot: imageConfigDoc.globalStylePrompt,
    labelSnapshot: '本场画风',
  });
  sourceRefs.push(styleSourceRef);

  const styleOverride = overrideMap.get('/globalStylePrompt');
  const styleText = styleOverride ? styleOverride.overrideText : imageConfigDoc.globalStylePrompt;
  if (styleText.trim()) {
    blocks.push({
      id: `blk_style_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'style',
      actorIds: [],
      sourceRefIds: [styleSourceRef.id],
      originalText: imageConfigDoc.globalStylePrompt,
      renderedText: styleText.trim(),
      origin: styleOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 1b. Theme source refs & blocks
  if (contentDoc.activity.theme?.trim()) {
    const themeSourceRef = createSourceRef({
      activityId,
      ownerKind: 'content',
      ownerRevisionId: contentRevisionId,
      entityKind: 'activity',
      entityId: 'activity',
      fieldPath: 'activity.theme',
      valueSnapshot: contentDoc.activity.theme,
      labelSnapshot: '活动主题',
    });
    sourceRefs.push(themeSourceRef);

    const themeOverride = overrideMap.get('activity.theme') || overrideMap.get('/theme');
    const themeText = themeOverride ? themeOverride.overrideText : contentDoc.activity.theme;
    blocks.push({
      id: `blk_theme_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'scene',
      actorIds: [],
      sourceRefIds: [themeSourceRef.id],
      originalText: contentDoc.activity.theme,
      renderedText: themeText.trim(),
      origin: themeOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 2. Scene source refs & blocks
  const sceneLocation = slotConfig?.composition || stage?.location || contentDoc.activity.location;
  if (sceneLocation) {
    const sceneSourceRef = createSourceRef({
      activityId,
      ownerKind: 'content',
      ownerRevisionId: contentRevisionId,
      entityKind: stage ? 'stage' : 'activity',
      entityId: stage ? stage.id : 'activity',
      fieldPath: '/location',
      valueSnapshot: sceneLocation,
      labelSnapshot: stage ? `阶段地点「${stage.title}」` : '活动地点',
    });
    sourceRefs.push(sceneSourceRef);

    const sceneOverride = overrideMap.get('/location');
    const sceneText = sceneOverride ? sceneOverride.overrideText : sceneLocation;
    blocks.push({
      id: `blk_scene_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'scene',
      actorIds: [],
      sourceRefIds: [sceneSourceRef.id],
      originalText: sceneLocation,
      renderedText: sceneText.trim(),
      origin: sceneOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 3. Actors: Identity, Appearance, Outfit
  for (const actor of actors) {
    // Identity & Appearance
    const appearanceField = (actor.persona as Record<string, unknown>)?.appearance;
    const appearanceObject = normalizeCharacterAppearance(appearanceField);
    const appearanceText = buildCharacterVisualPrompt({ ...appearanceObject, outfits: [], defaultOutfitId: null });
    const appearanceSourceRef = createSourceRef({
      activityId,
      ownerKind: 'content',
      ownerRevisionId: contentRevisionId,
      entityKind: 'actor',
      entityId: actor.id,
      fieldPath: '/persona/appearance',
      valueSnapshot: appearanceObject,
      labelSnapshot: `角色外貌「${actor.displayName}」`,
    });
    sourceRefs.push(appearanceSourceRef);
    const appearanceSourceRefIds = [appearanceSourceRef.id];
    if (actor.sourceCharacterId) {
      const characterSourceRef = createSourceRef({
        activityId,
        ownerKind: 'character',
        ownerRevisionId: actor.sourceVersion == null
          ? `${actor.sourceCharacterId}:draft:${actor.characterDraftRevision ?? 'unknown'}`
          : `${actor.sourceCharacterId}:v${actor.sourceVersion}`,
        entityKind: actor.sourceVersion == null ? 'character' : 'character_version',
        entityId: actor.sourceCharacterId,
        fieldPath: '/appearance',
        valueSnapshot: appearanceObject,
        labelSnapshot: `公共角色来源「${actor.displayName}」`,
      });
      sourceRefs.push(characterSourceRef);
      appearanceSourceRefIds.push(characterSourceRef.id);
    }

    const appearanceOverride = overrideMap.get(`/actors/${actor.id}/appearance`);
    const renderedAppearance = appearanceOverride ? appearanceOverride.overrideText : appearanceText;

    blocks.push({
      id: `blk_actor_${actor.id}_app_${randomUUID().replace(/-/g, '').slice(0, 6)}`,
      kind: 'appearance',
      actorIds: [actor.id],
      sourceRefIds: appearanceSourceRefIds,
      originalText: appearanceText,
      renderedText: renderedAppearance ? `${actor.displayName}, ${renderedAppearance}` : actor.displayName,
      origin: appearanceOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });

    // Outfit
    const outfitSourceRef = createSourceRef({
      activityId,
      ownerKind: 'content',
      ownerRevisionId: contentRevisionId,
      entityKind: 'actor',
      entityId: actor.id,
      fieldPath: '/outfitDescription',
      valueSnapshot: actor.outfitDescription,
      labelSnapshot: `角色服装「${actor.displayName}」`,
    });
    sourceRefs.push(outfitSourceRef);

    const outfitOverride = overrideMap.get(`/actors/${actor.id}/outfit`);
    const renderedOutfit = outfitOverride ? outfitOverride.overrideText : actor.outfitDescription;

    if (renderedOutfit.trim()) {
      blocks.push({
        id: `blk_actor_${actor.id}_outfit_${randomUUID().replace(/-/g, '').slice(0, 6)}`,
        kind: 'outfit',
        actorIds: [actor.id],
        sourceRefIds: [outfitSourceRef.id],
        originalText: actor.outfitDescription,
        renderedText: renderedOutfit.trim(),
        origin: outfitOverride ? 'manual' : 'source',
        locked: false,
        mappingPrecision: 'exact_block',
      });
    }
  }

  // 4. Action & Shot Description
  const actionText = slot.shotDescription || (facts.length > 0 ? facts.map((f) => f.text).join('，') : '');
  if (actionText.trim()) {
    const actionSourceRef = createSourceRef({
      activityId,
      ownerKind: 'content',
      ownerRevisionId: contentRevisionId,
      entityKind: 'shot',
      entityId: slot.id,
      fieldPath: '/shotDescription',
      valueSnapshot: actionText,
      labelSnapshot: `镜头动作「${slot.caption || slot.id}」`,
    });
    sourceRefs.push(actionSourceRef);

    const actionOverride = overrideMap.get('/shotDescription');
    const renderedAction = actionOverride ? actionOverride.overrideText : actionText;

    blocks.push({
      id: `blk_action_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'action',
      actorIds: slot.actorIds,
      sourceRefIds: [actionSourceRef.id],
      originalText: actionText,
      renderedText: renderedAction.trim(),
      origin: actionOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 5. Composition & Viewpoint (from SlotConfig)
  const compositionParts: string[] = [];
  if (slotConfig?.shotType) compositionParts.push(slotConfig.shotType);
  if (slotConfig?.composition) compositionParts.push(slotConfig.composition);
  if (slotConfig?.viewpoint) compositionParts.push(slotConfig.viewpoint);
  if (slotConfig?.lighting) compositionParts.push(slotConfig.lighting);

  if (compositionParts.length > 0) {
    const compText = compositionParts.join(', ');
    const compSourceRef = createSourceRef({
      activityId,
      ownerKind: 'image_config',
      ownerRevisionId: imageConfigRevisionId,
      entityKind: 'shot',
      entityId: slot.id,
      fieldPath: '/composition',
      valueSnapshot: compText,
      labelSnapshot: '镜头构图与机位',
    });
    sourceRefs.push(compSourceRef);

    const compOverride = overrideMap.get('/composition');
    const renderedComp = compOverride ? compOverride.overrideText : compText;

    blocks.push({
      id: `blk_comp_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'composition',
      actorIds: [],
      sourceRefIds: [compSourceRef.id],
      originalText: compText,
      renderedText: renderedComp.trim(),
      origin: compOverride ? 'manual' : 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 6. Supplement
  if (slotConfig?.supplementPrompt) {
    const suppSourceRef = createSourceRef({
      activityId,
      ownerKind: 'image_config',
      ownerRevisionId: imageConfigRevisionId,
      entityKind: 'shot',
      entityId: slot.id,
      fieldPath: '/supplementPrompt',
      valueSnapshot: slotConfig.supplementPrompt,
      labelSnapshot: '补充提示词',
    });
    sourceRefs.push(suppSourceRef);

    blocks.push({
      id: `blk_supp_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'supplement',
      actorIds: [],
      sourceRefIds: [suppSourceRef.id],
      originalText: slotConfig.supplementPrompt,
      renderedText: slotConfig.supplementPrompt.trim(),
      origin: 'source',
      locked: false,
      mappingPrecision: 'exact_block',
    });
  }

  // 7. Negative Constraint
  const negParts: string[] = [];
  if (imageConfigDoc.globalNegativePrompt) negParts.push(imageConfigDoc.globalNegativePrompt);
  if (slotConfig?.negativePrompt) negParts.push(slotConfig.negativePrompt);
  const negativeText = negParts.join(', ');

  const negSourceRef = createSourceRef({
    activityId,
    ownerKind: 'image_config',
    ownerRevisionId: imageConfigRevisionId,
    entityKind: 'style',
    entityId: 'negative',
    fieldPath: '/globalNegativePrompt',
    valueSnapshot: imageConfigDoc.globalNegativePrompt,
    labelSnapshot: '负向约束',
  });
  sourceRefs.push(negSourceRef);
  const negativeSourceIds = [negSourceRef.id];
  if (slotConfig?.negativePrompt) {
    const localNegative = createSourceRef({ activityId, ownerKind: 'image_config', ownerRevisionId: imageConfigRevisionId,
      entityKind: 'shot', entityId: slot.id, fieldPath: '/negativePrompt', valueSnapshot: slotConfig.negativePrompt, labelSnapshot: '本镜头负向约束' });
    sourceRefs.push(localNegative); negativeSourceIds.push(localNegative.id);
  }

  const negOverride = overrideMap.get('/negativePrompt');
  const renderedNegative = negOverride ? negOverride.overrideText : negativeText;

  blocks.push({
    id: `blk_neg_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    kind: 'negative',
    actorIds: [],
    sourceRefIds: negativeSourceIds,
    originalText: negativeText,
    renderedText: renderedNegative.trim(),
    origin: negOverride ? 'manual' : 'source',
    locked: false,
    mappingPrecision: 'exact_block',
  });

  // 8. Custom / Attempt Overrides that are appended to positive prompt
  for (const override of overrides) {
    if (override.fieldPath.includes('attempt') || override.fieldPath.includes('override') || !blocks.some((b) => b.renderedText.includes(override.overrideText))) {
      const overrideSourceRef = createSourceRef({
        activityId,
        ownerKind: 'recipe',
        ownerRevisionId: recipeId,
        entityKind: 'override',
        entityId: override.id || 'attempt_override',
        fieldPath: override.fieldPath,
        valueSnapshot: override.overrideText,
        labelSnapshot: '单次生成覆盖',
      });
      sourceRefs.push(overrideSourceRef);

      blocks.push({
        id: `blk_override_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
        kind: 'supplement',
        actorIds: [],
        sourceRefIds: [overrideSourceRef.id],
        originalText: '',
        renderedText: override.overrideText.trim(),
        origin: 'manual',
        locked: false,
        mappingPrecision: 'exact_block',
      });
    }
  }

  // Assemble full positive prompt from non-negative blocks
  const positiveBlocks = blocks.filter((b) => b.kind !== 'negative');
  const positivePrompt = positiveBlocks.map((b) => b.renderedText).filter(Boolean).join(', ');

  const channels: Record<string, string> = {
    prompt: positivePrompt,
    positive: positivePrompt,
    negativePrompt: renderedNegative.trim(),
    negative: renderedNegative.trim(),
  };

  const effectiveParams: Record<string, unknown> = {
    ...imageConfigDoc.defaultParams,
    ...slotConfig?.params,
    ...customParams,
  };

  const recipeDoc = {
    activityId,
    contentRevisionId,
    imageConfigRevisionId,
    slotId,
    slotFingerprint,
    sourceRefs,
    blocks,
    references,
    overrides,
    schemaVersion: 1,
  };
  const recipeHash = createHash('sha256').update(JSON.stringify(recipeDoc)).digest('hex');

  // Only advertise inputs that the frozen workflow can actually consume.
  if (options.executionPlan) {
    const bindings = options.executionPlan.nodeBindings;
    for (const key of Object.keys(channels)) if (!bindings[key]) delete channels[key];
    if (!Object.keys(channels).some((key) => key === 'prompt' || key === 'positive')) {
      throw new Error('prompt_binding_missing: 工作流缺少 prompt/positive 节点绑定');
    }
    for (const key of Object.keys(effectiveParams)) {
      if (effectiveParams[key] === undefined) { delete effectiveParams[key]; continue; }
      if (!bindings[key]) throw new Error(`unsupported_parameter: 工作流未绑定参数 ${key}`);
    }
    for (const ref of references) {
      if (!bindings[ref.inputKey]) throw new Error(`input_binding_missing: ${ref.inputKey}`);
      const capability = options.executionPlan.inputCapabilities?.[ref.inputKey];
      if (options.executionPlan.inputCapabilities && !capability) throw new Error(`input_capability_missing: ${ref.inputKey}`);
      if ((capability?.semantic || 'init_image') !== ref.role) throw new Error(`input_semantic_mismatch: ${ref.inputKey} expects ${capability?.semantic || 'init_image'}`);
    }
  }
  const executionPlanPayload = {
    plan: options.executionPlan || null,
    workflowId: workflowId || null,
    workflowVersion: workflowVersion || null,
    channels,
    effectiveParams,
    referenceKeys: references.map((r) => r.inputKey),
  };
  const executionPlanHash = createHash('sha256').update(JSON.stringify(executionPlanPayload)).digest('hex');

  const recipe: PromptRecipe = {
    id: recipeId,
    activityId,
    contentRevisionId,
    imageConfigRevisionId,
    slotId,
    slotFingerprint,
    sourceRefs,
    blocks,
    references,
    overrides,
    recipeHash,
    schemaVersion: 1,
    createdAt: now,
  };

  const compilation: PromptCompilation = {
    id: compilationId,
    recipeId,
    executionPlan: options.executionPlan || null,
    compilerVersion: PROMPT_COMPILER_VERSION,
    templateId: DEFAULT_TEMPLATE_ID,
    templateVersion: DEFAULT_TEMPLATE_VERSION,
    channels,
    effectiveParams,
    executionPlanHash,
    createdAt: now,
  };

  return { recipe, compilation };
}

export function saveRecipeAndCompilation(
  database: ServiceDatabase,
  recipe: PromptRecipe,
  compilation: PromptCompilation,
): void {
  database.transaction(() => {
    database.connection.prepare(`
      INSERT INTO activity_prompt_recipes (
        id, activity_id, content_revision_id, image_config_revision_id,
        slot_id, slot_fingerprint, source_refs_json, blocks_json,
        references_json, overrides_json, recipe_hash, schema_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recipe.id,
      recipe.activityId,
      recipe.contentRevisionId,
      recipe.imageConfigRevisionId,
      recipe.slotId,
      recipe.slotFingerprint,
      JSON.stringify(recipe.sourceRefs),
      JSON.stringify(recipe.blocks),
      JSON.stringify(recipe.references),
      JSON.stringify(recipe.overrides),
      recipe.recipeHash,
      recipe.schemaVersion,
      recipe.createdAt,
    );

    database.connection.prepare(`
      INSERT INTO activity_prompt_compilations (
        id, recipe_id, activity_id, compiler_version, template_id,
        template_version, channels_json, effective_params_json, execution_plan_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      compilation.id,
      compilation.recipeId,
      recipe.activityId,
      compilation.compilerVersion,
      compilation.templateId,
      compilation.templateVersion,
      JSON.stringify(compilation.channels),
      JSON.stringify(compilation.effectiveParams),
      compilation.executionPlanHash,
      compilation.createdAt,
    );

    database.connection.prepare('UPDATE activity_prompt_compilations SET execution_plan_json = ? WHERE id = ?')
      .run(JSON.stringify(compilation.executionPlan || null), compilation.id);

    // Update source dependencies index for impact analysis
    const now = nowIso();
    for (const ref of recipe.sourceRefs) {
      database.connection.prepare(`
        INSERT INTO activity_image_source_dependencies (
          activity_id, slot_id, recipe_id, entity_kind, entity_id, field_path, value_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id, slot_id, entity_kind, entity_id, field_path) DO UPDATE SET
          recipe_id = excluded.recipe_id,
          value_hash = excluded.value_hash,
          updated_at = excluded.updated_at
      `).run(
        recipe.activityId,
        recipe.slotId,
        recipe.id,
        ref.entityKind,
        ref.entityId,
        ref.fieldPath,
        ref.valueHash,
        now,
      );
    }
  });
}

export function getPromptRecipe(
  database: ServiceDatabase,
  activityId: string,
  recipeId: string,
): { recipe: PromptRecipe; compilation: PromptCompilation } | null {
  const recipeRow = database.connection.prepare(`
    SELECT * FROM activity_prompt_recipes WHERE activity_id = ? AND id = ?
  `).get(activityId, recipeId) as Record<string, unknown> | undefined;

  if (!recipeRow) return null;

  const compRow = database.connection.prepare(`
    SELECT * FROM activity_prompt_compilations WHERE recipe_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(recipeId) as Record<string, unknown> | undefined;

  if (!compRow) return null;

  const recipe: PromptRecipe = {
    id: String(recipeRow.id),
    activityId: String(recipeRow.activity_id),
    contentRevisionId: String(recipeRow.content_revision_id),
    imageConfigRevisionId: String(recipeRow.image_config_revision_id),
    slotId: String(recipeRow.slot_id),
    slotFingerprint: String(recipeRow.slot_fingerprint),
    sourceRefs: JSON.parse(String(recipeRow.source_refs_json)),
    blocks: JSON.parse(String(recipeRow.blocks_json)),
    references: JSON.parse(String(recipeRow.references_json)),
    overrides: JSON.parse(String(recipeRow.overrides_json)),
    recipeHash: String(recipeRow.recipe_hash),
    schemaVersion: 1,
    createdAt: String(recipeRow.created_at),
  };

  const compilation: PromptCompilation = {
    id: String(compRow.id),
    recipeId: String(compRow.recipe_id),
    executionPlan: JSON.parse(String(compRow.execution_plan_json || 'null')),
    compilerVersion: String(compRow.compiler_version),
    templateId: String(compRow.template_id),
    templateVersion: String(compRow.template_version),
    channels: JSON.parse(String(compRow.channels_json)),
    effectiveParams: JSON.parse(String(compRow.effective_params_json)),
    executionPlanHash: String(compRow.execution_plan_hash),
    createdAt: String(compRow.created_at),
  };

  return { recipe, compilation };
}
