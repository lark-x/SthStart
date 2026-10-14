import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CHARACTER_PERSONA_COMPILER_VERSION,
  compileLinshePrompt,
  type LinsheBridgeStatus,
  type LinsheBridgeSyncResult,
} from '@sthstart/contracts';
import type { ServiceConfig } from './config.js';
import type { ServiceDatabase } from './database.js';
import { nowIso } from './database.js';
import { streamUploadArtifact } from './artifacts.js';
import { normalizeCharacterDraft } from './characters/draft.js';

export function registerLinsheBridgeRoutes(
  app: FastifyInstance,
  config: ServiceConfig,
  database: ServiceDatabase,
  fetcher: typeof fetch = fetch,
) {
  const linsheBaseUrl = `http://127.0.0.1:${config.linsheAgentPort}`;

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

  // POST /api/v1/admin/linshe-bridge/sync-character — 双向人设同步（推送到邻舍 / 从邻舍拉取）
  app.post<{
    Body: {
      characterId: string;
      action: 'push_to_linshe' | 'pull_from_linshe';
      force?: boolean;
    };
  }>('/api/v1/admin/linshe-bridge/sync-character', async (request, reply) => {
    const { characterId, action, force } = request.body || {};
    if (!characterId) return reply.code(400).send({ error: 'character_id_required' });

    const profile = database.connection
      .prepare('SELECT * FROM character_profiles WHERE id=?')
      .get(characterId) as Record<string, unknown> | undefined;
    if (!profile) return reply.code(404).send({ error: 'character_not_found' });

    if (action === 'push_to_linshe') {
      // 1. 确保角色已有已发布的版本 (version snapshot)
      let version = profile.latest_version ? Number(profile.latest_version) : null;
      if (!version) {
        // 自动创建初始发布版本
        version = 1;
        const draft = normalizeCharacterDraft(JSON.parse(String(profile.draft_json)));
        const compiledLinshePrompt = compileLinshePrompt(draft);
        const now = nowIso();
        database.connection.prepare(`
          INSERT INTO character_versions (character_id, version, data_json, compiled_linshe_prompt, relationships_json, created_at, compiler_version)
          VALUES (?, ?, ?, ?, '[]', ?, ?)
        `).run(characterId, version, JSON.stringify(draft), compiledLinshePrompt, now, CHARACTER_PERSONA_COMPILER_VERSION);
        database.connection.prepare('UPDATE character_profiles SET latest_version=?, updated_at=? WHERE id=?').run(version, now, characterId);
      }

      // 2. 检查是否已经链接过
      const link = database.connection
        .prepare('SELECT local_id FROM app_character_links WHERE app_id=? AND character_id=?')
        .get('linshe', characterId) as { local_id: string } | undefined;

      try {
        if (link?.local_id) {
          // 邻舍中已存在 -> 调用 update-public 升级人设
          const updateRes = await fetcher(`${linsheBaseUrl}/api/characters/${encodeURIComponent(link.local_id)}/update-public`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: Boolean(force) }),
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
            message: `成功将【${profile.display_name}】最新人设推送到邻舍（版本 v${version}）`,
          };
        } else {
          // 邻舍中尚未招募 -> 调用 import-public 招募角色
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
            message: `成功将【${profile.display_name}】招募入驻邻舍！`,
          };
        }
      } catch (err: any) {
        return reply.code(502).send({
          ok: false,
          action,
          characterId,
          message: `无法连接到邻舍服务 (${linsheBaseUrl}): ${err.message}`,
        });
      }
    } else if (action === 'pull_from_linshe') {
      const link = database.connection
        .prepare('SELECT local_id FROM app_character_links WHERE app_id=? AND character_id=?')
        .get('linshe', characterId) as { local_id: string } | undefined;
      if (!link) {
        return reply.code(404).send({
          ok: false,
          action,
          characterId,
          message: '该角色尚未与邻舍建立绑定关系，请先推送到邻舍。',
        });
      }

      try {
        const charRes = await fetcher(`${linsheBaseUrl}/api/characters/${encodeURIComponent(link.local_id)}`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!charRes.ok) {
          return reply.code(charRes.status).send({
            ok: false,
            action,
            characterId,
            message: `读取邻舍角色数据失败 HTTP ${charRes.status}`,
          });
        }
        const linsheChar = (await charRes.json()) as {
          display_name?: string;
          base_prompt?: string;
          short_prompt?: string;
        };

        return {
          ok: true,
          action,
          characterId,
          localId: link.local_id,
          message: `已同步读取邻舍【${linsheChar.display_name || profile.display_name}】当前运行状态`,
        };
      } catch (err: any) {
        return reply.code(502).send({
          ok: false,
          action,
          characterId,
          message: `无法连接到邻舍服务: ${err.message}`,
        });
      }
    } else {
      return reply.code(400).send({ error: 'unsupported_action' });
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

    const fetchUrl = imageUrl.startsWith('http') ? imageUrl : `${linsheBaseUrl}${imageUrl}`;
    let imgRes: Response;
    try {
      imgRes = await fetcher(fetchUrl, { signal: AbortSignal.timeout(15000) });
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

      return reply.code(201).send({
        ok: true,
        id,
        url: `/api/admin/characters/assets/${id}`,
        title: cleanTitle,
      });
    }
  });
}
