import { Type, type Static } from '@sinclair/typebox';

const strict = { additionalProperties: false };
const id = Type.String({ minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' });
const text = (maxLength = 4000) => Type.String({ maxLength });
const json = Type.Record(Type.String(), Type.Unknown());
const nullableId = Type.Union([id, Type.Null()]);
const hash64 = Type.String({ pattern: '^[a-f0-9]{64}$' });
const enumeration = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)));

export const CreativeRoleSchema = Type.Object({
  id, name: text(120), responsibility: text(12000), core: Type.Boolean(),
  capability: enumeration(['text', 'multimodal']), modelId: nullableId,
  tools: Type.Array(id, { maxItems: 30 }), revision: Type.Integer({ minimum: 1 }),
}, strict);
export type CreativeRole = Static<typeof CreativeRoleSchema>;
export const CreativeRoleFromTemplateSchema = Type.Object({
  templateId: id,
  id,
  name: Type.String({ minLength: 1, maxLength: 120 }),
  modelId: Type.Optional(id),
}, strict);
export type CreativeRoleFromTemplate = Static<typeof CreativeRoleFromTemplateSchema>;
export const CreativePayloadKindSchema = enumeration(['context', 'plan', 'scene', 'review', 'visual-brief', 'image-prompt', 'image', 'decision', 'result']);
export type CreativePayloadKind = Static<typeof CreativePayloadKindSchema>;
export const CreativeNodeKindSchema = enumeration(['context', 'agent', 'tool', 'parallel', 'join', 'condition', 'revision', 'approval', 'adopt', 'subworkflow']);
export const CreativeNodeSchema = Type.Object({
  id, kind: CreativeNodeKindSchema, label: text(160), roleId: Type.Optional(id),
  outputKind: CreativePayloadKindSchema,
  inputs: Type.Record(id, Type.Object({ nodeId: id, kind: CreativePayloadKindSchema }, strict)),
  config: Type.Object({
    instruction: Type.Optional(text(20000)), tool: Type.Optional(id),
    reviewerRoleIds: Type.Optional(Type.Array(id, { maxItems: 10 })),
    maxRevisions: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 })),
    targetNodeId: Type.Optional(id), workflowId: Type.Optional(id), workflowVersion: Type.Optional(Type.Integer({ minimum: 1 })),
    condition: Type.Optional(enumeration(['approved', 'needs_revision', 'ordinary_image', 'critical_change'])),
    importance: Type.Optional(enumeration(['ordinary', 'key', 'baseline', 'unknown'])),
    parameters: Type.Optional(json),
  }, strict),
  position: Type.Object({ x: Type.Number(), y: Type.Number() }, strict),
}, strict);
export type CreativeNode = Static<typeof CreativeNodeSchema>;
export const CreativeEdgeSchema = Type.Object({ id, source: id, target: id, when: Type.Optional(enumeration(['always', 'approved', 'rejected', 'ordinary', 'important'])) }, strict);
export type CreativeEdge = Static<typeof CreativeEdgeSchema>;
export const CreativeWorkflowDocumentSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 160 }), description: text(),
  purpose: enumeration(['story', 'illustration', 'research', 'general', 'video-plan']),
  nodes: Type.Array(CreativeNodeSchema, { minItems: 1, maxItems: 100 }),
  edges: Type.Array(CreativeEdgeSchema, { maxItems: 300 }),
}, strict);
export type CreativeWorkflowDocument = Static<typeof CreativeWorkflowDocumentSchema>;
export const CreativeWorkflowSchema = Type.Object({
  id, revision: Type.Integer({ minimum: 1 }), publishedVersion: Type.Integer({ minimum: 0 }),
  document: CreativeWorkflowDocumentSchema, createdAt: text(60), updatedAt: text(60),
}, strict);
export type CreativeWorkflow = Static<typeof CreativeWorkflowSchema>;
export const CreativeWorkflowVersionSchema = Type.Object({ id, version: Type.Integer({ minimum: 1 }), document: CreativeWorkflowDocumentSchema, contentHash: text(64), createdAt: text(60) }, strict);
export type CreativeWorkflowVersion = Static<typeof CreativeWorkflowVersionSchema>;
export const CREATIVE_SYSTEM_WORKFLOW_NAMES = [
  'AI 创作总管对话',
  '外部场景候选审核',
  '外部视觉简报候选审核',
  '外部视频方案候选审核',
] as const;
export function isSystemInternalWorkflowName(name: string): boolean {
  return (CREATIVE_SYSTEM_WORKFLOW_NAMES as readonly string[]).includes(name);
}
export const CreativeValidationIssueSchema = Type.Object({ code: id, message: text(), nodeId: Type.Optional(id) }, strict);
export const CreativeValidationSchema = Type.Object({ valid: Type.Boolean(), issues: Type.Array(CreativeValidationIssueSchema), order: Type.Array(id) }, strict);
export type CreativeValidation = Static<typeof CreativeValidationSchema>;

export const CreativeScopeSchema = Type.Object({
  workName: Type.Union([text(200), Type.Null()]), worldId: nullableId, branchId: nullableId, projectId: nullableId,
}, strict);
export type CreativeScope = Static<typeof CreativeScopeSchema>;
export const CreativeBudgetSchema = Type.Object({
  maxTextCalls: Type.Integer({ minimum: 1, maximum: 10000 }), maxImages: Type.Integer({ minimum: 0, maximum: 500 }),
  maxTokens: Type.Integer({ minimum: 100, maximum: 50000000 }), maxRevisions: Type.Integer({ minimum: 0, maximum: 2 }),
}, strict);
export type CreativeBudget = Static<typeof CreativeBudgetSchema>;
export const CreativeWorkflowDryRunRequestSchema = Type.Object({
  document: CreativeWorkflowDocumentSchema,
}, strict);
export type CreativeWorkflowDryRunRequest = Static<typeof CreativeWorkflowDryRunRequestSchema>;
export const CreativeWorkflowDryRunResultSchema = Type.Object({
  valid: Type.Boolean(),
  validation: CreativeValidationSchema,
  ready: Type.Boolean(),
  blockers: Type.Array(text(500)),
  estimatedCalls: Type.Object({
    minTextCalls: Type.Integer({ minimum: 0 }),
    maxTextCalls: Type.Integer({ minimum: 0 }),
    minImages: Type.Integer({ minimum: 0 }),
    maxImages: Type.Integer({ minimum: 0 }),
    estimatedMinTokens: Type.Integer({ minimum: 0 }),
    estimatedMaxTokens: Type.Integer({ minimum: 0 }),
  }, strict),
  stages: Type.Array(Type.Object({
    layer: Type.Integer({ minimum: 0 }),
    nodeIds: Type.Array(id),
  }, strict)),
  roles: Type.Array(Type.Object({
    roleId: id,
    name: text(120),
    capability: enumeration(['text', 'multimodal']),
    modelId: nullableId,
    ready: Type.Boolean(),
    issue: Type.Union([text(500), Type.Null()]),
  }, strict)),
  branches: Type.Array(text(500)),
}, strict);
export type CreativeWorkflowDryRunResult = Static<typeof CreativeWorkflowDryRunResultSchema>;
export const CreativeWorkflowNlEditRequestSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }),
  document: CreativeWorkflowDocumentSchema,
  instruction: Type.String({ minLength: 1, maxLength: 10000 }),
}, strict);
export type CreativeWorkflowNlEditRequest = Static<typeof CreativeWorkflowNlEditRequestSchema>;
export const CreativeWorkflowNlEditResultSchema = Type.Object({
  summary: text(4000),
  document: CreativeWorkflowDocumentSchema,
  validation: CreativeValidationSchema,
  changes: Type.Array(text(500)),
  usage: Type.Object({
    totalTokens: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  }, strict),
}, strict);
export type CreativeWorkflowNlEditResult = Static<typeof CreativeWorkflowNlEditResultSchema>;
export const CreativeStyleGuideSchema = Type.Object({
  tone: Type.Optional(text(500)),
  bannedCliches: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 50 })),
  styleSample: Type.Optional(text(3000)),
  pacingHint: Type.Optional(text(500)),
}, strict);
export type CreativeStyleGuide = Static<typeof CreativeStyleGuideSchema>;
export const CreativeCharacterVoiceSchema = Type.Object({
  voiceSamples: Type.Array(Type.String({ minLength: 1, maxLength: 400 }), { maxItems: 10 }),
  mannerisms: Type.Optional(text(400)),
  taboos: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 20 })),
}, strict);
export type CreativeCharacterVoice = Static<typeof CreativeCharacterVoiceSchema>;
export const CreativeApprovalScopePolicySchema = Type.Object({
  schemaVersion: Type.Literal(1),
  enabled: Type.Boolean(),
  kind: Type.Literal('ordinary_image'),
  allowedSceneArtifactIds: Type.Array(id, { maxItems: 1000 }),
  styleGuide: Type.Optional(CreativeStyleGuideSchema),
  characterVoices: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 160 }), CreativeCharacterVoiceSchema)),
}, strict);
export type CreativeApprovalScopePolicy = Static<typeof CreativeApprovalScopePolicySchema>;
export const CreativeScopePolicyReadSchema = Type.Object({
  scope: CreativeScopeSchema,
}, strict);
export type CreativeScopePolicyRead = Static<typeof CreativeScopePolicyReadSchema>;
export const CreativeScopePolicyQuerySchema = Type.Object({
  scope: Type.String({ minLength: 2, maxLength: 4000 }),
}, strict);
export type CreativeScopePolicyQuery = Static<typeof CreativeScopePolicyQuerySchema>;
export const CreativeScopePolicyPutSchema = Type.Object({
  scope: CreativeScopeSchema,
  expectedRevision: Type.Integer({ minimum: 0 }),
  policy: CreativeApprovalScopePolicySchema,
}, strict);
export type CreativeScopePolicyPut = Static<typeof CreativeScopePolicyPutSchema>;
export const CreativeScopePolicyViewSchema = Type.Object({
  scope: CreativeScopeSchema,
  policy: CreativeApprovalScopePolicySchema,
  revision: Type.Integer({ minimum: 0 }),
  updatedAt: Type.Union([Type.String({ minLength: 1, maxLength: 60 }), Type.Null()]),
}, strict);
export type CreativeScopePolicyView = Static<typeof CreativeScopePolicyViewSchema>;
export const CreativeRunStatusSchema = enumeration(['queued', 'running', 'waiting_approval', 'paused', 'uncertain', 'completed', 'failed', 'cancelled']);
export const CreativeRunSchema = Type.Object({
  id, workflowId: id, workflowVersion: Type.Integer({ minimum: 1 }), revision: Type.Integer({ minimum: 1 }),
  status: CreativeRunStatusSchema, scope: CreativeScopeSchema, instruction: text(20000),
  budget: CreativeBudgetSchema, usage: Type.Object({ textCalls: Type.Integer({ minimum: 0 }), images: Type.Integer({ minimum: 0 }), tokens: Type.Integer({ minimum: 0 }) }, strict),
  roleSnapshot: Type.Array(CreativeRoleSchema), input: json, parentRunId: nullableId,
  createdAt: text(60), updatedAt: text(60), error: Type.Union([text(8000), Type.Null()]),
}, strict);
export type CreativeRun = Static<typeof CreativeRunSchema>;
export const CreativeNodeRunSchema = Type.Object({
  id, runId: id, nodeId: id, attempt: Type.Integer({ minimum: 0 }),
  status: enumeration(['pending', 'running', 'waiting', 'succeeded', 'skipped', 'failed', 'uncertain']),
  input: json, outputArtifactId: nullableId, externalTaskId: nullableId, traceId: id,
  dispatchedAt: Type.Union([text(60), Type.Null()]), error: Type.Union([text(8000), Type.Null()]),
  leaseOwner: Type.Union([text(160), Type.Null()]), leaseUntil: Type.Integer({ minimum: 0 }),
  createdAt: text(60), updatedAt: text(60),
}, strict);
export type CreativeNodeRun = Static<typeof CreativeNodeRunSchema>;
export const CreativeArtifactSchema = Type.Object({
  id, runId: id, nodeRunId: id, kind: CreativePayloadKindSchema, content: json, contentHash: text(64),
  dependencyIds: Type.Array(id), status: enumeration(['candidate', 'accepted', 'superseded', 'stale']), createdAt: text(60),
}, strict);
export type CreativeArtifact = Static<typeof CreativeArtifactSchema>;
export const CreativeReviewScoresSchema = Type.Object({
  epistemic: Type.Integer({ minimum: 1, maximum: 5 }),
  voiceConsistency: Type.Integer({ minimum: 1, maximum: 5 }),
  showDontTell: Type.Integer({ minimum: 1, maximum: 5 }),
  pacing: Type.Integer({ minimum: 1, maximum: 5 }),
}, strict);
export type CreativeReviewScores = Static<typeof CreativeReviewScoresSchema>;
export const CreativeReviewSchema = Type.Object({
  verdict: enumeration(['approved', 'changes_requested', 'uncertain']),
  targetArtifactId: id, targetHash: text(64),
  issues: Type.Array(Type.Object({ severity: enumeration(['blocking', 'suggestion', 'unknown']), message: text(), evidence: text(), location: text(1000) }, strict), { maxItems: 100 }),
  scores: Type.Optional(CreativeReviewScoresSchema),
  summary: text(8000),
}, strict);
export const CreativeAlternativeRunRequestSchema = Type.Object({
  angle: Type.String({ minLength: 1, maxLength: 1000 }),
  budget: Type.Optional(CreativeBudgetSchema),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 160, pattern: '^[A-Za-z0-9_-]+$' }),
}, strict);
export type CreativeAlternativeRunRequest = Static<typeof CreativeAlternativeRunRequestSchema>;
export type CreativeReview = Static<typeof CreativeReviewSchema>;
export const CreativeApprovalSchema = Type.Object({
  id, runId: id, nodeRunId: id, artifactIds: Type.Array(id), bundleHash: text(64), revision: Type.Integer({ minimum: 1 }),
  status: enumeration(['pending', 'approved', 'rejected', 'stale']), comment: text(8000),
  createdAt: text(60), decidedAt: Type.Union([text(60), Type.Null()]),
}, strict);
export type CreativeApproval = Static<typeof CreativeApprovalSchema>;
export const CreativeRunDetailSchema = Type.Object({ run: CreativeRunSchema, nodes: Type.Array(CreativeNodeRunSchema), artifacts: Type.Array(CreativeArtifactSchema), approvals: Type.Array(CreativeApprovalSchema) }, strict);
export type CreativeRunDetail = Static<typeof CreativeRunDetailSchema>;
export const CreativeCreateWorkflowSchema = Type.Object({ document: CreativeWorkflowDocumentSchema }, strict);
export const CreativeSaveWorkflowSchema = Type.Object({ expectedRevision: Type.Integer({ minimum: 1 }), document: CreativeWorkflowDocumentSchema }, strict);
export const CreativeRevisionSchema = Type.Object({ expectedRevision: Type.Integer({ minimum: 1 }) }, strict);
export const CreativeStartRunSchema = Type.Object({
  workflowId: id, workflowVersion: Type.Integer({ minimum: 1 }), idempotencyKey: id, scope: CreativeScopeSchema,
  instruction: Type.String({ minLength: 1, maxLength: 20000 }), budget: CreativeBudgetSchema, input: json,
}, strict);
export type CreativeStartRun = Static<typeof CreativeStartRunSchema>;
export const CreativeDecisionSchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }), bundleHash: text(64), decision: enumeration(['approve', 'reject']), comment: text(8000),
}, strict);
export type CreativeDecision = Static<typeof CreativeDecisionSchema>;
export const CreativeRecoverySchema = Type.Object({
  expectedRevision: Type.Integer({ minimum: 1 }), resolution: enumeration(['not_executed', 'result_received']),
  note: Type.String({ minLength: 1, maxLength: 4000 }), output: Type.Optional(json),
}, strict);
export const CreativeRoleListSchema = Type.Object({ items: Type.Array(CreativeRoleSchema) }, strict);
export const CreativeWorkflowListSchema = Type.Object({ items: Type.Array(CreativeWorkflowSchema) }, strict);
export const CreativeRunListSchema = Type.Object({ items: Type.Array(CreativeRunSchema) }, strict);

export const CreativeActionEntitySchema = Type.Object({
  kind: enumeration([
    'work',
    'world-setup',
    'story-document',
    'story-project',
    'workflow',
    'character-organization',
    'world-branch',
  ]),
  id: text(500),
  name: text(500),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
}, strict);
export type CreativeActionEntity = Static<typeof CreativeActionEntitySchema>;
export const CreativeActionPreviewItemSchema = Type.Object({
  index: Type.Integer({ minimum: 0 }),
  tool: enumeration([
    'work.create',
    'world.setup.create',
    'world.setup.update',
    'story.document.create',
    'story.document.update',
    'story.project.create',
    'workflow.create',
    'workflow.update',
    'character.organization.update',
    'timeline.branch.create',
  ]),
  entity: CreativeActionEntitySchema,
  operation: enumeration(['create', 'update']),
  changes: Type.Array(Type.Object({
    field: text(500),
    before: Type.Unknown(),
    after: Type.Unknown(),
  }, strict)),
  requiresAdminScope: Type.Boolean(),
  affectsGlobalLibrary: Type.Boolean(),
  snapshotHash: hash64,
}, strict);
export type CreativeActionPreviewItem = Static<typeof CreativeActionPreviewItemSchema>;
export const CreativeActionPreviewSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  scope: CreativeScopeSchema,
  previewHash: hash64,
  valid: Type.Boolean(),
  issues: Type.Array(Type.Object({
    code: id,
    message: text(8000),
  }, strict)),
  items: Type.Array(CreativeActionPreviewItemSchema),
}, strict);
export type CreativeActionPreview = Static<typeof CreativeActionPreviewSchema>;

export const CreativeMessageRequestSchema = Type.Object({
  conversationId: Type.Optional(id), scope: CreativeScopeSchema,
  message: Type.String({ minLength: 1, maxLength: 20000 }),
  mode: Type.Optional(enumeration(['advisory', 'ai'])),
  budget: Type.Optional(CreativeBudgetSchema),
  idempotencyKey: Type.Optional(id),
}, strict);
export type CreativeMessageRequest = Static<typeof CreativeMessageRequestSchema>;
export const CreativeConversationMessageSchema = Type.Object({
  id, conversationId: id, role: enumeration(['user', 'assistant']), content: text(40000), createdAt: text(60),
}, strict);
export type CreativeConversationMessage = Static<typeof CreativeConversationMessageSchema>;
export const CreativeMessageResponseSchema = Type.Object({
  conversationId: id, message: CreativeConversationMessageSchema,
  runId: Type.Optional(id),
  proposal: Type.Union([Type.Object({
    workflowId: id, workflowVersion: Type.Integer({ minimum: 1 }), instruction: text(20000),
    input: json, reason: text(4000),
  }, strict), Type.Null()]),
}, strict);
export type CreativeMessageResponse = Static<typeof CreativeMessageResponseSchema>;
export const CreativeConversationSchema = Type.Object({ id, scope: CreativeScopeSchema, messages: Type.Array(CreativeConversationMessageSchema) }, strict);
export const CreativeGrantSchema = Type.Object({
  id, name: Type.String({ minLength: 1, maxLength: 120 }), scope: CreativeScopeSchema,
  permissions: Type.Array(enumeration(['read', 'propose', 'run', 'stop']), { minItems: 1 }),
  expiresAt: text(60), revoked: Type.Boolean(), createdAt: text(60),
}, strict);
export type CreativeGrant = Static<typeof CreativeGrantSchema>;
export const CreativeCreateGrantSchema = Type.Object({
  name: CreativeGrantSchema.properties.name, scope: CreativeScopeSchema,
  permissions: CreativeGrantSchema.properties.permissions,
  expiresAt: text(60), budget: CreativeBudgetSchema,
}, strict);
export const CreativeGrantCreatedSchema = Type.Object({ grant: CreativeGrantSchema, token: Type.String() }, strict);
