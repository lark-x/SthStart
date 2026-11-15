import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_TEMPLATES } from '@sthstart/contracts';
import type { ActorSnapshot, ResearchTask } from '@sthstart/contracts';
import {
  buildBlankActors,
  buildBlankActivityDocument,
  buildPlanningFormPayload,
  defaultIntake,
  mergeCast,
} from './intake-model';
import { activePlanPayload, mergeGeneratedPlans, selectedActorIds } from './plan-model';
import { appendReferences, parseReferenceSelections, referenceFromSelection, toReferenceSelections } from './references-model';
import { buildResearchSelectionPayload } from './research-model';
import { stepsDone, validateBlankActivity, validateGeneratePlans, validateStartResearch } from './steps';
import type { CustomLocation, ReferenceDraft } from './types';

test('intake keeps template defaults and mergeCast removes duplicates without mutating existing choices', () => {
  const intake = defaultIntake('birthday', '2026-11-10');
  assert.ok(ACTIVITY_TEMPLATES.some((template) => template.id === intake.templateId));
  assert.equal(intake.scheduledDate, '2026-11-10');
  assert.deepEqual(intake.cast, []);

  const first = { characterId: 'a', displayName: '甲' };
  const snapshots = [
    { id: 'actor-a', sourceCharacterId: 'a', displayName: '甲', persona: {} },
    { id: 'actor-b', sourceCharacterId: 'b', displayName: '乙', persona: {} },
  ] as ActorSnapshot[];
  const merged = mergeCast([first], snapshots, 2);
  assert.deepEqual(merged.map((member) => member.characterId), ['a', 'b']);
  assert.equal(merged[0], first);
  assert.deepEqual(mergeCast([first], snapshots, 1), [first]);
});

test('planning payload preserves entered text, optional omissions, frozen references and inspiration', () => {
  const intake = defaultIntake('blank', '');
  intake.title = '天台晚餐';
  intake.theme = '一起看灯';
  intake.location = '天台';
  intake.instruction = '  留出合照时间  ';
  intake.leadCharacterId = 'a';
  intake.cast = [{ characterId: 'a', displayName: '甲', activityRole: '主厨' }];
  intake.crossoverWorks = ['原神'];
  const references: ReferenceDraft[] = [{
    key: 'note:n1', sourceKind: 'note', sourceId: 'n1', usage: 'background', title: '食谱', excerpt: '旧摘要', pinnedExcerpt: '固定摘要',
  }];
  const payload = buildPlanningFormPayload({
    intake,
    references,
    templateActorMappings: { cook: ['a'] },
    inspiration: { ideaId: 'idea-1' } as never,
    selection: null,
    researchRevisionId: 'rev-2',
  });
  assert.equal(payload.instruction, '留出合照时间');
  assert.equal(payload.leadRoleLabel, 'activity-lead');
  assert.deepEqual(payload.templateActorMappings, { cook: ['a'] });
  assert.equal(payload.researchRevisionId, 'rev-2');
  assert.deepEqual(payload.references, [{ sourceKind: 'note', sourceId: 'n1', usage: 'background', excerptOverride: '固定摘要' }]);
  assert.ok(payload.inspiration);

  const empty = buildPlanningFormPayload({ intake: defaultIntake('blank', ''), references: [], selection: null, researchRevisionId: null });
  assert.equal('instruction' in empty, false);
  assert.equal('leadCharacterId' in empty, false);
  assert.equal('references' in empty, false);
  assert.equal('templateActorMappings' in empty, false);
});

test('blank creation maps character birthday ids to generated actor ids and keeps custom cast personas', () => {
  const intake = defaultIntake('birthday', '2026-11-10');
  intake.title = '  ';
  intake.leadCharacterId = 'a';
  intake.cast = [{ characterId: 'a', displayName: '甲' }];
  intake.birthdayIds = ['a', 'missing'];
  const snapshots = new Map<string, ActorSnapshot>([
    ['a', {
      id: 'actor-a',
      sourceCharacterId: 'a',
      displayName: '甲',
      persona: { summary: '甲' },
      activityRole: '参与者',
      outfitDescription: '',
      appearanceReferenceAssetKeys: [],
    }],
  ]);
  const actors = buildBlankActors({
    intake,
    customCast: [{ key: 'custom-1', displayName: '路人', activityRole: '', identity: '临时身份', outfitDescription: '便服' }],
    snapshots,
  });
  assert.deepEqual(actors.map((actor) => actor.id), ['actor-a', 'custom-1']);
  assert.equal(actors[1].displayName, '路人');
  assert.equal(actors[1].activityRole, '参与者');
  const { document, title } = buildBlankActivityDocument(intake, actors);
  assert.equal(title, '未命名活动');
  assert.equal(document.actors.length, 2);
  assert.deepEqual(document.activity.birthdayActorIds, ['actor-a']);
});

test('research selection normalizes pending status and writes unsaved custom locations once', () => {
  const customLocations: CustomLocation[] = [
    { id: 'saved-loc', name: '已保存', note: '', status: 'optional', locked: false },
    { id: 'new-loc', name: '新地点', note: '说明', status: 'required', locked: true },
  ];
  const task = {
    characterCandidates: [{ id: 'c1', userStatus: 'pending' }],
    locationCandidates: [
      { id: 'loc-1', userStatus: 'excluded', locked: false },
      { id: 'saved-loc', userStatus: 'pending', locked: false },
    ],
  } as ResearchTask;
  const selection = buildResearchSelectionPayload(task, customLocations);
  assert.deepEqual(selection.characters, [{ id: 'c1', status: 'optional' }]);
  assert.deepEqual(selection.locations, [
    { id: 'loc-1', status: 'excluded', locked: false },
    { id: 'saved-loc', status: 'optional', locked: false },
    { id: 'new-loc', status: 'required', locked: true },
  ]);
  assert.deepEqual(selection.addLocations, [{ id: 'new-loc', name: '新地点', note: '说明', status: 'required', locked: true }]);
});

test('references deduplicate by source, malformed source parameters are ignored and edits choose the active plan', () => {
  const first: ReferenceDraft = { key: 'note:n1', sourceKind: 'note', sourceId: 'n1', usage: 'background', title: 'A', excerpt: 'a' };
  const duplicate: ReferenceDraft = { ...first, title: 'B' };
  const second: ReferenceDraft = { key: 'topic:t1', sourceKind: 'topic', sourceId: 't1', usage: 'requirement', title: 'C', excerpt: 'c' };
  assert.deepEqual(appendReferences([first], [duplicate, second]).map((item) => item.key), ['note:n1', 'topic:t1']);
  assert.equal(parseReferenceSelections('note:n1,unknown:x,collection:').length, 1);

  const plans = [
    { id: 'p1', payload: { activity: { title: '原方案' }, actorRoles: [], stages: [] } },
    { id: 'p2', payload: { activity: { title: '第二份' }, actorRoles: [], stages: [] } },
  ] as never;
  const edited = { activity: { title: '编辑后' }, actorRoles: [{ actorId: 'a1' }], stages: [{ actorIds: ['a2'] }] } as never;
  assert.equal(activePlanPayload(plans, 'p1', { candidateId: 'p1', payload: edited as never })?.activity.title, '编辑后');
  assert.deepEqual([...selectedActorIds(edited as never)], ['a1', 'a2']);
  assert.deepEqual(
    mergeGeneratedPlans({ plans, generated: [{ id: 'p1', payload: { activity: { title: '新版本' } } }] as never, keepExisting: true })
      .map((plan) => plan.payload.activity.title),
    ['原方案', '第二份'],
  );
});

test('restoring a session keeps a pinned excerpt tied to the frozen source version', () => {
  const frozen = {
    id: 'ref-1', sourceKind: 'note', sourceId: 'n1', contentHash: 'hash', title: '旧标题', usage: 'background',
    nature: '原作资料', authorship: '原作', excerpt: '新正文', evidence: [],
  };
  const draft = referenceFromSelection({
    sourceKind: 'note', sourceId: 'n1', usage: 'requirement', excerptOverride: '固定正文', frozenReference: frozen as never,
  }, { schemaVersion: 1, capturedAt: '2026-11-10', references: [frozen as never] });
  assert.equal(draft.title, '旧标题');
  assert.equal(draft.excerpt, '固定正文');
  assert.equal(draft.pinnedExcerpt, '固定正文');
  assert.equal(draft.frozenReference, frozen);
  assert.deepEqual(toReferenceSelections([draft]), [{
    sourceKind: 'note', sourceId: 'n1', usage: 'requirement', excerptOverride: '固定正文', frozenReference: frozen,
  }]);
});

test('step validation and completion reflect the real blockers and retained prior inputs', () => {
  const intake = defaultIntake('blank', '');
  assert.equal(validateStartResearch(intake), '请先选择至少一位参与角色。');
  intake.cast = [{ characterId: 'a', displayName: '甲' }];
  assert.equal(validateStartResearch(intake), '请至少选择一个资料源，或改用「跳过检索，直接构思」。');
  intake.sourceIds = ['src'];
  assert.equal(validateStartResearch(intake), null);
  assert.equal(validateGeneratePlans(intake), null);
  assert.equal(validateBlankActivity(0), '请先选择至少一位参与角色，或添加自定义参与者。');
  assert.equal(validateBlankActivity(1), null);
  assert.equal(stepsDone({ index: 0, sessionId: 's', planCount: 0, selectedPlanId: null }), true);
  assert.equal(stepsDone({ index: 1, sessionId: 's', planCount: 2, selectedPlanId: null }), true);
  assert.equal(stepsDone({ index: 2, sessionId: 's', planCount: 2, selectedPlanId: 'p1' }), true);
  assert.equal(stepsDone({ index: 3, sessionId: 's', planCount: 2, selectedPlanId: 'p1' }), false);
});
