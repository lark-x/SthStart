import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  CreativeActionPreviewItemSchema,
  CreativeActionPreviewSchema,
  CreativeApprovalScopePolicySchema,
  CreativeRoleFromTemplateSchema,
  CreativeScopePolicyPutSchema,
  CreativeScopePolicyQuerySchema,
  CreativeScopePolicyReadSchema,
  CreativeScopePolicyViewSchema,
} from './creative-orchestration.js';

const scope = {
  workName: '港口故事',
  worldId: 'world-1',
  branchId: 'branch-1',
  projectId: null,
};
const hash = 'a'.repeat(64);

test('role template and scope policy requests are strict cross-layer contracts', () => {
  assert.ok(Value.Check(CreativeRoleFromTemplateSchema, {
    templateId: 'research_specialist',
    id: 'world_lore_researcher',
    name: '世界考据员',
    modelId: 'text-model',
  }));
  assert.ok(Value.Check(CreativeRoleFromTemplateSchema, {
    templateId: 'research_specialist',
    id: 'world_lore_researcher',
    name: '世界考据员',
  }));
  assert.equal(Value.Check(CreativeRoleFromTemplateSchema, {
    templateId: 'research_specialist',
    id: 'world_lore_researcher',
    name: '世界考据员',
    core: false,
  }), false);

  assert.ok(Value.Check(CreativeScopePolicyQuerySchema, {
    scope: JSON.stringify(scope),
  }));
  assert.ok(Value.Check(CreativeScopePolicyReadSchema, { scope }));
  assert.equal(Value.Check(CreativeScopePolicyReadSchema, { scope, unexpected: true }), false);
  const policy = {
    schemaVersion: 1,
    enabled: true,
    kind: 'ordinary_image',
    allowedSceneArtifactIds: ['scene-1'],
  };
  assert.ok(Value.Check(CreativeApprovalScopePolicySchema, policy));
  assert.equal(Value.Check(CreativeApprovalScopePolicySchema, {
    ...policy,
    kind: 'all_content',
  }), false);
  assert.ok(Value.Check(CreativeScopePolicyPutSchema, {
    scope,
    expectedRevision: 0,
    policy,
  }));
  assert.equal(Value.Check(CreativeScopePolicyPutSchema, {
    scope,
    expectedRevision: -1,
    policy,
  }), false);
  assert.ok(Value.Check(CreativeScopePolicyViewSchema, {
    scope,
    policy: { ...policy, enabled: false, allowedSceneArtifactIds: [] },
    revision: 0,
    updatedAt: null,
  }));
});

test('action preview contracts expose only bounded cross-layer preview data', () => {
  const item = {
    index: 0,
    tool: 'workflow.update',
    entity: {
      kind: 'workflow',
      id: 'workflow-1',
      name: '故事场景',
      revision: 3,
    },
    operation: 'update',
    changes: [
      { field: 'name', before: '旧名称', after: '新名称' },
    ],
    requiresAdminScope: false,
    affectsGlobalLibrary: false,
    snapshotHash: hash,
  };
  assert.ok(Value.Check(CreativeActionPreviewItemSchema, item));
  assert.equal(Value.Check(CreativeActionPreviewItemSchema, {
    ...item,
    tool: 'secrets.read',
  }), false);
  assert.equal(Value.Check(CreativeActionPreviewItemSchema, {
    ...item,
    snapshotHash: 'not-a-hash',
  }), false);
  assert.equal(Value.Check(CreativeActionPreviewItemSchema, {
    ...item,
    args: { command: 'outside-contract' },
  }), false);

  assert.ok(Value.Check(CreativeActionPreviewSchema, {
    schemaVersion: 1,
    scope,
    previewHash: hash,
    valid: true,
    issues: [],
    items: [item],
  }));
  assert.equal(Value.Check(CreativeActionPreviewSchema, {
    schemaVersion: 1,
    scope,
    previewHash: hash,
    valid: true,
    issues: [],
    items: [{ ...item, affectsGlobalLibrary: undefined }],
  }), false);
});
