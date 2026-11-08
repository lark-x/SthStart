import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastify from 'fastify';
import { registerMediaLibraryRoutes } from './media-library.js';
import { ServiceDatabase, nowIso } from './database.js';
import type { ServiceConfig } from './config.js';

async function createFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sthstart-media-test-'));
  const database = new ServiceDatabase(':memory:');
  const adminToken = 'test-admin-secret-token';
  const config: ServiceConfig = {
    adminToken,
    artifactDirectory: dir,
  } as unknown as ServiceConfig;

  const app = fastify();
  registerMediaLibraryRoutes(app, config, database);
  await app.ready();

  return {
    app,
    database,
    config,
    dir,
    adminToken,
    async cleanup() {
      await app.close();
      database.close();
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

test('media-library routes enforce admin token authentication', async () => {
  const f = await createFixture();
  try {
    const unauthed = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library',
    });
    assert.equal(unauthed.statusCode, 401);

    const authed = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(authed.statusCode, 200);
    const body = authed.json();
    assert.equal(body.total, 0);
    assert.deepEqual(body.items, []);
  } finally {
    await f.cleanup();
  }
});

test('media-library correctly filters, paginates, protects paths and reports references', async () => {
  const f = await createFixture();
  try {
    const now = nowIso();

    // 注册需要的 apps: activities, creative-center, story
    f.database.connection.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('activities', '活动工作室', 'hash1', '["artifact"]', 1, ?, ?),
             ('creative-center', '图像工坊', 'hash2', '["artifact"]', 1, ?, ?),
             ('story', '剧情工作室', 'hash3', '["artifact"]', 1, ?, ?)
    `).run(now, now, now, now, now, now);

    // 建立 3 个真实与缺失文件
    const file1Path = join(f.dir, 'image1.png');
    await writeFile(file1Path, Buffer.from('fake-png-content-image1'));

    const file2Path = join(f.dir, 'video1.mp4');
    await writeFile(file2Path, Buffer.from('fake-mp4-content-video1'));

    const missingFilePath = join(f.dir, 'non-existent.png');

    // 插入 artifacts 数据
    f.database.connection.prepare(`
      INSERT INTO artifacts (
        id, app_id, content_type, byte_size, sha256, file_status,
        original_name, media_type, width, height, local_path, created_at
      ) VALUES
      ('art-img-1', 'activities', 'image/png', 24, 'sha-img-1', 'ready', 'cover.png', 'image', 800, 600, ?, ?),
      ('art-vid-1', 'creative-center', 'video/mp4', 24, 'sha-vid-1', 'ready', 'intro.mp4', 'video', 1920, 1080, ?, ?),
      ('art-missing-1', 'activities', 'image/png', 50, 'sha-missing-1', 'ready', 'lost.png', 'image', 400, 300, ?, ?)
    `).run(file1Path, '2026-11-04T10:00:00.000Z', file2Path, '2026-11-04T11:00:00.000Z', missingFilePath, '2026-11-04T09:00:00.000Z');

    // 插入引用数据
    f.database.connection.prepare(`
      INSERT INTO artifact_references (id, artifact_id, app_id, ref_type, ref_id, created_at)
      VALUES
      ('ref-1', 'art-img-1', 'activities', 'activity_asset', 'asset-42', ?),
      ('ref-2', 'art-img-1', 'story', 'story_cover', 'story-01', ?)
    `).run(now, now);

    // 查询列表
    const res = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.total, 3);
    assert.equal(data.items.length, 3);

    // 验证安全元数据：绝对不包含 local_path 或 storage_key
    for (const item of data.items) {
      assert.equal('local_path' in item, false);
      assert.equal('localPath' in item, false);
      assert.equal('storage_key' in item, false);
      assert.equal('storageKey' in item, false);
      assert.ok(item.appName);
      assert.ok(item.appHref);
      assert.ok(item.fileUrl);
    }

    // 验证缺失状态检测：art-missing-1 物理文件不存在，状态应解析为 missing
    const missingItem = data.items.find((i: Record<string, unknown>) => i.id === 'art-missing-1');
    assert.ok(missingItem);
    assert.equal(missingItem.fileStatus, 'missing');

    // 验证引用摘要
    const imgItem = data.items.find((i: Record<string, unknown>) => i.id === 'art-img-1');
    assert.ok(imgItem);
    assert.equal(imgItem.referenceSummary.totalCount, 2);
    assert.equal(imgItem.referenceSummary.appCounts.activities, 1);
    assert.equal(imgItem.referenceSummary.appCounts.story, 1);
    assert.equal(imgItem.appName, '制作');
    assert.equal(imgItem.appHref, '/apps/activities');

    // 测试按 mediaKind=video 筛选
    const videoRes = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library?mediaKind=video',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    const videoData = videoRes.json();
    assert.equal(videoData.total, 1);
    assert.equal(videoData.items[0].id, 'art-vid-1');
    assert.equal(videoData.items[0].mediaKind, 'video');

    // 测试按 status=missing 筛选
    const missingRes = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library?status=missing',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    const missingData = missingRes.json();
    assert.equal(missingData.total, 1);
    assert.equal(missingData.items[0].id, 'art-missing-1');

    // 测试分页 limit=1 offset=1
    const pagedRes = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library?limit=1&offset=1',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    const pagedData = pagedRes.json();
    assert.equal(pagedData.total, 3);
    assert.equal(pagedData.items.length, 1);
    assert.equal(pagedData.limit, 1);
    assert.equal(pagedData.offset, 1);

    // 测试搜索 q=cover
    const searchRes = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library?q=cover',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    const searchData = searchRes.json();
    assert.equal(searchData.total, 1);
    assert.equal(searchData.items[0].id, 'art-img-1');
  } finally {
    await f.cleanup();
  }
});

test('media-library file streaming requires admin and correctly returns 404 for missing', async () => {
  const f = await createFixture();
  try {
    const now = nowIso();
    f.database.connection.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('activities', '活动工作室', 'hash_act', '["artifact"]', 1, ?, ?)
    `).run(now, now);

    const file1Path = join(f.dir, 'stream-test.png');
    const content = Buffer.from('hello-world-media-stream-bytes');
    await writeFile(file1Path, content);

    const missingPath = join(f.dir, 'missing-file.png');

    f.database.connection.prepare(`
      INSERT INTO artifacts (
        id, app_id, content_type, byte_size, sha256, file_status, local_path, created_at
      ) VALUES
      ('art-stream', 'activities', 'image/png', ?, 'sha-stream', 'ready', ?, ?),
      ('art-lost', 'activities', 'image/png', 10, 'sha-lost', 'missing', ?, ?)
    `).run(content.length, file1Path, nowIso(), missingPath, nowIso());

    // 1. 无凭据请求文件 -> 401
    const unauthed = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-stream/file',
    });
    assert.equal(unauthed.statusCode, 401);

    // 2. 有凭据流式读取 -> 200
    const authed = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-stream/file',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(authed.statusCode, 200);
    assert.equal(authed.headers['content-type'], 'image/png');
    assert.equal(authed.rawPayload.toString(), 'hello-world-media-stream-bytes');

    // 3. 缺失文件 -> 404
    const lost = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-lost/file',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(lost.statusCode, 404);

    // 4. 不存在的 ID -> 404
    const notExist = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-non-existent/file',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(notExist.statusCode, 404);
  } finally {
    await f.cleanup();
  }
});


test('media-library range suffix bytes=-N and non-ready status enforcement', async () => {
  const f = await createFixture();
  try {
    const now = nowIso();
    f.database.connection.prepare(`INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at) VALUES ('activities', '活动工作室', 'hash_act', '[]', 1, ?, ?)`).run(now, now);
    const filePath = join(f.dir, 'range-test.dat');
    const fullContent = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'); // 36 bytes
    await writeFile(filePath, fullContent);

    const quarantinedPath = join(f.dir, 'quarantined.dat');
    await writeFile(quarantinedPath, Buffer.from('quarantined-danger'));

    f.database.connection.prepare(`
      INSERT INTO artifacts (
        id, app_id, content_type, byte_size, sha256, file_status, local_path, created_at,
        metadata_json, params_summary_json
      ) VALUES
      ('art-range', 'activities', 'application/octet-stream', ?, 'sha-range', 'ready', ?, ?,
       '{"prompt":"cat","adminToken":"secret-123","localPath":"/tmp/leak"}',
       '{"steps":20,"apiKey":"leak-token","dir":"/etc/passwd"}'),
      ('art-quarantine', 'activities', 'application/octet-stream', 18, 'sha-q', 'quarantined', ?, ?, '{}', '{}')
    `).run(fullContent.length, filePath, now, quarantinedPath, now);

    // 1. 标准范围 bytes=0-9
    const rangeStandard = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-range/file',
      headers: {
        'x-sthstart-admin-token': f.adminToken,
        range: 'bytes=0-9',
      },
    });
    assert.equal(rangeStandard.statusCode, 206);
    assert.equal(rangeStandard.headers['content-range'], 'bytes 0-9/36');
    assert.equal(rangeStandard.rawPayload.toString(), '0123456789');

    // 2. 后缀范围 bytes=-10 (倒数 10 字节: qrstuvwxyz)
    const rangeSuffix = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-range/file',
      headers: {
        'x-sthstart-admin-token': f.adminToken,
        range: 'bytes=-10',
      },
    });
    assert.equal(rangeSuffix.statusCode, 206);
    assert.equal(rangeSuffix.headers['content-range'], 'bytes 26-35/36');
    assert.equal(rangeSuffix.rawPayload.toString(), 'qrstuvwxyz');

    // 3. 超出范围 416
    const rangeInvalid = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-range/file',
      headers: {
        'x-sthstart-admin-token': f.adminToken,
        range: 'bytes=50-60',
      },
    });
    assert.equal(rangeInvalid.statusCode, 416);

    // 4. 非 ready (quarantined) 严格禁止访问实体文件 -> 403
    const quarantineFile = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library/art-quarantine/file',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(quarantineFile.statusCode, 403);
    assert.equal(quarantineFile.json().error, 'quarantined');

    // 5. 列表查询安全白名单过滤 metadata / paramsSummary
    const listRes = await f.app.inject({
      method: 'GET',
      url: '/api/v1/admin/media-library?q=art-range',
      headers: { 'x-sthstart-admin-token': f.adminToken },
    });
    assert.equal(listRes.statusCode, 200);
    const item = listRes.json().items.find((i: Record<string, unknown>) => i.id === 'art-range');
    assert.ok(item);
    assert.equal(item.metadata.prompt, 'cat');
    assert.equal('adminToken' in item.metadata, false);
    assert.equal('localPath' in item.metadata, false);
    assert.ok(Object.keys(item.metadata).every(key => ['prompt','negativePrompt','model','seed','steps','cfg','sampler','scheduler','width','height','duration','fps','workflowName'].includes(key)));
    assert.equal(item.paramsSummary.steps, 20);
    assert.equal('apiKey' in item.paramsSummary, false);
    assert.equal('dir' in item.paramsSummary, false);
  } finally {
    await f.cleanup();
  }
});

test('media-library uses the artifact id as a stable pagination tie-breaker', async () => {
  const f = await createFixture();
  try {
    const now = '2026-11-08T12:00:00.000Z';
    const filePath = join(f.dir, 'stable.png');
    await writeFile(filePath, Buffer.from('stable-order'));
    f.database.connection.prepare(`
      INSERT INTO managed_apps (id, name, token_hash, capabilities_json, enabled, created_at, updated_at)
      VALUES ('activities', '活动工作室', 'hash', '["artifact"]', 1, ?, ?)
    `).run(now, now);

    const insert = f.database.connection.prepare(`
      INSERT INTO artifacts (
        id, app_id, content_type, byte_size, sha256, file_status,
        original_name, media_type, width, height, local_path, created_at
      ) VALUES (?, 'activities', 'image/png', 12, ?, 'ready', ?, 'image', 10, 10, ?, ?)
    `);
    for (const id of ['art-tie-a', 'art-tie-b', 'art-tie-c', 'art-tie-d']) {
      insert.run(id, `sha-${id}`, `${id}.png`, filePath, now);
    }

    const visible: string[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const response = await f.app.inject({
        method: 'GET',
        url: `/api/v1/admin/media-library?limit=1&offset=${offset}`,
        headers: { 'x-sthstart-admin-token': f.adminToken },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.total, 4);
      visible.push(body.items[0].id);
    }
    assert.deepEqual(visible, ['art-tie-d', 'art-tie-c', 'art-tie-b', 'art-tie-a']);
    assert.equal(new Set(visible).size, 4);
  } finally {
    await f.cleanup();
  }
});
