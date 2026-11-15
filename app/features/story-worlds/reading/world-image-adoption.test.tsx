import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import type { WorldActor, WorldEvent, WorldImage, WorldLocation } from '@sthstart/contracts';
import { renderWithUi } from '../../../lib/render-with-ui-test';
import { WorldImageReader, worldImageAdoptInput } from './world-image-reader';

const actors: WorldActor[] = [{
  id: 'actor-a',
  name: '甲',
  role: 'main',
  characterId: null,
  characterVersion: null,
  background: '',
  personality: '',
  speechStyle: '',
  appearance: '',
  goals: [],
  locationId: 'loc-1',
  referenceArtifactIds: [],
}];

const locations: WorldLocation[] = [{ id: 'loc-1', name: '港口', description: '' }];

const event: WorldEvent = {
  id: 'evt-1',
  worldId: 'world-1',
  branchId: 'branch-1',
  tick: 30,
  duration: 0,
  title: '归港',
  summary: '船靠岸。',
  locationId: 'loc-1',
  participantIds: ['actor-a'],
  facts: [],
  perspectives: [],
  causeEventIds: [],
  storyLineIds: [],
  stateChanges: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function image(overrides: Partial<WorldImage> = {}): WorldImage {
  return {
    id: 'img-1',
    worldId: 'world-1',
    branchId: 'branch-1',
    eventId: 'evt-1',
    runId: null,
    phase: 'action',
    caption: '靠岸画面',
    prompt: 'prompt',
    negativePrompt: '',
    status: 'succeeded',
    generationTaskId: 'task-1',
    artifactId: 'artifact-1',
    imageUrl: '/api/admin/artifacts/artifact-1/file',
    error: '',
    referenceArtifactIds: [],
    consistencyNote: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('image adoption input carries the source event and existing artifact', () => {
  const input = worldImageAdoptInput(image(), event);
  assert.ok(input);
  assert.equal(input.artifactId, 'artifact-1');
  assert.equal(input.event.id, 'evt-1');
  assert.equal(input.disabled, false);
});

test('image adoption input rejects mismatched branches, foreign events and missing artifacts', () => {
  assert.equal(worldImageAdoptInput(image({ branchId: 'branch-2' }), event), null);
  assert.equal(worldImageAdoptInput(image({ eventId: 'evt-2' }), event), null);
  assert.equal(worldImageAdoptInput(image({ artifactId: null }), event), null);
  assert.equal(worldImageAdoptInput(image(), undefined), null);
});

test('unfinished images disable adoption without hiding the reason', () => {
  const input = worldImageAdoptInput(image({ status: 'running' }), event);
  assert.equal(input?.disabled, true);
});

test('reader renders the slot for succeeded images and a truthful note otherwise', () => {
  const calls: string[] = [];
  const html = renderWithUi(
    <WorldImageReader
      events={[event]}
      actors={actors}
      locations={locations}
      images={[image()]}
      adoptAction={(input) => {
        calls.push(input.artifactId);
        return <button type="button">加入项目</button>;
      }}
    />,
  );
  assert.deepEqual(calls, ['artifact-1']);
  assert.ok(html.includes('加入项目'));

  const unavailable = renderWithUi(
    <WorldImageReader
      events={[event]}
      actors={actors}
      locations={locations}
      images={[image({ status: 'planned', artifactId: null })]}
      adoptAction={() => <button type="button">加入项目</button>}
    />,
  );
  assert.ok(unavailable.includes('该分镜还没有可引用的媒体文件'));
  assert.ok(!unavailable.includes('>加入项目<'));
});

test('reader without an adopt slot keeps the previous layout', () => {
  const html = renderWithUi(
    <WorldImageReader
      events={[event]}
      actors={actors}
      locations={locations}
      images={[image()]}
    />,
  );
  assert.ok(!html.includes('加入创作项目'));
  assert.ok(html.includes('靠岸画面'));
});
