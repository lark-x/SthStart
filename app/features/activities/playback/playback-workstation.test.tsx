import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderWithUi } from '../../../lib/render-with-ui-test';
import { PlaybackWorkstation as ReexportedPlaybackWorkstation } from '../components/playback-workstation';
import { PlaybackWorkstation } from './playback-workstation';
import { PlaybackToolbar } from './components/playback-toolbar';
import { PlaybackPreviewScreen } from './components/playback-preview-screen';
import { PlaybackTimelineInspector } from './components/playback-timeline-inspector';

test('playback-workstation re-export from components directory matches new playback module', () => {
  assert.equal(ReexportedPlaybackWorkstation, PlaybackWorkstation);
});

test('PlaybackToolbar renders title, generate, save, viewer select, layout buttons and duration', () => {
  const html = renderWithUi(
    <PlaybackToolbar
      onGenerateAuto={() => {}}
      onSavePlayback={() => {}}
      viewerActorId="act-1"
      onViewerActorChange={() => {}}
      actors={[{
        id: 'act-1',
        sourceCharacterId: 'c1',
        displayName: '主角',
        persona: {},
        activityRole: '主角',
        outfitDescription: '便装',
      }]}
      deviceLayout="phone"
      onDeviceLayoutChange={() => {}}
      speed={1}
      onSpeedChange={() => {}}
      playbackMode="by_stage"
      onPlaybackModeChange={() => {}}
      expandMedia={false}
      onExpandMediaChange={() => {}}
      selectedPresetId=""
      onSelectPreset={() => {}}
      onSavePreset={() => {}}
      presets={[]}
      totalDurationMs={30000}
      actionsCount={3}
    />
  );

  assert.ok(html.includes('回放编排与设备模拟预览'));
  assert.ok(html.includes('自动生成编排'));
  assert.ok(html.includes('保存回放版本'));
  assert.ok(html.includes('观众视角：'));
  assert.ok(html.includes('主角'));
  assert.ok(html.includes('设备布局：'));
  assert.ok(html.includes('手机'));
  assert.ok(html.includes('电脑'));
  assert.ok(html.includes('播放倍速：'));
  assert.ok(html.includes('总时长: 00:30 (3 个动作)'));
});

test('PlaybackPreviewScreen renders simulator frame and scrubber controls', () => {
  const boxRef = { current: null };
  const iframeRef = { current: null };

  const phoneHtml = renderWithUi(
    <PlaybackPreviewScreen
      deviceLayout="phone"
      previewBoxRef={boxRef}
      iframeRef={iframeRef}
      previewHtml="<div>preview</div>"
      previewHeight={600}
      canvasWidth={1080}
      canvasHeight={1920}
      previewScale={0.3}
      syncPreview={() => true}
      currentTimeMs={5000}
      totalDurationMs={30000}
      isPlaying={false}
      onSeek={() => {}}
      onReset={() => {}}
      onTogglePlay={() => {}}
    />
  );

  assert.ok(phoneHtml.includes('00:05'));
  assert.ok(phoneHtml.includes('00:30'));
  assert.ok(phoneHtml.includes('播放'));
  assert.ok(phoneHtml.includes('type="range"'));

  const desktopHtml = renderWithUi(
    <PlaybackPreviewScreen
      deviceLayout="desktop"
      previewBoxRef={boxRef}
      iframeRef={iframeRef}
      previewHtml=""
      previewHeight={240}
      canvasWidth={1920}
      canvasHeight={1080}
      previewScale={0.5}
      syncPreview={() => true}
      currentTimeMs={0}
      totalDurationMs={10000}
      isPlaying={true}
      onSeek={() => {}}
      onReset={() => {}}
      onTogglePlay={() => {}}
    />
  );

  assert.ok(desktopHtml.includes('暂停'));
  assert.ok(desktopHtml.includes('请先生成或保存回放脚本'));
});

test('PlaybackTimelineInspector renders empty state when actions list is empty', () => {
  const html = renderWithUi(
    <PlaybackTimelineInspector
      actions={[]}
      currentTimeMs={0}
      onUpdateActionDuration={() => {}}
    />
  );

  assert.ok(html.includes('当前尚无回放动作序列'));
  assert.ok(html.includes('回放动作序列 (0)'));
});

test('PlaybackTimelineInspector renders action items with labels and duration inputs', () => {
  const html = renderWithUi(
    <PlaybackTimelineInspector
      actions={[
        {
          id: 'a1',
          type: 'open_view',
          view: 'chat',
          atMs: 0,
          durationMs: 1200,
        },
        {
          id: 'a2',
          type: 'typing',
          atMs: 1200,
          durationMs: 800,
        },
      ]}
      currentTimeMs={500}
      onUpdateActionDuration={() => {}}
    />
  );

  assert.ok(html.includes('回放动作序列 (2)'));
  assert.ok(html.includes('切换视图'));
  assert.ok(html.includes('群聊'));
  assert.ok(html.includes('正在输入'));
  assert.ok(html.includes('value="1200"'));
  assert.ok(html.includes('value="800"'));
});
