import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActivityDocument } from '@sthstart/contracts';
import { findBeatRenderTarget } from './beat-renders.js';

test('beat rendering keeps the primary avatar separate from all visible actors', () => {
  const document = buildActivityDocument({ templateId: 'blank', title: '多人镜头', type: '测试', theme: '', location: '', rules: '',
    actors: ['a', 'b'].map(id => ({ id, displayName: id, persona: {}, activityRole: '', outfitDescription: '' })) });
  const stage = document.stages[0];
  stage.scenes = [{ id: 's', title: '', timeText: '', locationText: '', beats: [
    { id: 'multi', characterId: 'a', actorIds: ['a', 'b'], action: '甲站着，乙坐着' },
    { id: 'legacy', characterId: 'a', action: '旧镜头' },
    { id: 'empty', characterId: 'narrator', actorIds: [], action: '风雪' },
    { id: 'bad', characterId: 'a', actorIds: ['missing'], action: '' },
  ] }];
  assert.deepEqual(findBeatRenderTarget(document, stage.id, 's', 'multi')?.actors.map(actor => actor.id), ['a', 'b']);
  assert.equal(findBeatRenderTarget(document, stage.id, 's', 'multi')?.actor?.id, 'a');
  assert.deepEqual(findBeatRenderTarget(document, stage.id, 's', 'legacy')?.actors.map(actor => actor.id), ['a']);
  assert.deepEqual(findBeatRenderTarget(document, stage.id, 's', 'empty')?.actors, []);
  assert.throws(() => findBeatRenderTarget(document, stage.id, 's', 'bad'), { code: 'beat_actor_not_found' });
});
