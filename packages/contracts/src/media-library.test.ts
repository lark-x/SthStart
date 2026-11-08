import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import {
  MediaLibraryQuerySchema,
  MediaLibraryResponseSchema,
  inferMediaKind,
  resolveAppMeta,
} from './media-library.js';

test('inferMediaKind correctly categorizes types', () => {
  assert.equal(inferMediaKind('image/png', null), 'image');
  assert.equal(inferMediaKind(null, 'video/mp4'), 'video');
  assert.equal(inferMediaKind('audio/wav', null), 'audio');
  assert.equal(inferMediaKind('application/pdf', null), 'file');
  assert.equal(inferMediaKind(null, null), 'file');
});

test('resolveAppMeta maps known and unknown apps', () => {
  assert.deepEqual(resolveAppMeta('activities'), { name: '制作', href: '/apps/activities' });
  assert.deepEqual(resolveAppMeta('creative-center'), { name: '自由生成', href: '/apps/creative' });
  assert.deepEqual(resolveAppMeta('custom-app', '自定义应用'), { name: '自定义应用', href: '/apps/media?appId=custom-app' });
});

test('MediaLibraryQuerySchema validates valid inputs', () => {
  assert.equal(Value.Check(MediaLibraryQuerySchema, { q: 'test', mediaKind: 'image', limit: 20, offset: 0 }), true);
  assert.equal(Value.Check(MediaLibraryQuerySchema, { limit: 200 }), false);
});

test('MediaLibraryResponseSchema validates item structure', () => {
  const sample = {
    items: [
      {
        id: 'art-1',
        appId: 'activities',
        appName: '活动工作室',
        appHref: '/apps/activities',
        contentType: 'image/png',
        byteSize: 1024,
        sha256: 'abc123',
        fileStatus: 'ready' as const,
        originalName: 'cover.png',
        mediaType: 'image/png',
        mediaKind: 'image' as const,
        width: 800,
        height: 600,
        durationMs: null,
        createdAt: '2026-11-04T00:00:00.000Z',
        updatedAt: null,
        fileUrl: '/api/v1/admin/media-library/art-1/file',
        thumbnailUrl: null,
        references: [
          { appId: 'activities', appName: '活动工作室', refType: 'activity_asset', refId: 'act-1' }
        ],
        referenceSummary: {
          totalCount: 1,
          appCounts: { activities: 1 },
          topRefs: ['活动工作室:activity_asset:act-1'],
        },
      }
    ],
    total: 1,
    limit: 50,
    offset: 0,
  };
  assert.equal(Value.Check(MediaLibraryResponseSchema, sample), true);
});

