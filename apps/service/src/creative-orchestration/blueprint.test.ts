import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUniversalStoryBlueprintTemplate } from '@sthstart/contracts';
import { ServiceDatabase } from '../database.js';
import { StoryWorldStore } from '../story-worlds/store.js';
import { readCreativeScopePolicy } from './policy.js';
import { CreativeStore } from './store.js';
import { importStoryBodyPack } from './blueprint.js';

test('importStoryBodyPack creates complete 7-layer story body from universal template and stays idempotent', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const pack = createUniversalStoryBlueprintTemplate('星海测试集');
    const first = importStoryBodyPack(database, pack);

    assert.equal(first.work, '星海测试集');
    assert.equal(first.setupCompleted, false);
    assert.equal(first.charactersCreated, 1);
    assert.equal(first.storyLinesCreated, 1);
    assert.ok(first.characterIdsByHint.char_protagonist);

    // 验证故事世界演员已绑定真实 characterId 与快照版本
    const worldStore = new StoryWorldStore(database);
    const branchDetail = worldStore.detail(first.worldId, first.branchId);
    assert.equal(branchDetail.definition.actors[0]?.characterId, first.characterIdsByHint.char_protagonist);
    assert.equal(branchDetail.definition.actors[0]?.characterVersion, 1);

    // 验证文风指南与角色声纹已写入创作作用域策略
    const creativeStore = new CreativeStore(database);
    const branchPolicy = readCreativeScopePolicy(creativeStore, {
      workName: '星海测试集',
      worldId: first.worldId,
      branchId: first.branchId,
      projectId: null,
    });
    assert.equal(branchPolicy.policy.styleGuide?.tone, pack.styleGuide.tone);
    assert.deepEqual(
      branchPolicy.policy.characterVoices?.actor_protagonist?.voiceSamples,
      pack.characterVoices.actor_protagonist?.voiceSamples,
    );

    // 幂等重放：不重复创建世界、分支、故事线或角色档案
    const second = importStoryBodyPack(database, pack);
    assert.equal(second.worldId, first.worldId);
    assert.equal(second.branchId, first.branchId);
    assert.equal(second.projectId, first.projectId);
    assert.equal(second.charactersCreated, 0);
    assert.equal(second.charactersUpdated, 1);
    assert.equal(second.storyLinesCreated, 0);
  } finally {
    database.close();
  }
});

test('importStoryBodyPack completes pending sw_world_setups record and binds story project', () => {
  const database = new ServiceDatabase(':memory:');
  try {
    const worldStore = new StoryWorldStore(database);
    const setup = worldStore.createSetup({
      idempotencyKey: 'setup-demo-key',
      title: '原神测试',
      workNature: 'canon',
      parentWork: null,
    });

    const template = createUniversalStoryBlueprintTemplate('原神测试');
    template.setupId = setup.id;

    const result = importStoryBodyPack(database, template);
    assert.equal(result.worldId, setup.id);
    assert.equal(result.setupCompleted, true);

    const completedRow = database.connection.prepare(
      'SELECT completed_branch_id FROM sw_world_setups WHERE id=?',
    ).get(setup.id) as { completed_branch_id: string | null };
    assert.equal(completedRow.completed_branch_id, result.branchId);

    const bindingRow = database.connection.prepare(
      'SELECT world_id, branch_id FROM sw_project_bindings WHERE project_id=?',
    ).get(result.projectId) as { world_id: string; branch_id: string } | undefined;
    assert.equal(bindingRow?.world_id, setup.id);
    assert.equal(bindingRow?.branch_id, result.branchId);
  } finally {
    database.close();
  }
});
