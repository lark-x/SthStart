import assert from 'node:assert/strict';
import test from 'node:test';
import { renderWithUi as renderToStaticMarkup } from '../../lib/render-with-ui-test';
import type { MediaLibraryItem } from '@sthstart/contracts';
import { MediaCard } from './components/media-card';

const item = (fileStatus: MediaLibraryItem['fileStatus']): MediaLibraryItem => ({
  id: 'artifact-1',
  appId: 'activities',
  appName: '制作',
  appHref: '/apps/activities',
  contentType: 'image/png',
  byteSize: 1024,
  sha256: null,
  fileStatus,
  originalName: 'cover.png',
  mediaType: 'image',
  mediaKind: 'image',
  width: 64,
  height: 64,
  durationMs: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: null,
  fileUrl: '/api/admin/media-library/artifact-1/file',
  references: [],
  referenceSummary: { totalCount: 0, appCounts: {}, topRefs: [] },
});

test('media card forwards artifact source and disabled state to the adopt slot', () => {
  const calls: Array<{ source: { kind: string; id: string }; disabled?: boolean }> = [];
  const adoptAction = (input: { source: { kind: string; id: string }; disabled?: boolean }) => {
    calls.push(input);
    return <button type="button">加入项目</button>;
  };

  const ready = renderToStaticMarkup(
    <MediaCard item={item('ready')} onPreview={() => {}} adoptAction={adoptAction} />
  );
  assert.ok(ready.includes('加入项目'), 'slot output is rendered');
  assert.deepEqual(calls[0], { source: { kind: 'artifact', id: 'artifact-1' }, disabled: false });

  const missing = renderToStaticMarkup(
    <MediaCard item={item('missing')} onPreview={() => {}} adoptAction={adoptAction} />
  );
  assert.ok(missing.includes('加入项目'), 'missing files still show the disabled slot');
  assert.equal(calls[1]?.disabled, true);
});

test('media card renders nothing extra when no adopt slot is injected', () => {
  const html = renderToStaticMarkup(<MediaCard item={item('ready')} onPreview={() => {}} />);
  assert.ok(!html.includes('加入项目'));
});
