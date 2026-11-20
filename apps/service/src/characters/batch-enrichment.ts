import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type {
  CharacterAssetBatchType,
  CharacterAssetCategory,
  CharacterBatchAvatarRequest,
  CharacterBatchAvatarResponse,
  CharacterBatchEnrichRpRequest,
  CharacterBatchEnrichRpResponse,
  CharacterBatchImportLocalCardsRequest,
  CharacterBatchImportLocalCardsResponse,
  CharacterDraftV2,
  CharacterPreferredSources,
  CharacterVariant,
} from '@sthstart/contracts';
import { stripMachineCharacterIndex } from '@sthstart/contracts';
import { createArtifactReference, streamUploadArtifact } from '../artifacts.js';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { upsertCharacterBirthday } from './birthday.js';
import { normalizeCharacterDraft, toAuthorityDraft } from './draft.js';
import { resolveCharacterOfficialAssetBundle, SPECIAL_CHARACTER_AVATAR_MAP, type ResolvedOfficialAssetItem } from './official-avatars.js';
import { upsertCharacterWorkHierarchy } from './organization.js';
import { syncCharacterSnapshotAfterChange } from './snapshots.js';
import { fetchBwikiCharacter } from './upstream/bwiki-adapter.js';
import { cleanPersonaProse, listAllLocalCuratedPersonaCards, loadLocalCuratedPersonaCard } from './upstream/local-persona-cards.js';
import { buildDeterministicDraft, type WorldActorCanonicalContext } from './upstream/rp-synthesizer.js';
import { fetchStarRailResCharacter } from './upstream/starrailres-adapter.js';
import { createEmptyBundle, inferWorkTarget, type UpstreamCharacterBundle } from './upstream/types.js';
import { fetchYattaGenshinCharacter } from './upstream/yatta-adapter.js';

function isValidImageBuffer(buffer: Buffer, contentType: string): boolean {
  if (buffer.length < 32) return false;
  if (contentType.toLowerCase().startsWith('image/')) return true;
  // PNG / JPEG / GIF / WEBP magic bytes
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
  const isWebp =
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
  return isPng || isJpeg || isGif || isWebp;
}

/**
 * 修复历史遗留的角色资产元信息：
 * 1) `kind='avatar'` / `'portrait'` 但 `category='other'` 的错分类记录归位为 `'avatar'` / `'portrait'`
 * 2) 空标题 / `未命名资产` 补全为 `<角色名> 官方头像` / `<角色名> 官方立绘`
 * 3) 按 `(character_id, category, source_url)` 清理完全重复的资产记录
 */
export function repairCharacterAssetsMetadata(database: ServiceDatabase): { fixedMetadata: number; removedDuplicates: number } {
  let fixedMetadata = 0;
  let removedDuplicates = 0;

  database.transaction(() => {
    const brokenRows = database.connection.prepare(`
      SELECT a.id, a.character_id, a.kind, a.category, a.title, p.display_name
      FROM character_assets a
      JOIN character_profiles p ON p.id = a.character_id
      WHERE a.kind IN ('avatar', 'portrait')
        AND (a.category IS NULL OR a.category = '' OR a.category = 'other' OR a.title IS NULL OR a.title = '')
    `).all() as Array<{ id: string; character_id: string; kind: string; category: string | null; title: string | null; display_name: string }>;

    const affectedChars = new Set<string>();
    for (const row of brokenRows) {
      const nextCategory = !row.category || row.category === 'other' ? row.kind : row.category;
      const nextTitle = row.title?.trim()
        ? row.title
        : `${row.display_name} 官方${nextCategory === 'portrait' ? '立绘' : '头像'}`;
      if (nextCategory !== row.category || nextTitle !== (row.title || '')) {
        database.connection.prepare('UPDATE character_assets SET category=?, title=? WHERE id=?').run(nextCategory, nextTitle, row.id);
        fixedMetadata += 1;
        affectedChars.add(row.character_id);
      }
    }

    // 清理同一角色、同一分类、完全相同 source_url 的重复资产
    const allAssets = database.connection.prepare(`
      SELECT a.id, a.character_id, a.category, a.source_url, a.artifact_id,
             p.avatar_asset_id, p.portrait_asset_id
      FROM character_assets a
      JOIN character_profiles p ON p.id = a.character_id
      WHERE a.source_url IS NOT NULL AND a.source_url <> ''
      ORDER BY a.created_at ASC, a.id ASC
    `).all() as Array<{
      id: string; character_id: string; category: string; source_url: string;
      artifact_id: string | null; avatar_asset_id: string | null; portrait_asset_id: string | null;
    }>;

    const keepByKey = new Map<string, string>();
    const sorted = [...allAssets].sort((a, b) => {
      const aActive = a.id === a.avatar_asset_id || a.id === a.portrait_asset_id ? 0 : 1;
      const bActive = b.id === b.avatar_asset_id || b.id === b.portrait_asset_id ? 0 : 1;
      return aActive - bActive;
    });

    for (const row of sorted) {
      const key = `${row.character_id}::${row.category}::${row.source_url}`;
      const existingKeepId = keepByKey.get(key);
      if (!existingKeepId) {
        keepByKey.set(key, row.id);
        continue;
      }
      if (row.id === row.avatar_asset_id) {
        database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=? WHERE id=?').run(existingKeepId, row.character_id);
      }
      if (row.id === row.portrait_asset_id) {
        database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=? WHERE id=?').run(existingKeepId, row.character_id);
      }
      database.connection.prepare('DELETE FROM character_visual_references WHERE asset_id=?').run(row.id);
      database.connection.prepare('DELETE FROM character_assets WHERE id=?').run(row.id);
      removedDuplicates += 1;
      affectedChars.add(row.character_id);
    }

    for (const charId of affectedChars) {
      syncCharacterSnapshotAfterChange(database, charId);
    }
  });

  return { fixedMetadata, removedDuplicates };
}

function hasExistingValidAsset(database: ServiceDatabase, assetId: unknown): boolean {
  if (!assetId) return false;
  const row = database.connection.prepare(`
    SELECT a.id
    FROM character_assets a
    JOIN artifacts art ON art.id = a.artifact_id
    WHERE a.id = ? AND art.file_status = 'ready'
  `).get(String(assetId));
  return Boolean(row);
}

function hasExistingValidCategoryAsset(database: ServiceDatabase, characterId: string, category: CharacterAssetCategory): boolean {
  const row = database.connection.prepare(`
    SELECT a.id
    FROM character_assets a
    JOIN artifacts art ON art.id = a.artifact_id
    WHERE a.character_id = ? AND a.category = ? AND art.file_status = 'ready'
    LIMIT 1
  `).get(characterId, category);
  return Boolean(row);
}

async function downloadAndStoreOfficialAsset(
  config: ServiceConfig,
  database: ServiceDatabase,
  fetcher: typeof fetch,
  characterId: string,
  item: ResolvedOfficialAssetItem,
): Promise<{ id: string; inserted: boolean } | null> {
  const urlsToTry = [...new Set([item.url, ...item.candidateUrls].filter(Boolean))];
  if (urlsToTry.length === 0) return null;

  // 1) 按唯一分类（头像/立绘每类仅限一张）+ source_url / 皮肤名称 判重
  const existingRows = database.connection.prepare(`
    SELECT a.id, a.category, a.title, a.source_url, a.metadata_json, a.artifact_id, art.sha256, art.file_status
    FROM character_assets a
    LEFT JOIN artifacts art ON art.id = a.artifact_id
    WHERE a.character_id = ? AND a.category = ?
  `).all(characterId, item.category) as Array<{
    id: string; category: string; title: string; source_url: string | null;
    metadata_json: string | null; artifact_id: string | null; sha256: string | null; file_status: string | null;
  }>;

  if (item.category === 'avatar' || item.category === 'portrait') {
    const existingSingle = existingRows.find((r) => r.artifact_id && r.file_status === 'ready');
    if (existingSingle) {
      return { id: existingSingle.id, inserted: false };
    }
  }

  for (const row of existingRows) {
    if (row.artifact_id && row.file_status === 'ready') {
      if (row.source_url && urlsToTry.includes(row.source_url)) {
        return { id: row.id, inserted: false };
      }
      if (item.category === 'costume' && item.skinName) {
        let metaSkin = '';
        try { metaSkin = String(JSON.parse(row.metadata_json || '{}').skinName || '').trim(); } catch {}
        const normalizedSkin = item.skinName.trim();
        if (metaSkin === normalizedSkin || row.title === `皮肤 · ${normalizedSkin}` || row.title === `形态立绘 · ${normalizedSkin}`) {
          return { id: row.id, inserted: false };
        }
      }
    }
  }

  // 2) 下载候选 URL
  let downloadedBuffer: Buffer | null = null;
  let downloadedType = 'image/png';
  let downloadedUrl = urlsToTry[0];

  for (const candidateUrl of urlsToTry) {
    try {
      const res = await fetcher(candidateUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/png';
      if (!isValidImageBuffer(buf, contentType)) continue;
      downloadedBuffer = buf;
      downloadedType = contentType.split(';')[0].trim() || 'image/png';
      downloadedUrl = candidateUrl;
      break;
    } catch {
      // try next mirror
    }
  }

  if (!downloadedBuffer) return null;

  // 3) 按内容 SHA-256 去重（同分类下完全同一张图不重复插入）
  const sha256 = createHash('sha256').update(downloadedBuffer).digest('hex');
  const existingByHash = existingRows.find((r) => r.sha256 === sha256 && r.file_status === 'ready');
  if (existingByHash) {
    return { id: existingByHash.id, inserted: false };
  }

  const ext = downloadedType.includes('webp') ? 'webp' : downloadedType.includes('jpeg') ? 'jpg' : 'png';
  const filename = `${item.category}_${Date.now()}.${ext}`;
  const assetId = randomUUID();
  const now = nowIso();
  const metadata: Record<string, unknown> = {
    source: item.source,
    ...(item.skinName ? { skinName: item.skinName } : {}),
    ...(item.outfitDescription ? { outfitDescription: item.outfitDescription } : {}),
    ...(item.loreStory ? { loreStory: item.loreStory } : {}),
  };
  const tags = [
    item.category === 'avatar' ? '官方头像' : item.category === 'portrait' ? '官方立绘' : '皮肤',
    ...(item.skinName ? [item.skinName] : []),
  ];

  // 如果已有同皮肤无图文字档案，优先补充图片到现有记录而非新建
  const textOnlyCostume = item.category === 'costume' && item.skinName
    ? existingRows.find((r) => {
        if (r.artifact_id) return false;
        try {
          const m = JSON.parse(r.metadata_json || '{}');
          return String(m.skinName || '').trim() === item.skinName!.trim();
        } catch {
          return false;
        }
      })
    : undefined;

  const targetAssetId = textOnlyCostume?.id || assetId;
  const artifact = await streamUploadArtifact(config, database, {
    appId: 'characters',
    stream: Readable.from([downloadedBuffer]),
    contentType: downloadedType,
    originalName: filename,
    refType: 'character-asset',
    refId: targetAssetId,
    metadata: { characterId, kind: item.kind, category: item.category },
  });

  database.transaction(() => {
    if (textOnlyCostume) {
      database.connection.prepare(`
        UPDATE character_assets
        SET artifact_id=?, source_url=?, tags_json=?, metadata_json=?
        WHERE id=?
      `).run(artifact.id, downloadedUrl.slice(0, 2_000), JSON.stringify(tags), JSON.stringify(metadata), textOnlyCostume.id);
    } else {
      database.connection.prepare(`
        INSERT INTO character_assets
          (id,character_id,kind,created_at,artifact_id,source_url,author_note,user_note,category,title,tags_json,metadata_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        assetId,
        characterId,
        item.kind,
        now,
        artifact.id,
        downloadedUrl.slice(0, 2_000),
        (item.loreStory || item.source || '').slice(0, 4_000),
        (item.outfitDescription || item.source || '官方批量抓取').slice(0, 4_000),
        item.category,
        item.title.slice(0, 200),
        JSON.stringify(tags),
        JSON.stringify(metadata),
      );
      createArtifactReference(database, { artifactId: artifact.id, appId: 'characters', refType: 'character-asset', refId: assetId });
    }

    if (item.category === 'portrait' || item.category === 'costume') {
      const hasRef = database.connection.prepare('SELECT 1 FROM character_visual_references WHERE asset_id=?').get(targetAssetId);
      if (!hasRef) {
        const purposes = item.category === 'costume' ? ['outfit', 'identity'] : ['identity'];
        database.connection.prepare(`
          INSERT INTO character_visual_references
            (id,character_id,asset_id,purposes_json,enabled,crop_json,created_at,updated_at)
          VALUES (?,?,?,?,1,NULL,?,?)
        `).run(randomUUID(), characterId, targetAssetId, JSON.stringify(purposes), now, now);
      }
    }
  });

  return { id: targetAssetId, inserted: true };
}

export async function runBatchOfficialAssets(
  config: ServiceConfig,
  database: ServiceDatabase,
  fetcher: typeof fetch,
  input: CharacterBatchAvatarRequest,
): Promise<CharacterBatchAvatarResponse> {
  const onlyMissing = input.onlyMissing !== false;
  const assetTypes: CharacterAssetBatchType[] = input.assetTypes?.length
    ? [...new Set(input.assetTypes)]
    : ['avatar', 'portrait', 'costume'];
  const preferredSources: CharacterPreferredSources | undefined = input.preferredSources;

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(input.ids) && input.ids.length > 0) {
    const placeholders = input.ids.map(() => '?').join(',');
    rows = database.connection.prepare(`
      SELECT id, display_name, draft_json, avatar_asset_id, portrait_asset_id
      FROM character_profiles
      WHERE id IN (${placeholders}) AND archived=0
    `).all(...input.ids) as Record<string, unknown>[];
  } else {
    rows = database.connection.prepare(`
      SELECT id, display_name, draft_json, avatar_asset_id, portrait_asset_id
      FROM character_profiles
      WHERE archived=0
      ORDER BY updated_at DESC
    `).all() as Record<string, unknown>[];
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: CharacterBatchAvatarResponse['items'] = new Array(rows.length);

  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const row = rows[idx];
      const id = String(row.id);
      const displayName = String(row.display_name);

      try {
        const draft = normalizeCharacterDraft(JSON.parse(String(row.draft_json)));
        const hasAvatarAlready = hasExistingValidAsset(database, row.avatar_asset_id) || hasExistingValidCategoryAsset(database, id, 'avatar');
        const hasPortraitAlready = hasExistingValidAsset(database, row.portrait_asset_id) || hasExistingValidCategoryAsset(database, id, 'portrait');

        const needAvatar = assetTypes.includes('avatar') && (!onlyMissing || !hasAvatarAlready);
        const needPortrait = assetTypes.includes('portrait') && (!onlyMissing || !hasPortraitAlready);
        const needCostumes = assetTypes.includes('costume');

        if (!needAvatar && !needPortrait && !needCostumes) {
          skipped++;
          items[idx] = { id, displayName, success: true, avatarAdded: false, portraitAdded: false, skinsAdded: 0, error: '已有全部所选形象' };
          continue;
        }

        const bundle = await resolveCharacterOfficialAssetBundle(
          displayName,
          (draft as Record<string, unknown>).englishName as string | undefined,
          (draft as Record<string, unknown>).work as string | undefined,
          preferredSources,
          fetcher,
        );

        if (!bundle) {
          skipped++;
          items[idx] = { id, displayName, success: false, error: '未在官方角色库中匹配到' };
          continue;
        }

        let avatarAdded = false;
        let portraitAdded = false;
        let skinsAdded = 0;
        let touched = false;
        const now = nowIso();

        if (needAvatar && bundle.avatar) {
          const saved = await downloadAndStoreOfficialAsset(config, database, fetcher, id, bundle.avatar);
          if (saved) {
            if ((!hasAvatarAlready || !onlyMissing) && String(row.avatar_asset_id || '') !== saved.id) {
              database.connection.prepare('UPDATE character_profiles SET avatar_asset_id=?, updated_at=? WHERE id=?').run(saved.id, now, id);
              touched = true;
            }
            if (saved.inserted) {
              avatarAdded = true;
              touched = true;
            }
          }
        }

        if (needPortrait && bundle.portrait) {
          const saved = await downloadAndStoreOfficialAsset(config, database, fetcher, id, bundle.portrait);
          if (saved) {
            if ((!hasPortraitAlready || !onlyMissing) && String(row.portrait_asset_id || '') !== saved.id) {
              database.connection.prepare('UPDATE character_profiles SET portrait_asset_id=?, updated_at=? WHERE id=?').run(saved.id, now, id);
              touched = true;
            }
            if (saved.inserted) {
              portraitAdded = true;
              touched = true;
            }
          }
        }

        if (needCostumes && bundle.costumes.length > 0) {
          for (const costume of bundle.costumes) {
            const saved = await downloadAndStoreOfficialAsset(config, database, fetcher, id, costume);
            if (saved?.inserted) {
              skinsAdded += 1;
              touched = true;
            }
          }
        }

        if (touched) {
          syncCharacterSnapshotAfterChange(database, id, { incrementRevision: true });
          updated++;
          items[idx] = {
            id,
            displayName,
            success: true,
            avatarAdded,
            portraitAdded,
            skinsAdded,
            sourceUsed: bundle.sourceUsed,
          };
        } else {
          skipped++;
          items[idx] = {
            id,
            displayName,
            success: true,
            avatarAdded: false,
            portraitAdded: false,
            skinsAdded: 0,
            sourceUsed: bundle.sourceUsed,
            error: '所需形象均已存在（未重复写入）',
          };
        }
      } catch (err) {
        failed++;
        items[idx] = {
          id,
          displayName,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));

  return {
    total: rows.length,
    updated,
    skipped,
    failed,
    items,
  };
}

function loadWorldActorContexts(database: ServiceDatabase): {
  byCharacterId: Map<string, WorldActorCanonicalContext>;
  byName: Map<string, WorldActorCanonicalContext>;
} {
  const byCharacterId = new Map<string, WorldActorCanonicalContext>();
  const byName = new Map<string, WorldActorCanonicalContext>();

  const rows = database.connection.prepare('SELECT data_json FROM sw_worlds').all() as Array<{ data_json: string }>;
  for (const row of rows) {
    try {
      const world = JSON.parse(row.data_json) as {
        name?: string;
        actors?: Array<{
          characterId?: string;
          name?: string;
          background?: string;
          personality?: string;
          speechStyle?: string;
          appearance?: string;
          faction?: string;
          goals?: string[];
        }>;
      };
      for (const actor of world.actors || []) {
        const ctx: WorldActorCanonicalContext = {
          background: actor.background,
          personality: actor.personality,
          speechStyle: actor.speechStyle,
          appearance: actor.appearance,
          faction: actor.faction,
          goals: actor.goals,
          worldName: world.name,
        };
        if (actor.characterId) byCharacterId.set(actor.characterId, ctx);
        if (actor.name) byName.set(actor.name.trim(), ctx);
      }
    } catch {
      // ignore malformed world
    }
  }
  return { byCharacterId, byName };
}

function extractTagsFromUpstream(work: string, bundle: UpstreamCharacterBundle, worldCtx?: WorldActorCanonicalContext): string[] {
  const tags = new Set<string>();
  if (work) tags.add(work);
  if (worldCtx?.faction) tags.add(worldCtx.faction);
  for (const fact of bundle.facts) {
    const m = /^(所属|地区|元素|命途|属性|星级)：(.+)$/.exec(fact);
    if (m) tags.add(m[2].trim());
  }
  return [...tags].slice(0, 12);
}

/**
 * 批量获取并补全角色 RP 卡（整合：精炼官方文档 + Yatta/StarRailRes/BWiki 结构化资料 + sw_worlds 世界观人物设定）
 */
export async function runBatchEnrichRpCards(
  database: ServiceDatabase,
  fetcher: typeof fetch,
  input: CharacterBatchEnrichRpRequest,
): Promise<CharacterBatchEnrichRpResponse> {
  const scope = input.scope || 'incomplete';
  const overwrite = Boolean(input.overwriteExisting);
  const preferredSources = input.preferredSources;
  const worldContexts = loadWorldActorContexts(database);

  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(input.ids) && input.ids.length > 0 && scope === 'selected') {
    const placeholders = input.ids.map(() => '?').join(',');
    rows = database.connection.prepare(`
      SELECT id, display_name, draft_json, tags_json, variants_json, draft_revision
      FROM character_profiles
      WHERE id IN (${placeholders}) AND archived=0
    `).all(...input.ids) as Record<string, unknown>[];
  } else {
    rows = database.connection.prepare(`
      SELECT id, display_name, draft_json, tags_json, variants_json, draft_revision
      FROM character_profiles
      WHERE archived=0
      ORDER BY updated_at DESC
    `).all() as Record<string, unknown>[];
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const items: CharacterBatchEnrichRpResponse['items'] = new Array(rows.length);

  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const idx = cursor++;
      const row = rows[idx];
      const id = String(row.id);
      const displayName = String(row.display_name);

      try {
        const currentAuthority = toAuthorityDraft(normalizeCharacterDraft(JSON.parse(String(row.draft_json))));
        const currentTags: string[] = (() => { try { return JSON.parse(String(row.tags_json || '[]')); } catch { return []; } })();

        const isIncomplete = !currentAuthority.summary.trim()
          || !currentAuthority.speechText.trim()
          || !currentAuthority.behaviorRules.trim()
          || currentAuthority.dialogueExamples.length === 0
          || !currentAuthority.appearance.baseText.trim()
          || currentAuthority.personaText.trim().length < 280;

        if (scope === 'incomplete' && !overwrite && !isIncomplete) {
          skipped++;
          items[idx] = { id, displayName, success: true, error: '角色卡已完整，已跳过' };
          continue;
        }

        const workName = currentAuthority.work || '';
        const target = inferWorkTarget(displayName, workName);
        const worldCtx = worldContexts.byCharacterId.get(id) || worldContexts.byName.get(displayName.trim());

        // 1) 获取精炼官方设定卡与在线结构化数据
        const localCard = loadLocalCuratedPersonaCard(displayName, target);
        let upstreamPatch: Partial<UpstreamCharacterBundle> | null = null;
        const sourcesUsed: string[] = [];

        if (target === 'genshin') {
          if (preferredSources?.genshin === 'bwiki') {
            upstreamPatch = await fetchBwikiCharacter(displayName, 'genshin', fetcher);
            if (upstreamPatch?.stories?.length || upstreamPatch?.facts?.length) sourcesUsed.push('BWiki (原神)');
          } else {
            upstreamPatch = await fetchYattaGenshinCharacter(displayName, fetcher);
            if (upstreamPatch?.facts?.length || upstreamPatch?.stories?.length) {
              sourcesUsed.push('Project Amber (Yatta)');
            } else if (!localCard) {
              upstreamPatch = await fetchBwikiCharacter(displayName, 'genshin', fetcher);
              if (upstreamPatch?.stories?.length || upstreamPatch?.facts?.length) sourcesUsed.push('BWiki (原神)');
            }
          }
        } else if (target === 'starrail') {
          if (preferredSources?.starrail === 'bwiki') {
            upstreamPatch = await fetchBwikiCharacter(displayName, 'starrail', fetcher);
            if (upstreamPatch?.stories?.length || upstreamPatch?.facts?.length) sourcesUsed.push('BWiki (星穹铁道)');
          } else {
            upstreamPatch = await fetchStarRailResCharacter(displayName, fetcher);
            if (upstreamPatch?.facts?.length) sourcesUsed.push('StarRailRes');
          }
        } else {
          upstreamPatch = await fetchBwikiCharacter(displayName, target, fetcher);
          if (upstreamPatch?.stories?.length || upstreamPatch?.facts?.length) sourcesUsed.push('BWiki');
        }

        if (localCard) sourcesUsed.unshift('精炼官方人设库');
        if (worldCtx) sourcesUsed.push('作品设定集');

        const bundle: UpstreamCharacterBundle = {
          ...createEmptyBundle(displayName, workName),
          ...(upstreamPatch || {}),
          resolvedName: upstreamPatch?.resolvedName || displayName,
          resolvedWork: upstreamPatch?.resolvedWork || workName,
          facts: upstreamPatch?.facts || [],
          stories: upstreamPatch?.stories || [],
          voiceLines: upstreamPatch?.voiceLines || [],
          dialogueSamples: upstreamPatch?.dialogueSamples || [],
          skinOrVariantCandidates: upstreamPatch?.skinOrVariantCandidates || [],
          assets: upstreamPatch?.assets || [],
          sources: upstreamPatch?.sources || [],
          warnings: upstreamPatch?.warnings || [],
        };

        if (!localCard && !upstreamPatch?.facts?.length && !upstreamPatch?.stories?.length && !worldCtx) {
          skipped++;
          items[idx] = { id, displayName, success: false, error: '未匹配到可用的设定卡或官方档案' };
          continue;
        }

        const deterministic = buildDeterministicDraft(bundle, worldCtx);

        // 若官方上游已给出权威命途，自动纠偏本地人设卡中早期录错的命途称谓（如 星期日/停云/灵砂）
        const upstreamPath = bundle.facts.find((f) => f.startsWith('命途：'))?.slice(3).trim();
        const reconcilePath = (text: string) =>
          upstreamPath
            ? text.replace(/(毁灭|巡猎|智识|同谐|虚无|存护|丰饶|记忆|欢愉)命途/g, `${upstreamPath}命途`)
            : text;

        // 组合精炼人设卡 + 官方基础档案 + 世界设定视觉描写（简洁详细不冗余）
        const archiveFactsBlock = bundle.facts.length
          ? `### 官方基础档案\n${bundle.facts.filter((f) => !f.startsWith('内部标识：')).map((f) => `- ${cleanPersonaProse(f, displayName)}`).join('\n')}`
          : '';
        const candidatePersona = localCard
          ? [archiveFactsBlock, reconcilePath(localCard.personaText)].filter(Boolean).join('\n\n')
          : deterministic.personaText;
        const candidateSummary = (localCard?.summary ? reconcilePath(localCard.summary) : '') || deterministic.summary || currentAuthority.summary;
        const candidateSpeech = localCard?.speechText
          || (worldCtx?.speechStyle ? `【说话风格】${worldCtx.speechStyle}\n${deterministic.speechText}` : deterministic.speechText);
        const candidateBehavior = localCard?.behaviorRules || deterministic.behaviorRules;
        const candidateExamples = (localCard?.dialogueExamples.length
          ? localCard.dialogueExamples
          : deterministic.dialogueExamples
        ).map((item) => cleanPersonaProse(item, displayName)).filter(Boolean);

        // 外貌与装扮：优先使用清晰描述，不把纯空白当有效覆盖
        const appearanceTextCombined = worldCtx?.appearance || deterministic.appearance.baseText;
        let nextBaseAppearance = currentAuthority.appearance.baseText;
        let nextOutfitAppearance = currentAuthority.appearance.defaultOutfitText;
        if (appearanceTextCombined && (overwrite || !nextBaseAppearance.trim())) {
          const splitMatch = appearanceTextCombined.split(/[；;]\s*(?=(?:[^；;]*(?:装|衣|袍|裙|靴|帽|铠|甲|眼镜|护目镜|披肩|制服)))/);
          if (splitMatch.length >= 2) {
            nextBaseAppearance = splitMatch[0].trim();
            if (overwrite || !nextOutfitAppearance.trim()) {
              nextOutfitAppearance = splitMatch.slice(1).join('；').trim();
            }
          } else {
            nextBaseAppearance = appearanceTextCombined;
          }
        }
        if (deterministic.appearance.defaultOutfitText && (overwrite || !nextOutfitAppearance.trim())) {
          nextOutfitAppearance = deterministic.appearance.defaultOutfitText;
        }

        const filledFields: string[] = [];
        const pickText = (field: string, existing: string, incoming: string, preferLongerStub = false) => {
          const cleanExisting = cleanPersonaProse(stripMachineCharacterIndex(existing), displayName).trim();
          const cleanIncoming = cleanPersonaProse(stripMachineCharacterIndex(incoming), displayName).trim();
          if (!cleanIncoming) return existing;
          if (overwrite || !cleanExisting || (preferLongerStub && cleanExisting.length < 280 && cleanIncoming.length > cleanExisting.length)) {
            if (cleanIncoming !== cleanExisting) filledFields.push(field);
            return cleanIncoming;
          }
          return existing;
        };

        const nextSummary = pickText('一句话概述', currentAuthority.summary, candidateSummary);
        const nextPersona = pickText('详细人设背景', currentAuthority.personaText, candidatePersona, true);
        const nextSpeech = pickText('说话方式与语气', currentAuthority.speechText, candidateSpeech);
        const nextBehavior = pickText('认知边界与行为底线', currentAuthority.behaviorRules, candidateBehavior);

        const nextExamples = (overwrite || currentAuthority.dialogueExamples.length === 0) && candidateExamples.length > 0
          ? (filledFields.push('情境对话范例'), candidateExamples)
          : currentAuthority.dialogueExamples;

        if (nextBaseAppearance !== currentAuthority.appearance.baseText) filledFields.push('基础外貌');
        if (nextOutfitAppearance !== currentAuthority.appearance.defaultOutfitText) filledFields.push('代表性装扮');

        const nextBirthday = (overwrite || currentAuthority.birthday?.status !== 'known') && bundle.birthday?.status === 'known'
          ? (filledFields.push('角色生日'), bundle.birthday)
          : (currentAuthority.birthday ?? { status: 'unset' as const, calendar: 'unknown' as const });

        const suggestedTags = extractTagsFromUpstream(workName || bundle.resolvedWork, bundle, worldCtx);
        const nextTags = [...new Set([...currentTags, ...suggestedTags])];
        if (nextTags.length > currentTags.length) filledFields.push('角色标签');

        if (filledFields.length === 0) {
          skipped++;
          items[idx] = { id, displayName, success: true, sourceUsed: sourcesUsed.join(' + '), error: '无需更新，当前内容已完整' };
          continue;
        }

        const nextDraft: CharacterDraftV2 = {
          ...currentAuthority,
          schemaVersion: 2,
          englishName: currentAuthority.englishName || bundle.englishName || '',
          aliases: currentAuthority.aliases.length ? currentAuthority.aliases : bundle.aliases,
          work: currentAuthority.work || bundle.resolvedWork,
          summary: nextSummary,
          personaText: nextPersona,
          speechText: nextSpeech,
          dialogueExamples: nextExamples,
          behaviorRules: nextBehavior,
          appearance: {
            baseText: nextBaseAppearance,
            defaultOutfitText: nextOutfitAppearance,
          },
          birthday: nextBirthday,
        };

        const now = nowIso();
        const nextRevision = Number(row.draft_revision ?? 1) + 1;

        database.transaction(() => {
          database.connection.prepare(`
            UPDATE character_profiles
            SET draft_json=?, tags_json=?, draft_revision=?, updated_at=?
            WHERE id=?
          `).run(JSON.stringify(nextDraft), JSON.stringify(nextTags), nextRevision, now, id);
          upsertCharacterBirthday(database, id, nextDraft);
          syncCharacterSnapshotAfterChange(database, id);
        });

        updated++;
        items[idx] = {
          id,
          displayName,
          success: true,
          sourceUsed: sourcesUsed.join(' + '),
          filledFields,
        };
      } catch (err) {
        failed++;
        items[idx] = {
          id,
          displayName,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));

  return {
    total: rows.length,
    updated,
    skipped,
    failed,
    items,
  };
}

function normalizeWorkBucket(work: string): 'genshin' | 'starrail' | string {
  const trimmed = work.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('原神') || trimmed.includes('genshin')) return 'genshin';
  if (trimmed.includes('星穹铁道') || trimmed.includes('星铁') || trimmed.includes('star rail') || trimmed.includes('hsr')) {
    return 'starrail';
  }
  return trimmed;
}

function normalizeCharKey(name: string): string {
  return name.trim().replace(/[·•・\s]/g, '').toLowerCase();
}

function extractTagsFromLocalCard(workName: string, kind: 'playable' | 'story' | 'npc', summary: string): string[] {
  const tags = new Set<string>([workName]);
  const kindLabel = kind === 'playable' ? '自机角色' : kind === 'story' ? '剧情角色' : 'NPC';
  tags.add(kindLabel);

  const starMatch = /([45])\s*[星★]/.exec(summary);
  if (starMatch) tags.add(`${starMatch[1]}星`);

  const pathMatch = /(毁灭|巡猎|智识|同谐|虚无|存护|丰饶|记忆|欢愉)命途/.exec(summary);
  if (pathMatch) tags.add(pathMatch[1]);

  const attrMatch = /(物理|火|冰|雷|风|量子|虚数)属性/.exec(summary);
  if (attrMatch) tags.add(attrMatch[1]);

  const weaponMatch = /(单手剑|双手剑|长柄武器|法器|弓)/.exec(summary);
  if (weaponMatch) tags.add(weaponMatch[1]);

  return [...tags].slice(0, 12);
}

/**
 * 从工作区精炼本地人设库（角色人设卡_skill / 星铁人设卡_skill）一键批量导入全部自机、剧情与 NPC 角色。
 * 自动按 (规范化角色名, 作品归属) 判重：已存在且完整的保留原图与版本；仅补全缺失设定或增量建档。
 */
export function runBatchImportLocalPersonaCards(
  database: ServiceDatabase,
  input: CharacterBatchImportLocalCardsRequest,
): CharacterBatchImportLocalCardsResponse {
  const includePlayable = input.includePlayable !== false;
  const includeStory = input.includeStory !== false;
  const includeNpc = input.includeNpc !== false;
  const overwrite = Boolean(input.overwriteExisting);

  const entries = listAllLocalCuratedPersonaCards().filter((entry) =>
    (entry.kind === 'playable' && includePlayable)
    || (entry.kind === 'story' && includeStory)
    || (entry.kind === 'npc' && includeNpc),
  );

  const existingProfiles = database.connection.prepare(`
    SELECT id, slug, display_name, draft_json, tags_json, variants_json, draft_revision
    FROM character_profiles
    WHERE archived = 0
  `).all() as Array<{
    id: string;
    slug: string;
    display_name: string;
    draft_json: string;
    tags_json: string;
    variants_json: string | null;
    draft_revision: number;
  }>;

  const existingByKey = new Map<string, (typeof existingProfiles)[number]>();
  const usedSlugs = new Set<string>();
  for (const row of existingProfiles) {
    usedSlugs.add(row.slug);
    let work = '';
    try {
      work = String(JSON.parse(row.draft_json).work || '');
    } catch {}
    const key = `${normalizeCharKey(row.display_name)}::${normalizeWorkBucket(work)}`;
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  const nextUniqueSlug = (baseInput: string): string => {
    const base = baseInput.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'char';
    let candidate = base;
    let suffix = 2;
    while (usedSlugs.has(candidate)) {
      candidate = `${base}-${suffix++}`;
    }
    usedSlugs.add(candidate);
    return candidate;
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const importedIds: string[] = [];
  const playableIds: string[] = [];
  const items: CharacterBatchImportLocalCardsResponse['items'] = [];

  database.transaction(() => {
    const worksIncluded = new Set(entries.map((e) => e.workName));
    for (const w of worksIncluded) {
      upsertCharacterWorkHierarchy(database, { name: w, workNature: 'canon' });
    }

    const now = nowIso();
    const insertProfileStmt = database.connection.prepare(`
      INSERT INTO character_profiles
        (id, slug, display_name, draft_json, tags_json, avatar_asset_id, portrait_asset_id, latest_version, archived, created_at, updated_at, draft_revision, variants_json, parent_character_id)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?, 1, '[]', NULL)
    `);
    const updateProfileStmt = database.connection.prepare(`
      UPDATE character_profiles
      SET draft_json=?, tags_json=?, draft_revision=?, updated_at=?
      WHERE id=?
    `);

    for (const entry of entries) {
      try {
        const card = loadLocalCuratedPersonaCard(entry.name, entry.workTarget);
        if (!card) {
          failed += 1;
          items.push({ displayName: entry.name, work: entry.workName, category: entry.kind, action: 'failed', error: '无法解析本地卡片正文' });
          continue;
        }

        const specialNorm = normalizeCharKey(entry.name);
        const isSpecialOfficial = Object.keys(SPECIAL_CHARACTER_AVATAR_MAP).some((k) => normalizeCharKey(k) === specialNorm);
        const key = `${specialNorm}::${entry.workTarget}`;
        const existing = existingByKey.get(key);
        const extractedTags = extractTagsFromLocalCard(entry.workName, entry.kind, card.summary);

        if (existing) {
          const currentDraft = toAuthorityDraft(normalizeCharacterDraft(JSON.parse(existing.draft_json)));
          const currentTags: string[] = (() => {
            try { return JSON.parse(existing.tags_json || '[]') as string[]; } catch { return []; }
          })();
          const nextTags = [...new Set([...currentTags, ...extractedTags])].slice(0, 20);
          const tagsChanged = nextTags.length !== currentTags.length;

          const hasCompleteRp = Boolean(
            currentDraft.summary.trim()
            && currentDraft.speechText.trim()
            && currentDraft.behaviorRules.trim()
            && currentDraft.dialogueExamples.length > 0
            && currentDraft.personaText.trim().length >= 200,
          );

          if (entry.kind === 'playable' || isSpecialOfficial) {
            playableIds.push(existing.id);
          }

          if (!overwrite && hasCompleteRp && !tagsChanged) {
            skipped += 1;
            items.push({ id: existing.id, displayName: entry.name, work: entry.workName, category: entry.kind, action: 'skipped' });
            continue;
          }

          const nextDraft: CharacterDraftV2 = {
            ...currentDraft,
            schemaVersion: 2,
            work: currentDraft.work || entry.workName,
            summary: overwrite || !currentDraft.summary.trim() ? card.summary : currentDraft.summary,
            personaText: overwrite || currentDraft.personaText.trim().length < 200 ? card.personaText : currentDraft.personaText,
            speechText: overwrite || !currentDraft.speechText.trim() ? card.speechText : currentDraft.speechText,
            behaviorRules: overwrite || !currentDraft.behaviorRules.trim() ? card.behaviorRules : currentDraft.behaviorRules,
            dialogueExamples: overwrite || currentDraft.dialogueExamples.length === 0 ? card.dialogueExamples : currentDraft.dialogueExamples,
          };

          const draftChanged = JSON.stringify(nextDraft) !== JSON.stringify(currentDraft);
          if (!draftChanged && !tagsChanged) {
            skipped += 1;
            items.push({ id: existing.id, displayName: entry.name, work: entry.workName, category: entry.kind, action: 'skipped' });
            continue;
          }

          const nextRevision = Number(existing.draft_revision ?? 1) + 1;
          updateProfileStmt.run(JSON.stringify(nextDraft), JSON.stringify(nextTags), nextRevision, now, existing.id);
          syncCharacterSnapshotAfterChange(database, existing.id);

          updated += 1;
          importedIds.push(existing.id);
          items.push({ id: existing.id, displayName: entry.name, work: entry.workName, category: entry.kind, action: 'updated' });
          continue;
        }

        const id = randomUUID();
        const slug = nextUniqueSlug(`${entry.workTarget}-${createHash('sha1').update(entry.name).digest('hex').slice(0, 8)}`);
        const draft: CharacterDraftV2 = {
          schemaVersion: 2,
          displayName: entry.name,
          englishName: '',
          aliases: [],
          originType: 'ip',
          work: entry.workName,
          summary: card.summary,
          personaText: card.personaText,
          speechText: card.speechText,
          dialogueExamples: card.dialogueExamples,
          behaviorRules: card.behaviorRules,
          appearance: { baseText: '', defaultOutfitText: '' },
          birthday: { status: 'unset', calendar: 'unknown' },
        };

        insertProfileStmt.run(id, slug, entry.name, JSON.stringify(draft), JSON.stringify(extractedTags), now, now);
        upsertCharacterBirthday(database, id, draft);
        syncCharacterSnapshotAfterChange(database, id);
        existingByKey.set(key, {
          id,
          slug,
          display_name: entry.name,
          draft_json: JSON.stringify(draft),
          tags_json: JSON.stringify(extractedTags),
          variants_json: '[]',
          draft_revision: 1,
        });

        created += 1;
        importedIds.push(id);
        if (entry.kind === 'playable' || isSpecialOfficial) {
          playableIds.push(id);
        }
        items.push({ id, displayName: entry.name, work: entry.workName, category: entry.kind, action: 'created' });
      } catch (err) {
        failed += 1;
        items.push({
          displayName: entry.name,
          work: entry.workName,
          category: entry.kind,
          action: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  return {
    totalFiles: entries.length,
    created,
    updated,
    skipped,
    failed,
    importedIds,
    playableIds: [...new Set(playableIds)],
    items,
  };
}
