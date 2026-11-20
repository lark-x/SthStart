import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldDefinition, WorldHubDocSummary } from '@sthstart/contracts';
import {
  buildAiStudioHref,
  groupActorsByFaction,
  groupLocationsByRegion,
  parseOpenThreadsFromDocs,
} from './world-hub-shared';

const sampleDefinition: WorldDefinition = {
  title: '测试世界',
  summary: '概述',
  timeLabel: '间隙窗口',
  regions: [
    { id: 'reg_a', name: '蒙德', description: '风之城' },
  ],
  factions: [
    { id: 'fac_1', name: '列车组', description: '同行' },
  ],
  locations: [
    { id: 'loc_1', name: '风起地', description: '大橡树', regionId: 'reg_a', region: '蒙德', tier: 'sublocation' },
    { id: 'loc_2', name: '未分区点', description: '散落点' },
  ],
  actors: [
    {
      id: 'act_1',
      name: '开拓者',
      role: 'main',
      factionId: 'fac_1',
      faction: '列车组',
      characterId: null,
      characterVersion: null,
      background: '',
      personality: '',
      speechStyle: '',
      appearance: '',
      goals: [],
      locationId: 'loc_1',
      referenceArtifactIds: [],
    },
    {
      id: 'act_2',
      name: '路人',
      role: 'supporting',
      characterId: null,
      characterVersion: null,
      background: '',
      personality: '',
      speechStyle: '',
      appearance: '',
      goals: [],
      locationId: 'loc_2',
      referenceArtifactIds: [],
    },
  ],
  sources: [],
  lockedFacts: [],
  models: { action: null, adjudication: null, narration: null },
  visualStyle: '',
};

test('groupLocationsByRegion and groupActorsByFaction preserve hierarchy and fallback groups', () => {
  const regions = groupLocationsByRegion(sampleDefinition);
  assert.equal(regions.length, 2);
  assert.equal(regions[0]?.name, '蒙德');
  assert.equal(regions[0]?.locations[0]?.id, 'loc_1');
  assert.equal(regions[1]?.name, '常规舞台');

  const factions = groupActorsByFaction(sampleDefinition);
  assert.equal(factions.length, 2);
  assert.equal(factions[0]?.name, '列车组');
  assert.equal(factions[1]?.name, '核心阵容');
});

test('parseOpenThreadsFromDocs extracts triggers and detail cleanly', () => {
  const docs: WorldHubDocSummary[] = [
    {
      id: 'd1',
      kind: 'world',
      title: '开放伏笔与触发词账本',
      body: '## 1. 冰封记忆 【触发词：三月七, 六相冰, 照相机】\n\n细节说明正文。',
      position: 0,
      revision: 1,
      updatedAt: '2026-11-17T00:00:00Z',
      wordCount: 30,
    },
  ];
  const parsed = parseOpenThreadsFromDocs(docs);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.title, '冰封记忆');
  assert.deepEqual(parsed[0]?.triggers, ['三月七', '六相冰', '照相机']);
  assert.equal(parsed[0]?.detail, '细节说明正文。');
});

test('buildAiStudioHref preserves world, branch, project, and arc parameters', () => {
  const href = buildAiStudioHref({
    workName: '原神',
    worldId: 'w1',
    branchId: 'b1',
    projectId: 'p1',
    arcId: 'a1',
    arcTitle: '七国暗流',
  });
  assert.ok(href.includes('/apps/ai-studio?'));
  assert.ok(href.includes('worldId=w1'));
  assert.ok(href.includes('branchId=b1'));
  assert.ok(href.includes('projectId=p1'));
  assert.ok(href.includes('arcId=a1'));
});
