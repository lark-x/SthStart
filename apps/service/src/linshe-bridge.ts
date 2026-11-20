import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  LinsheGalleryImageRequestSchema,
  LinsheGalleryImageResponseSchema,
  type LinsheGalleryImageRequest,
  type LinsheGalleryImageResponse,
  type LinsheBridgeStatus,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { streamUploadArtifact } from './artifacts.js';
import { syncCharacterSnapshotAfterChange } from './characters/snapshots.js';
import { toCharacterRuntime } from '@sthstart/contracts';
import { authenticateApp, hasCapability } from './access.js';

export function resolveLinsheImageUrl(value: string, baseUrl: string) {
  const decodedInput = decodeURIComponent(value);
  if (decodedInput.includes('\\') || decodedInput.split('/').some(part => part === '.' || part === '..')) throw new Error('invalid_linshe_image_url');
  const url = new URL(value, baseUrl);
  if (url.origin !== new URL(baseUrl).origin || url.username || url.password || url.search || url.hash) throw new Error('invalid_linshe_image_url');
  const decoded = decodeURIComponent(url.pathname);
  if (decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) throw new Error('invalid_linshe_image_url');
  if (!/^\/images\/(?:[a-z_]+\/)?[^/]+\.(?:png|jpe?g|webp|avif|gif)$/i.test(decoded)
    && !/^\/api\/images\/artifacts\/[a-zA-Z0-9_-]+$/.test(decoded)) throw new Error('invalid_linshe_image_url');
  return url.href;
}

export function registerLinsheBridgeRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  fetcher: typeof fetch = fetch,
) {
  const linsheBaseUrl = `http://127.0.0.1:${config.linsheAgentPort}`;
  const pendingGallery = new Map<string, Promise<LinsheGalleryImageResponse>>();

  app.post<{ Body: LinsheGalleryImageRequest }>('/api/v1/linshe/gallery-images', {
    schema: { body: LinsheGalleryImageRequestSchema, response: { 200: LinsheGalleryImageResponseSchema, 201: LinsheGalleryImageResponseSchema } },
  }, async (request, reply) => {
    const identity = authenticateApp(database, request);
    if (!identity) return reply.code(401).send({ error: 'invalid_app_token' });
    if (identity.id !== 'linshe' || !hasCapability(identity, 'artifact')) return reply.code(403).send({ error: 'capability_denied' });
    let fetchUrl: string;
    try { fetchUrl = resolveLinsheImageUrl(request.body.imageUrl, linsheBaseUrl); }
    catch { return reply.code(400).send({ error: 'invalid_linshe_image_url' }); }
    const { sourceImageId, characterId, title, metadata } = request.body;
    const existing = database.connection.prepare('SELECT shared_asset_id FROM linshe_gallery_imports WHERE source_image_id=?').get(sourceImageId) as { shared_asset_id: string } | undefined;
    if (existing) return { sharedAssetId: existing.shared_asset_id, created: false };
    const inFlight = pendingGallery.get(sourceImageId);
    if (inFlight) {
      try { return { ...await inFlight, created: false }; }
      catch { return reply.code(502).send({ error: 'linshe_gallery_return_failed', message: '邻舍图片回流暂时失败，请重试。' }); }
    }
    if (characterId && !database.connection.prepare('SELECT 1 FROM character_profiles WHERE id=?').get(characterId)) return reply.code(400).send({ error: 'character_not_found' });
    const work = (async (): Promise<LinsheGalleryImageResponse> => {
      const response = await fetcher(fetchUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok || !response.body) throw new Error('linshe_image_unavailable');
      const contentType = (response.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(png|jpeg|webp|avif|gif)$/.test(contentType)) throw new Error('invalid_image_content_type');
      const id = randomUUID();
      const now = nowIso();
      const cleanTitle = title?.trim() || `邻舍图片 ${sourceImageId.slice(-12)}`;
      const extension = contentType === 'image/jpeg' ? 'jpg' : contentType.slice(6);
      const artifact = await streamUploadArtifact(config, database, {
        appId: 'linshe', stream: Readable.fromWeb(response.body as any), contentType,
        originalName: `${id}.${extension}`, refType: 'shared-asset', refId: id,
        metadata: { sourceImageId, source: 'linshe-generated' },
      });
      database.transaction(() => {
        database.connection.prepare(`INSERT INTO shared_assets(id,title,category,artifact_id,character_ids_json,tags_json,metadata_json,author_note,user_note,source_page,source_url,created_at,updated_at)
          VALUES (?,?,'other',?,?,'[]',?,'邻舍生成后自动回流','','linshe-generated',?,?,?)`)
          .run(id, cleanTitle, artifact.id, JSON.stringify(characterId ? [characterId] : []), JSON.stringify({ ...metadata, sourceImageId }), request.body.imageUrl, now, now);
        database.connection.prepare('INSERT INTO linshe_gallery_imports(source_image_id,shared_asset_id,created_at) VALUES(?,?,?)').run(sourceImageId, id, now);
      });
      return { sharedAssetId: id, created: true };
    })();
    pendingGallery.set(sourceImageId, work);
    try { const result = await work; return reply.code(201).send(result); }
    catch (error) { return reply.code(502).send({ error: 'linshe_gallery_return_failed', message: error instanceof Error ? error.message : String(error) }); }
    finally { pendingGallery.delete(sourceImageId); }
  });

  // GET /api/v1/admin/linshe-bridge/status — 查询数据互通状态与已关联角色
  app.get('/api/v1/admin/linshe-bridge/status', async (request, reply) => {

    let linsheAvailable = false;
    try {
      const ping = await fetcher(`${linsheBaseUrl}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      linsheAvailable = ping.ok;
    } catch {
      linsheAvailable = false;
    }

    const charactersCountRow = database.connection
      .prepare('SELECT COUNT(*) as c FROM character_profiles WHERE archived=0')
      .get() as { c: number };
    const sharedAssetsCountRow = database.connection
      .prepare('SELECT COUNT(*) as c FROM shared_assets')
      .get() as { c: number };

    const links = database.connection
      .prepare(`
        SELECT l.character_id, l.local_id, l.source_version, p.display_name, p.latest_version
        FROM app_character_links l
        JOIN character_profiles p ON p.id = l.character_id
        WHERE l.app_id = 'linshe'
      `)
      .all() as {
        character_id: string;
        local_id: string;
        source_version: number;
        display_name: string;
        latest_version: number | null;
      }[];

    const linkedCharacters = links.map((l) => ({
      sthCharacterId: l.character_id,
      linsheCharacterId: l.local_id,
      displayName: l.display_name,
      sourceVersion: l.source_version,
      latestVersion: l.latest_version || l.source_version,
      hasUpdate: (l.latest_version || 0) > l.source_version,
    }));

    const status: LinsheBridgeStatus = {
      ready: true,
      linsheAvailable,
      charactersCount: charactersCountRow?.c ?? 0,
      sharedAssetsCount: sharedAssetsCountRow?.c ?? 0,
      linkedCharacters,
    };

    return status;
  });

  // POST /api/v1/admin/linshe-bridge/sync-character — 单向权威推送到邻舍（方式 A：SthStart 唯一权威）
  app.post<{
    Body: {
      characterId: string;
      action: 'push_to_linshe';
      force?: boolean;
    };
  }>('/api/v1/admin/linshe-bridge/sync-character', async (request, reply) => {
    const { characterId, action, force } = request.body || {};
    if (!characterId) return reply.code(400).send({ error: 'character_id_required' });
    if (action !== 'push_to_linshe') {
      return reply.code(400).send({ error: 'unsupported_action', message: 'SthStart 为唯一人设权威源，仅支持推送更新到邻舍。' });
    }

    const profile = database.connection
      .prepare('SELECT * FROM character_profiles WHERE id=?')
      .get(characterId) as Record<string, unknown> | undefined;
    if (!profile) return reply.code(404).send({ error: 'character_not_found' });

    // Original characters only deliver an explicitly published stage. Other origins
    // keep their automatic authority snapshot current, including asset-only changes.
    let version = profile.latest_version ? Number(profile.latest_version) : null;
    if (toCharacterRuntime(JSON.parse(String(profile.draft_json))).originType !== 'original') {
      const snapshot = syncCharacterSnapshotAfterChange(database, characterId);
      if (snapshot) version = snapshot.version;
    }
    if (!version) return reply.code(409).send({ error: 'published_stage_required', message: '原创角色尚无已发布阶段，请先在 SthStart 角色库保存一个阶段，再推送到邻舍。' });

    const link = database.connection
      .prepare('SELECT local_id FROM app_character_links WHERE app_id=? AND character_id=?')
      .get('linshe', characterId) as { local_id: string } | undefined;

    try {
      if (link?.local_id) {
        const updateRes = await fetcher(`${linsheBaseUrl}/api/characters/${encodeURIComponent(link.local_id)}/update-public`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: Boolean(force), version }),
          signal: AbortSignal.timeout(10000),
        });
        const updateBody = (await updateRes.json().catch(() => ({}))) as Record<string, any>;
        if (!updateRes.ok) {
          return reply.code(updateRes.status).send({
            ok: false,
            action,
            characterId,
            message: updateBody.message || updateBody.error || `邻舍更新失败 HTTP ${updateRes.status}`,
          });
        }
        return {
          ok: true,
          action,
          characterId,
          localId: link.local_id,
          version,
          message: `已将【${profile.display_name}】最新权威人设与皮肤参照推送到邻舍（v${version}）`,
        };
      }
      const importRes = await fetcher(`${linsheBaseUrl}/api/characters/import-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId, version }),
        signal: AbortSignal.timeout(10000),
      });
      const importBody = (await importRes.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!importRes.ok) {
        return reply.code(importRes.status).send({
          ok: false,
          action,
          characterId,
          message: importBody.error || `邻舍招募失败 HTTP ${importRes.status}`,
        });
      }
      return {
        ok: true,
        action,
        characterId,
        localId: String(importBody.id || ''),
        version,
        message: `已将【${profile.display_name}】招募入驻邻舍！`,
      };
    } catch (err: any) {
      return reply.code(502).send({
        ok: false,
        action,
        characterId,
        message: `无法连接到邻舍服务 (${linsheBaseUrl}): ${err.message}`,
      });
    }
  });

  // GET /api/v1/admin/linshe-bridge/gallery — 浏览邻舍相册图片
  app.get<{
    Querystring: {
      folder?: string;
      character?: string;
    };
  }>('/api/v1/admin/linshe-bridge/gallery', async (request, reply) => {
    try {
      const queryParams = new URLSearchParams();
      if (request.query.folder) queryParams.set('folder', request.query.folder);
      if (request.query.character) queryParams.set('character', request.query.character);

      const res = await fetcher(`${linsheBaseUrl}/api/images/gallery?${queryParams.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'linshe_gallery_failed' });
      }
      const data = (await res.json()) as { images?: any[] };
      const images = (data.images || []).map((img: any) => ({
        ...img,
        fullUrl: `${linsheBaseUrl}${img.url}`,
      }));
      return { images };
    } catch (err: any) {
      return reply.code(502).send({ error: 'linshe_unreachable', message: err.message });
    }
  });

  // POST /api/v1/admin/linshe-bridge/import-gallery-image — 将邻舍生图转存为 SthStart 资产
  app.post<{
    Body: {
      imageUrl: string;
      target: 'character' | 'shared';
      characterId?: string;
      characterIds?: string[];
      category?: string;
      title?: string;
      tags?: string[];
      setAsActive?: 'avatar' | 'portrait';
    };
  }>('/api/v1/admin/linshe-bridge/import-gallery-image', async (request, reply) => {
    const { imageUrl, target, characterId, characterIds, category, title, tags, setAsActive } = request.body || {};
    if (!imageUrl) return reply.code(400).send({ error: 'image_url_required' });

    let fetchUrl: string;
    try { fetchUrl = resolveLinsheImageUrl(imageUrl, linsheBaseUrl); }
    catch { return reply.code(400).send({ error: 'invalid_linshe_image_url' }); }
    let imgRes: Response;
    try {
      imgRes = await fetcher(fetchUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!imgRes.ok) {
        return reply.code(imgRes.status).send({ error: 'fetch_image_failed' });
      }
    } catch (err: any) {
      return reply.code(502).send({ error: 'cannot_fetch_image', message: err.message });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const extension = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const id = randomUUID();
    const now = nowIso();
    const cleanTitle = (title || `Linshe_${Date.now()}`).slice(0, 200);
    const originalName = `${cleanTitle}.${extension}`;

    if (target === 'shared') {
      const selectedCategory = category || 'other';
      const cids = Array.isArray(characterIds) ? characterIds : characterId ? [characterId] : [];
      const tagList = Array.isArray(tags) ? tags : [];

      const artifact = await streamUploadArtifact(config, database, {
        appId: 'characters',
        stream: Readable.from([buffer]),
        contentType,
        originalName,
        refType: 'shared-asset',
        refId: id,
        metadata: { title: cleanTitle, category: selectedCategory, characterIds: cids },
      });

      database.connection.prepare(`
        INSERT INTO shared_assets
          (id, title, category, artifact_id, character_ids_json, tags_json, metadata_json,
           author_note, user_note, source_page, source_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '从邻舍生图转存', '', 'linshe-gallery', ?, ?, ?)
      `).run(
        id, cleanTitle, selectedCategory, artifact.id,
        JSON.stringify(cids), JSON.stringify(tagList), '{}', imageUrl, now, now
      );

      return reply.code(201).send({
        ok: true,
        id,
        url: `/api/admin/shared-assets/file/${id}`,
        title: cleanTitle,
      });
    } else {
      if (!characterId) return reply.code(400).send({ error: 'character_id_required_for_character_target' });
      const selectedCategory = category || 'cg';
      const kind = selectedCategory === 'avatar' ? 'avatar' : selectedCategory === 'portrait' ? 'portrait' : 'reference';
      const tagList = Array.isArray(tags) ? tags : [];

      const artifact = await streamUploadArtifact(config, database, {
        appId: 'characters',
        stream: Readable.from([buffer]),
        contentType,
        originalName,
        refType: 'character-asset',
        refId: id,
        metadata: { characterId, kind, category: selectedCategory },
      });

      database.connection.prepare(`
        INSERT INTO character_assets
          (id, character_id, kind, created_at, artifact_id, source_page, source_url, author_note, user_note, category, title, tags_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, 'linshe-gallery', ?, '从邻舍生图转存', '', ?, ?, ?, '{}')
      `).run(
        id, characterId, kind, now, artifact.id, imageUrl, selectedCategory, cleanTitle, JSON.stringify(tagList)
      );

      if (setAsActive === 'avatar') {
        database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?, updated_at=? WHERE id=?').run(id, now, characterId);
      } else if (setAsActive === 'portrait') {
        database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?, updated_at=? WHERE id=?').run(id, now, characterId);
      }
      syncCharacterSnapshotAfterChange(database, characterId, { incrementRevision: true });

      return reply.code(201).send({
        ok: true,
        id,
        url: `/api/admin/characters/assets/${id}`,
        title: cleanTitle,
      });
    }
  });

  // GET /api/v1/admin/linshe-bridge/characters — 读取邻舍全部角色（含运行状态与 SthStart 关联）
  app.get('/api/v1/admin/linshe-bridge/characters', async (request, reply) => {
    try {
      let linsheChars: any[] = [];
      try {
        const scheduleRes = await fetcher(`${linsheBaseUrl}/api/schedule`, {
          signal: AbortSignal.timeout(4000),
        });
        if (scheduleRes.ok) {
          const scheduleData = (await scheduleRes.json()) as { characters?: any[] };
          linsheChars = scheduleData.characters || [];
        }
      } catch {
        // Fallback to /api/characters
      }

      if (linsheChars.length === 0) {
        const charsRes = await fetcher(`${linsheBaseUrl}/api/characters`, {
          signal: AbortSignal.timeout(4000),
        });
        if (charsRes.ok) {
          const charsData = (await charsRes.json()) as { characters?: any[] };
          linsheChars = charsData.characters || [];
        }
      }

      // 查询本地 app_character_links
      const links = database.connection
        .prepare(`
          SELECT l.character_id, l.local_id, l.source_version, p.display_name, p.latest_version
          FROM app_character_links l
          JOIN character_profiles p ON p.id = l.character_id
          WHERE l.app_id = 'linshe'
        `)
        .all() as {
          character_id: string;
          local_id: string;
          source_version: number;
          display_name: string;
          latest_version: number | null;
        }[];

      const linkMap = new Map<string, { id: string; displayName: string; latestVersion: number | null }>();
      for (const link of links) {
        linkMap.set(String(link.local_id), {
          id: link.character_id,
          displayName: link.display_name,
          latestVersion: link.latest_version,
        });
      }

      const characters = linsheChars.map((c) => {
        const rawAct = c.current_activity || '';
        const sep = rawAct.indexOf(' · ');
        const location = sep > -1 ? rawAct.slice(0, sep) : rawAct;
        const behavior = sep > -1 ? rawAct.slice(sep + 3) : rawAct;
        const noSchedule = !rawAct || rawAct === '未设置日程';

        const sthLink = linkMap.get(String(c.id));

        // 头像通过本地 bridge asset 代理，确保跨源和鉴权顺畅
        const avatarUrl = c.avatar_path
          ? (c.avatar_path.startsWith('http')
              ? c.avatar_path
              : `/api/admin/linshe-bridge/asset?url=${encodeURIComponent(c.avatar_path)}`)
          : null;

        return {
          id: c.id,
          display_name: c.display_name || c.name || '未命名角色',
          name: c.name || c.display_name || 'unknown',
          avatar_path: c.avatar_path,
          avatarUrl,
          current_activity: c.current_activity || '自由行动',
          _location: noSchedule ? '未知地点' : (location || '未知地点'),
          _behavior: noSchedule ? '自由行动' : (behavior || '暂无信息'),
          _description: c._desc || (!noSchedule ? behavior : '') || (noSchedule ? '自由行动中...' : ''),
          is_sleeping: Boolean(c.is_sleeping),
          is_temp_woken: Boolean(c.is_temp_woken),
          was_door_woken: Number(c.was_door_woken || 0),
          wake_attempts: Number(c.wake_attempts || 0),
          reply_delay: Number(c.reply_delay || 0),
          pinned: Boolean(c.pinned),
          tags: Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' && c.tags ? c.tags.split(',') : []),
          sthLink: sthLink || null,
        };
      });

      return { characters };
    } catch (err: any) {
      return reply.code(502).send({ error: 'linshe_unreachable', message: err.message });
    }
  });

  // GET /api/v1/admin/linshe-bridge/asset — 静态资产/头像安全代理
  app.get<{
    Querystring: {
      url?: string;
    };
  }>('/api/v1/admin/linshe-bridge/asset', async (request, reply) => {
    const rawUrl = request.query.url;
    if (!rawUrl) return reply.code(400).send({ error: 'url_param_required' });

    let targetUrl: string;
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      const parsed = new URL(rawUrl);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        return reply.code(403).send({ error: 'forbidden_host' });
      }
      targetUrl = rawUrl;
    } else {
      const cleanPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
      targetUrl = `${linsheBaseUrl}${cleanPath}`;
    }

    try {
      const res = await fetcher(targetUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'upstream_asset_not_found' });
      }
      const contentType = res.headers.get('content-type') || 'image/png';
      const buffer = Buffer.from(await res.arrayBuffer());

      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'public, max-age=86400')
        .send(buffer);
    } catch (err: any) {
      return reply.code(502).send({ error: 'fetch_asset_failed', message: err.message });
    }
  });

  // POST /api/v1/admin/linshe-bridge/pin — 切换角色置顶
  app.post<{
    Body: {
      characterId: number | string;
      pinned: number | boolean;
    };
  }>('/api/v1/admin/linshe-bridge/pin', async (request, reply) => {
    const { characterId, pinned } = request.body || {};
    if (characterId === undefined) return reply.code(400).send({ error: 'character_id_required' });

    try {
      const res = await fetcher(`${linsheBaseUrl}/api/characters/${encodeURIComponent(characterId)}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: pinned ? 1 : 0 }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return reply.code(res.status).send({ error: 'linshe_pin_failed' });
      }
      const data = await res.json().catch(() => ({}));
      return { ok: true, pinned: Boolean(pinned), data };
    } catch (err: any) {
      return reply.code(502).send({ error: 'linshe_unreachable', message: err.message });
    }
  });

  // POST /api/v1/admin/linshe-bridge/wake — 叫醒角色（电话/上门）
  app.post<{
    Body: {
      characterId: number | string;
      mode?: 'phone' | 'door';
    };
  }>('/api/v1/admin/linshe-bridge/wake', async (request, reply) => {
    const { characterId, mode } = request.body || {};
    if (characterId === undefined) return reply.code(400).send({ error: 'character_id_required' });

    const endpoint = mode === 'door' ? 'wake-up-door' : 'wake-up-phone';
    try {
      const res = await fetcher(`${linsheBaseUrl}/api/schedule/${encodeURIComponent(characterId)}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      return reply.code(res.status).send(data);
    } catch (err: any) {
      return reply.code(502).send({ error: 'linshe_unreachable', message: err.message });
    }
  });
}
