import assert from 'node:assert/strict';
import test from 'node:test';
import { aiCallBusinessHref } from './business-href.js';

test('AI call links respect activity object type', () => {
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'planning-session', objectId: 'session 1' }),
    '/apps/activities/new?session=session%201');
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'activity-beat', objectId: 'activity-1:stage:scene:beat' }),
    '/apps/activities/activity-1');
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'activity', objectId: 'activity-1' }),
    '/apps/activities/activity-1');
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'unknown', objectId: 'not-an-activity' }), null);
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'activity-studio-job', objectId: 'activity-1:job 2' }),
    '/apps/activities/activity-1?tab=studio&studioJobId=job%202');
  assert.equal(aiCallBusinessHref({ applicationId: 'activities', objectType: 'activity-studio-job', objectId: 'activity-only' }), null);
  assert.equal(aiCallBusinessHref({ applicationId: 'characters', objectType: 'character', objectId: 'character-1' }),
    '/apps/characters/character-1');
});
