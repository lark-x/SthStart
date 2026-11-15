import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type {
  PlaybackAction,
  PlaybackDocument,
  PlaybackRevision,
  MediaRevision,
} from '@sthstart/contracts';
import {
  MediaRevisionSchema,
  PlaybackDocumentSchema,
  PlaybackRevisionSchema,
} from '@sthstart/contracts';
import {
  ACTION_LABELS,
  actionLabels,
  formatTime,
  getDeviceDimensions,
  buildDevicePlaybackDoc,
  recalculateActionDurations,
  computePlaybackRevisionState,
  isPlaybackDocStale,
} from './model';

test('ACTION_LABELS defines standard Chinese translations and actionLabels compatibility export matches', () => {
  assert.equal(actionLabels, ACTION_LABELS);
  assert.equal(ACTION_LABELS['open_view'], '切换视图');
  assert.equal(ACTION_LABELS['scroll_to'], '滚动记录');
  assert.equal(ACTION_LABELS['open_media'], '展开媒体');
  assert.equal(ACTION_LABELS['close_media'], '关闭媒体');
  assert.equal(ACTION_LABELS['reveal_message'], '显示消息');
  assert.equal(ACTION_LABELS['reveal_comments'], '显示评论');
  assert.equal(ACTION_LABELS['typing'], '正在输入');
  assert.equal(ACTION_LABELS['stage_card'], '阶段说明');
});

test('formatTime correctly formats millisecond timestamps to mm:ss', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(999), '00:00');
  assert.equal(formatTime(1000), '00:01');
  assert.equal(formatTime(65000), '01:05');
  assert.equal(formatTime(3599000), '59:59');
  assert.equal(formatTime(3600000), '60:00');
});

test('getDeviceDimensions returns phone 9:16 and desktop 16:9 canvas and layout geometry', () => {
  const phone = getDeviceDimensions('phone');
  assert.equal(phone.canvasWidth, 1080);
  assert.equal(phone.canvasHeight, 1920);
  assert.equal(phone.layoutWidth, 360);
  assert.equal(phone.layoutHeight, 640);
  assert.equal(phone.outputWidth, 1080);
  assert.equal(phone.outputHeight, 1920);

  const desktop = getDeviceDimensions('desktop');
  assert.equal(desktop.canvasWidth, 1920);
  assert.equal(desktop.canvasHeight, 1080);
  assert.equal(desktop.layoutWidth, 1280);
  assert.equal(desktop.layoutHeight, 720);
  assert.equal(desktop.outputWidth, 1920);
  assert.equal(desktop.outputHeight, 1080);
});

test('buildDevicePlaybackDoc overrides output and layout dimensions for desktop and phone', () => {
  const baseDoc: PlaybackDocument = {
    schemaVersion: 1,
    contentRevisionId: 'rev-c-1',
    mediaRevisionId: 'none',
    template: { id: 'device-preview', version: '1' },
    viewerActorId: 'actor-1',
    totalDurationMs: 12000,
    layout: { width: 360, height: 640 },
    output: { fps: 30, width: 1080, height: 1920 },
    actions: [],
  };
  assert.equal(Value.Check(PlaybackDocumentSchema, baseDoc), true);

  const desktopDoc = buildDevicePlaybackDoc(baseDoc, 'desktop');
  assert.equal(desktopDoc.layout.width, 1280);
  assert.equal(desktopDoc.layout.height, 720);
  assert.equal(desktopDoc.output.width, 1920);
  assert.equal(desktopDoc.output.height, 1080);
  // Source object remains unmutated
  assert.equal(baseDoc.layout.width, 360);
  assert.equal(baseDoc.output.width, 1080);

  const phoneDoc = buildDevicePlaybackDoc(desktopDoc, 'phone');
  assert.equal(phoneDoc.layout.width, 360);
  assert.equal(phoneDoc.layout.height, 640);
  assert.equal(phoneDoc.output.width, 1080);
  assert.equal(phoneDoc.output.height, 1920);
});

test('recalculateActionDurations updates target action duration and shifts subsequent atMs sequentially', () => {
  const actions: PlaybackAction[] = [
    { id: 'action-0', type: 'open_view', view: 'chat', atMs: 0, durationMs: 1000 },
    { id: 'action-1', type: 'typing', atMs: 1000, durationMs: 2000 },
    { id: 'action-2', type: 'hold', atMs: 3000, durationMs: 1500 },
  ];

  const result = recalculateActionDurations(actions, 1, 3000);
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions[0]?.atMs, 0);
  assert.equal(result.actions[0]?.durationMs, 1000);

  assert.equal(result.actions[1]?.atMs, 1000);
  assert.equal(result.actions[1]?.durationMs, 3000);

  assert.equal(result.actions[2]?.atMs, 4000); // 1000 + 3000
  assert.equal(result.actions[2]?.durationMs, 1500);

  assert.equal(result.totalDurationMs, 5500); // 1000 + 3000 + 1500
});

test('computePlaybackRevisionState identifies matching and stale revisions', () => {
  const contentRevisionId = 'c-rev-1';
  const mediaRevision: MediaRevision = {
    id: 'm-rev-1',
    activityId: 'act-1',
    contentRevisionId: 'c-rev-1',
    slotBindings: [
      {
        slotId: 'slot-1',
        slotFingerprint: 'slot-fingerprint-1',
        assets: [{ assetKey: 'asset-1', order: 0 }],
      },
    ],
    hash: 'media-hash-1',
    createdAt: '2026-11-10T00:00:00Z',
  };
  assert.equal(Value.Check(MediaRevisionSchema, mediaRevision), true);

  const matchingPlaybackRevision: PlaybackRevision = {
    id: 'p-rev-1',
    activityId: 'act-1',
    contentRevisionId: 'c-rev-1',
    mediaRevisionId: 'm-rev-1',
    document: {
      schemaVersion: 1,
      contentRevisionId: 'c-rev-1',
      mediaRevisionId: 'm-rev-1',
      template: { id: 'default', version: '1' },
      viewerActorId: 'actor-1',
      totalDurationMs: 5000,
      layout: { width: 360, height: 640 },
      output: { fps: 30, width: 1080, height: 1920 },
      actions: [],
    },
    hash: 'playback-hash-1',
    createdAt: '2026-11-10T00:00:00Z',
  };
  assert.equal(Value.Check(PlaybackRevisionSchema, matchingPlaybackRevision), true);

  const matchState = computePlaybackRevisionState(
    contentRevisionId,
    matchingPlaybackRevision,
    mediaRevision
  );
  assert.equal(matchState.mediaRevisionMatchesContent, true);
  assert.equal(matchState.hasSelectedMedia, true);
  assert.equal(matchState.playbackMediaRevisionId, 'm-rev-1');
  assert.equal(matchState.currentPlaybackMatches, true);
  assert.equal(matchState.savedPlaybackIsStale, false);

  // Stale when content revision is updated to c-rev-2
  const staleState = computePlaybackRevisionState(
    'c-rev-2',
    matchingPlaybackRevision,
    mediaRevision
  );
  assert.equal(staleState.currentPlaybackMatches, false);
  assert.equal(staleState.savedPlaybackIsStale, true);

  // When no playback revision exists
  const noneState = computePlaybackRevisionState(contentRevisionId, null, mediaRevision);
  assert.equal(noneState.currentPlaybackMatches, false);
  assert.equal(noneState.savedPlaybackIsStale, false);
});

test('isPlaybackDocStale checks whether in-memory playback doc matches current content and media revision', () => {
  const doc: PlaybackDocument = {
    schemaVersion: 1,
    contentRevisionId: 'c-rev-1',
    mediaRevisionId: 'm-rev-1',
    template: { id: 'default', version: '1' },
    viewerActorId: 'actor-1',
    totalDurationMs: 5000,
    layout: { width: 360, height: 640 },
    output: { fps: 30, width: 1080, height: 1920 },
    actions: [],
  };

  const mediaRev: MediaRevision = {
    id: 'm-rev-1',
    activityId: 'act-1',
    contentRevisionId: 'c-rev-1',
    slotBindings: [{
      slotId: 's1',
      slotFingerprint: 's1-fingerprint',
      assets: [{ assetKey: 'a1', order: 0 }],
    }],
    hash: 'media-hash-2',
    createdAt: '2026-11-10T00:00:00Z',
  };
  assert.equal(Value.Check(PlaybackDocumentSchema, doc), true);
  assert.equal(Value.Check(MediaRevisionSchema, mediaRev), true);

  // Fresh
  assert.equal(
    isPlaybackDocStale(doc, 'c-rev-1', true, mediaRev, true),
    false
  );

  // Stale because content revision bumped
  assert.equal(
    isPlaybackDocStale(doc, 'c-rev-2', true, mediaRev, false),
    true
  );

  // Stale because media revision changed
  const newMediaRev: MediaRevision = { ...mediaRev, id: 'm-rev-2' };
  assert.equal(
    isPlaybackDocStale(doc, 'c-rev-1', true, newMediaRev, true),
    true
  );

  // Null doc is not stale
  assert.equal(
    isPlaybackDocStale(null, 'c-rev-1', true, mediaRev, true),
    false
  );
});
