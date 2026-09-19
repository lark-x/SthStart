import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ContentDocument, ActivityProductionOverview } from '@sthstart/contracts';
import { activityNextStep, imageSetupMessage } from './activity-guidance';

const fixture = () => JSON.parse(readFileSync('packages/activity-playback/fixtures/content_sample_v1.json', 'utf8')) as ContentDocument;
test('activity guidance starts with setup and then text, without requiring image configuration', () => {
  const doc = fixture();
  doc.messages = []; doc.posts = [];
  assert.equal(activityNextStep(doc).action, 'generate_text');
  doc.actors = [];
  assert.equal(activityNextStep(doc).action, 'settings');
});
test('activity guidance counts current draft content and allows preview without images', () => {
  const doc = fixture();
  doc.stages = [doc.stages[0]];
  doc.messages[0].stageId = doc.stages[0].id;
  const old = { suggestedStep: 'generate_text', unadoptedCandidates: [] } as unknown as ActivityProductionOverview;
  assert.equal(activityNextStep(doc, old).action, 'update_playback');
  old.unadoptedCandidates = [{ id: 'new' }] as ActivityProductionOverview['unadoptedCandidates'];
  assert.equal(activityNextStep(doc, old).action, 'review_candidates');
});
test('activity guidance translates image diagnostics instead of exposing raw status codes', () => {
  for (const code of ['not_configured', 'engine_disabled', 'unknown_internal_code']) {
    assert.ok(!imageSetupMessage(code).includes(code));
  }
});
