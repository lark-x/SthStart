import { createHash, randomUUID } from 'node:crypto';
import { syncImageExecutionSnapshots } from './image-attempts.js';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Activity,
  ContentDocument,
  MediaRevisionDocument,
  PlaybackDocument,
} from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';
import { getActivityAssetFile, listActivityAssets } from './media.js';
import { generateAutoPlayback } from './playback.js';
import type { ActivityStore } from './store.js';
import { createZip, createZipToFile, type ZipEntryInput } from './zip.js';
import { compileHyperFramesComposition } from '@sthstart/activity-playback';

export type ExportFormat = 'reader' | 'project' | 'hyperframes-project';

export interface ExportOptions {
  contentRevisionId?: string;
  mediaRevisionId?: string;
  playbackRevisionId?: string;
  format?: ExportFormat;
  includeHistory?: boolean;
}

export interface ExportManifest {
  schemaVersion: 1;
  activityId: string;
  title: string;
  format: ExportFormat;
  contentRevisionId: string;
  mediaRevisionId?: string;
  imageConfigRevisionId?: string;
  playbackRevisionId?: string;
  exportedAt: string;
  files: Array<{
    path: string;
    byteSize: number;
    sha256: string;
  }>;
}

function computeSha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function generateOfflineReaderHtml(
  activity: Activity,
  content: ContentDocument,
  mediaRev: MediaRevisionDocument | null,
  mediaPathPrefix: string = 'media/',
): string {
  // Build a map of slotId -> media file path
  const slotMediaMap: Record<string, { assetKey: string; ext: string; kind: 'image' | 'video' }> = {};
  const slotMap = new Map(content.mediaSlots.map((s) => [s.id, s]));

  if (mediaRev?.slotBindings) {
    for (const b of mediaRev.slotBindings) {
      if (b.assets && b.assets.length > 0) {
        const slot = slotMap.get(b.slotId);
        const assetKey = b.assets[0].assetKey;
        const kind = slot?.kind || 'image';
        const ext = kind === 'video' ? '.mp4' : '.png';
        slotMediaMap[b.slotId] = { assetKey, ext, kind };
      }
    }
  }

  const actorsMap = new Map(content.actors.map((a) => [a.id, a]));

  const jsonPayload = JSON.stringify({
    activity,
    content,
    mediaRev,
    slotMediaMap,
    mediaPathPrefix,
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${activity.title} - 活动离线记录</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --bubble-other: #334155;
      --bubble-self: #0284c7;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --border: #334155;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      min-height: 100vh;
      padding: 0;
    }
    .app-container {
      width: 100%;
      max-width: 480px;
      min-height: 100vh;
      background: #090d16;
      display: flex;
      flex-direction: column;
      box-shadow: 0 0 40px rgba(0,0,0,0.8);
      position: relative;
    }
    header {
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(12px);
      padding: 14px 16px;
      position: sticky;
      top: 0;
      z-index: 50;
      border-bottom: 1px solid var(--border);
    }
    .header-title { font-size: 16px; font-weight: 700; color: #fff; }
    .header-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .nav-tabs {
      display: flex;
      background: #111827;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 61px;
      z-index: 40;
    }
    .tab-btn {
      flex: 1;
      padding: 10px 0;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      background: rgba(56, 189, 248, 0.05);
    }
    .content-area { flex: 1; padding: 16px; overflow-y: auto; }
    .stage-divider {
      text-align: center;
      margin: 20px 0 14px;
      position: relative;
    }
    .stage-badge {
      display: inline-block;
      background: #1e293b;
      border: 1px solid #3b82f6;
      color: #93c5fd;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .msg-row {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
      align-items: flex-start;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #475569;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #fff;
      flex-shrink: 0;
      overflow: hidden;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .msg-content { max-width: 78%; display: flex; flex-direction: column; }
    .msg-author { font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
    .msg-bubble {
      background: var(--bubble-other);
      padding: 10px 14px;
      border-radius: 16px;
      border-top-left-radius: 4px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      color: #f1f5f9;
    }
    .msg-media {
      margin-top: 8px;
      border-radius: 12px;
      overflow: hidden;
      max-width: 240px;
      background: #000;
      border: 1px solid var(--border);
    }
    .msg-media img, .msg-media video {
      width: 100%;
      display: block;
    }
    .post-card {
      background: var(--card-bg);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 16px;
      border: 1px solid var(--border);
    }
    .post-header { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
    .post-author { font-size: 14px; font-weight: 700; color: #fff; }
    .post-time { font-size: 11px; color: var(--text-muted); }
    .post-text { font-size: 14px; line-height: 1.6; margin-bottom: 12px; white-space: pre-wrap; }
    .post-media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-bottom: 12px; }
    .post-media-grid img, .post-media-grid video { width: 100%; border-radius: 8px; object-fit: cover; max-height: 180px; }
    .comments-box { background: rgba(15, 23, 42, 0.6); border-radius: 8px; padding: 10px; margin-top: 10px; }
    .comment-item { font-size: 12px; margin-bottom: 6px; line-height: 1.4; }
    .comment-author { font-weight: 600; color: var(--accent); margin-right: 4px; }
    .overview-card { background: var(--card-bg); border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--border); }
    .overview-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; color: var(--accent); }
    .overview-item { font-size: 13px; color: var(--text-muted); margin-bottom: 6px; }
    .actor-tag { display: inline-flex; align-items: center; gap: 6px; background: #334155; padding: 4px 10px; border-radius: 20px; font-size: 12px; margin: 4px 4px 4px 0; }
  </style>
</head>
<body>
  <div class="app-container">
    <header>
      <div class="header-title" id="headerTitle">活动记录</div>
      <div class="header-sub" id="headerSub">正在加载离线档案...</div>
    </header>

    <div class="nav-tabs">
      <div class="tab-btn active" onclick="switchTab('chat')">群聊记录</div>
      <div class="tab-btn" onclick="switchTab('moments')">朋友圈</div>
      <div class="tab-btn" onclick="switchTab('overview')">设定与阶段</div>
    </div>

    <div id="tabChat" class="content-area"></div>
    <div id="tabMoments" class="content-area" style="display: none;"></div>
    <div id="tabOverview" class="content-area" style="display: none;"></div>
  </div>

  <script>
    const DATA = ${jsonPayload};
    const { activity, content, mediaRev, slotMediaMap, mediaPathPrefix } = DATA;

    document.getElementById('headerTitle').textContent = activity.title;
    document.getElementById('headerSub').textContent = activity.theme + ' · ' + (activity.location || '独立活动');

    const actors = {};
    (content.actors || []).forEach(a => { actors[a.id] = a; });

    function renderMedia(slotId) {
      const item = slotMediaMap[slotId];
      if (!item) return '';
      const src = mediaPathPrefix + item.assetKey + item.ext;
      if (item.kind === 'video') {
        return '<div class="msg-media"><video controls preload="metadata" src="' + src + '"></video></div>';
      }
      return '<div class="msg-media"><img loading="lazy" src="' + src + '" alt="照片"/></div>';
    }

    function renderChat() {
      const container = document.getElementById('tabChat');
      let html = '';
      const stages = [...(content.stages || [])].sort((a, b) => a.order - b.order);

      stages.forEach(st => {
        html += '<div class="stage-divider"><span class="stage-badge">' + st.title + '</span></div>';
        const msgs = (content.messages || []).filter(m => m.stageId === st.id).sort((a, b) => a.storyOrder - b.storyOrder);
        msgs.forEach(m => {
          const actor = actors[m.speakerActorId] || { displayName: '未知角色' };
          const initial = actor.displayName.slice(0, 1);
          let mediaHtml = '';
          (m.mediaSlotIds || []).forEach(sid => { mediaHtml += renderMedia(sid); });

          html += '<div class="msg-row">' +
            '<div class="avatar">' + initial + '</div>' +
            '<div class="msg-content">' +
              '<div class="msg-author">' + actor.displayName + '</div>' +
              '<div class="msg-bubble">' + (m.text || '') + mediaHtml + '</div>' +
            '</div>' +
          '</div>';
        });
      });
      container.innerHTML = html || '<div style="text-align:center;color:#64748b;padding:40px;">暂无群聊记录</div>';
    }

    function renderMoments() {
      const container = document.getElementById('tabMoments');
      let html = '';
      const posts = [...(content.posts || [])].sort((a, b) => a.storyOrder - b.storyOrder);

      posts.forEach(p => {
        const actor = actors[p.authorActorId] || { displayName: '未知' };
        let mediaHtml = '';
        if (p.mediaSlotIds && p.mediaSlotIds.length > 0) {
          mediaHtml += '<div class="post-media-grid">';
          p.mediaSlotIds.forEach(sid => { mediaHtml += renderMedia(sid); });
          mediaHtml += '</div>';
        }

        const comments = (content.comments || []).filter(c => c.postId === p.id).sort((a, b) => a.storyOrder - b.storyOrder);
        let commentsHtml = '';
        if (comments.length > 0) {
          commentsHtml += '<div class="comments-box">';
          comments.forEach(c => {
            const author = actors[c.authorActorId] || { displayName: '未知' };
            commentsHtml += '<div class="comment-item"><span class="comment-author">' + author.displayName + ':</span>' + c.text + '</div>';
          });
          commentsHtml += '</div>';
        }

        html += '<div class="post-card">' +
          '<div class="post-header">' +
            '<div class="avatar">' + actor.displayName.slice(0, 1) + '</div>' +
            '<div>' +
              '<div class="post-author">' + actor.displayName + '</div>' +
              '<div class="post-time">' + (p.storyTimeLabel || '活动动态') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="post-text">' + (p.text || '') + '</div>' +
          mediaHtml +
          commentsHtml +
        '</div>';
      });

      container.innerHTML = html || '<div style="text-align:center;color:#64748b;padding:40px;">暂无朋友圈动态</div>';
    }

    function renderOverview() {
      const container = document.getElementById('tabOverview');
      let actorsHtml = '';
      (content.actors || []).forEach(a => {
        actorsHtml += '<div class="actor-tag"><span>' + a.displayName + '</span><span style="color:#94a3b8;font-size:11px;">(' + (a.activityRole || '参与者') + ')</span></div>';
      });

      let stagesHtml = '';
      (content.stages || []).forEach(s => {
        stagesHtml += '<div style="margin-bottom:12px;border-left:2px solid #3b82f6;padding-left:10px;">' +
          '<div style="font-weight:bold;color:#f8fafc;">' + s.title + '</div>' +
          '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">' + (s.instruction || '无特殊指令') + '</div>' +
        '</div>';
      });

      container.innerHTML = '<div class="overview-card">' +
        '<div class="overview-title">基本信息</div>' +
        '<div class="overview-item"><strong>标题:</strong> ' + activity.title + '</div>' +
        '<div class="overview-item"><strong>主题:</strong> ' + activity.theme + '</div>' +
        '<div class="overview-item"><strong>地点:</strong> ' + (activity.location || '默认') + '</div>' +
        '<div class="overview-item"><strong>规则:</strong> ' + (activity.rules || '自由互动') + '</div>' +
      '</div>' +
      '<div class="overview-card">' +
        '<div class="overview-title">登场角色 (' + (content.actors || []).length + ')</div>' +
        actorsHtml +
      '</div>' +
      '<div class="overview-card">' +
        '<div class="overview-title">阶段规划</div>' +
        stagesHtml +
      '</div>';
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tabChat').style.display = 'none';
      document.getElementById('tabMoments').style.display = 'none';
      document.getElementById('tabOverview').style.display = 'none';

      if (tab === 'chat') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tabChat').style.display = 'block';
      } else if (tab === 'moments') {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tabMoments').style.display = 'block';
      } else {
        document.querySelectorAll('.tab-btn')[2].classList.add('active');
        document.getElementById('tabOverview').style.display = 'block';
      }
    }

    renderChat();
    renderMoments();
    renderOverview();
  </script>
</body>
</html>`;
}

export async function collectExportEntries(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  options: ExportOptions = {},
): Promise<ZipEntryInput[]> {
  const activity = store.getActivity(activityId);
  if (!activity) throw new Error('activity_not_found');

  const contentRevId = options.contentRevisionId || activity.currentContentRevisionId;
  if (!contentRevId) throw new Error('no_content_revision');

  const contentRev = store.getContentRevision(activityId, contentRevId);
  if (!contentRev) throw new Error('content_revision_not_found');

  const mediaRevId = options.mediaRevisionId || activity.currentMediaRevisionId;
  const mediaRev = mediaRevId ? store.getMediaRevision(activityId, mediaRevId) : null;

  const format: ExportFormat = options.format || 'hyperframes-project';

// Gather media files
  const assets = listActivityAssets(database, activityId);
  const mediaEntries: Array<{ relativePath: string; filePath: string; assetKey: string }> = [];

  for (const ast of assets) {
    const file = getActivityAssetFile(database, activityId, ast.assetKey);
    if (file && existsSync(file.localPath)) {
      const ext = ast.type === 'video' ? '.mp4' : (ast.type === 'audio' ? '.mp3' : '.png');
      const relPath = `media/${ast.assetKey}${ext}`;
      mediaEntries.push({ relativePath: relPath, filePath: file.localPath, assetKey: ast.assetKey });
    }
  }

  const entries: ZipEntryInput[] = [];

  // 1. Core Data
  const mediaDoc: MediaRevisionDocument | null = mediaRev
    ? { schemaVersion: 1, slotBindings: mediaRev.slotBindings }
    : null;

  const activityJson = JSON.stringify(activity, null, 2);
  const recordsJson = JSON.stringify(contentRev.document, null, 2);
  const mediaJson = mediaDoc ? JSON.stringify(mediaDoc, null, 2) : '{}';

  entries.push(
    { path: 'activity.json', data: activityJson },
    { path: 'project.json', data: JSON.stringify({ name: activity.title, version: '1.0.0', schemaVersion: 1 }, null, 2) },
    { path: 'reader.html', data: generateOfflineReaderHtml(activity, contentRev.document, mediaDoc, 'assets/media/') },
    { path: 'data/activity.json', data: activityJson },
    { path: 'data/records.json', data: recordsJson },
    { path: 'data/media.json', data: mediaJson },
  );

  // 2. Playback document
  let playbackDoc: PlaybackDocument;
  const playbackRevId = options.playbackRevisionId || activity.currentPlaybackRevisionId;
  const playbackRev = playbackRevId ? store.getPlaybackRevision(activityId, playbackRevId) : null;

  if (playbackRev) {
    playbackDoc = playbackRev;
  } else {
    playbackDoc = generateAutoPlayback(contentRevId, contentRev.document, mediaRev?.id || 'none', mediaDoc);
  }

  entries.push({
    path: 'data/playback.json',
    data: JSON.stringify(playbackDoc, null, 2),
  });

  // 3. Media files (streamed from disk via filePath)
  for (const m of mediaEntries) {
    entries.push({
      path: `assets/${m.relativePath}`,
      filePath: m.filePath,
    });
  }

  // 3b. Provenance records (if format === 'project')
  if (format === 'project' || format === 'hyperframes-project') {
    syncImageExecutionSnapshots(database, activityId);
    const configRows = database.connection.prepare(
      'SELECT id, activity_id, parent_id, document_json, hash, created_at FROM activity_image_config_revisions WHERE activity_id = ? ORDER BY created_at ASC'
    ).all(activityId) as Array<{ id: string; activity_id: string; parent_id: string | null; document_json: string; hash: string; created_at: string }>;

    const configs = configRows.map((r) => ({
      id: r.id,
      activityId: r.activity_id,
      parentId: r.parent_id,
      document: JSON.parse(r.document_json),
      hash: r.hash,
      createdAt: r.created_at,
    }));

    const recipeRows = database.connection.prepare(
      'SELECT id, activity_id, content_revision_id, image_config_revision_id, slot_id, slot_fingerprint, source_refs_json, blocks_json, references_json, overrides_json, recipe_hash, schema_version, created_at FROM activity_prompt_recipes WHERE activity_id = ? ORDER BY created_at ASC'
    ).all(activityId) as Array<{
      id: string; activity_id: string; content_revision_id: string; image_config_revision_id: string;
      slot_id: string; slot_fingerprint: string; source_refs_json: string; blocks_json: string;
      references_json: string; overrides_json: string; recipe_hash: string; schema_version: number; created_at: string;
    }>;

    const recipes = recipeRows.map((r) => ({
      id: r.id,
      activityId: r.activity_id,
      contentRevisionId: r.content_revision_id,
      imageConfigRevisionId: r.image_config_revision_id,
      slotId: r.slot_id,
      slotFingerprint: r.slot_fingerprint,
      sourceRefs: JSON.parse(r.source_refs_json),
      blocks: JSON.parse(r.blocks_json),
      references: JSON.parse(r.references_json),
      overrides: JSON.parse(r.overrides_json),
      recipeHash: r.recipe_hash,
      schemaVersion: r.schema_version,
      createdAt: r.created_at,
    }));

    const compRows = database.connection.prepare(
      'SELECT id, recipe_id, activity_id, compiler_version, template_id, template_version, channels_json, effective_params_json, execution_plan_hash, execution_plan_json, created_at FROM activity_prompt_compilations WHERE activity_id = ? ORDER BY created_at ASC'
    ).all(activityId) as Array<{
      id: string; recipe_id: string; activity_id: string; compiler_version: string;
      template_id: string; template_version: string; channels_json: string;
      effective_params_json: string; execution_plan_hash: string; execution_plan_json: string; created_at: string;
    }>;

    const compilations = compRows.map((r) => ({
      id: r.id,
      recipeId: r.recipe_id,
      activityId: r.activity_id,
      compilerVersion: r.compiler_version,
      templateId: r.template_id,
      templateVersion: r.template_version,
      channels: JSON.parse(r.channels_json),
      effectiveParams: JSON.parse(r.effective_params_json),
      executionPlanHash: r.execution_plan_hash,
      executionPlan: JSON.parse(r.execution_plan_json || 'null'),
      createdAt: r.created_at,
    }));

    const attemptRows = database.connection.prepare(
      `SELECT a.id, a.activity_id, a.base_content_revision_id, a.image_config_revision_id,
              a.slot_id, a.slot_fingerprint, a.recipe_id, a.compilation_id,
              a.recipe_hash, a.execution_plan_hash, a.task_id, a.status,
              a.actual_seed, a.retry_of_attempt_id, a.parent_attempt_ids_json,
              a.idempotency_key, a.business_request_hash, a.error_code, a.error_message,
              a.created_at, a.updated_at
       FROM activity_image_attempts a
       WHERE a.activity_id = ?
       ORDER BY a.created_at ASC`
    ).all(activityId) as Array<{
      id: string; activity_id: string; base_content_revision_id: string; image_config_revision_id: string;
      slot_id: string; slot_fingerprint: string; recipe_id: string; compilation_id: string;
      recipe_hash: string; execution_plan_hash: string; task_id: string; status: string;
      actual_seed: number; retry_of_attempt_id: string | null; parent_attempt_ids_json: string;
      idempotency_key: string | null; business_request_hash: string; error_code: string | null;
      error_message: string | null; created_at: string; updated_at: string;
    }>;

    const attempts = attemptRows.map((r) => {
      const outputs = (database.connection.prepare(
        `SELECT o.output_name, o.sort_order, o.artifact_id, o.asset_key,
                art.media_type, art.byte_size, art.sha256, art.width, art.height
         FROM activity_image_attempt_outputs o
         JOIN artifacts art ON art.id = o.artifact_id
         WHERE o.attempt_id = ?
         ORDER BY o.sort_order ASC`
      ).all(r.id) as Array<{
        output_name: string; sort_order: number; artifact_id: string; asset_key: string;
        media_type: string | null; byte_size: number; sha256: string | null;
        width: number | null; height: number | null;
      }>).map((o) => ({
        outputName: o.output_name,
        sortOrder: o.sort_order,
        artifactId: o.artifact_id,
        assetKey: o.asset_key,
        mediaType: o.media_type || 'image/png',
        byteSize: o.byte_size,
        sha256: o.sha256 || '',
        width: o.width,
        height: o.height,
      }));

      return {
        id: r.id,
        activityId: r.activity_id,
        baseContentRevisionId: r.base_content_revision_id,
        imageConfigRevisionId: r.image_config_revision_id,
        slotId: r.slot_id,
        slotFingerprint: r.slot_fingerprint,
        recipeId: r.recipe_id,
        compilationId: r.compilation_id,
        recipeHash: r.recipe_hash,
        executionPlanHash: r.execution_plan_hash,
        taskId: r.task_id,
        status: r.status,
        actualSeed: r.actual_seed,
        retryOfAttemptId: r.retry_of_attempt_id,
        parentAttemptIds: JSON.parse(r.parent_attempt_ids_json),
        idempotencyKey: r.idempotency_key,
        businessRequestHash: r.business_request_hash,
        outputs,
        errorCode: r.error_code,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    const snapshotRows = database.connection.prepare(
      `SELECT s.attempt_id, s.phase, s.actual_inputs_json, s.uploaded_file_mappings_json,
              s.request_summary_json, s.created_at
       FROM activity_image_execution_snapshots s
       JOIN activity_image_attempts a ON a.id = s.attempt_id
       WHERE a.activity_id = ?
       ORDER BY s.id ASC`
    ).all(activityId) as Array<{
      attempt_id: string; phase: string; actual_inputs_json: string;
      uploaded_file_mappings_json: string; request_summary_json: string; created_at: string;
    }>;

    const snapshots = snapshotRows.map((r) => ({
      attemptId: r.attempt_id,
      phase: r.phase,
      actualInputs: JSON.parse(r.actual_inputs_json),
      uploadedFileMappings: JSON.parse(r.uploaded_file_mappings_json),
      requestSummary: JSON.parse(r.request_summary_json),
      createdAt: r.created_at,
    }));

    const lineageRows = database.connection.prepare(
      'SELECT id, activity_id, child_asset_key, parent_asset_key, attempt_id, role, transform_params_json, created_at FROM activity_image_lineage WHERE activity_id = ? ORDER BY created_at ASC'
    ).all(activityId) as Array<{
      id: string; activity_id: string; child_asset_key: string; parent_asset_key: string;
      attempt_id: string | null; role: string; transform_params_json: string; created_at: string;
    }>;

    const lineage = lineageRows.map((r) => ({
      id: r.id,
      activityId: r.activity_id,
      childAssetKey: r.child_asset_key,
      parentAssetKey: r.parent_asset_key,
      attemptId: r.attempt_id,
      role: r.role,
      transformParams: JSON.parse(r.transform_params_json),
      createdAt: r.created_at,
    }));

    const provenanceIndex = {
      schemaVersion: 1,
      imageConfigsCount: configs.length,
      recipesCount: recipes.length,
      compilationsCount: compilations.length,
      attemptsCount: attempts.length,
      executionSnapshotsCount: snapshots.length,
      lineageEdgesCount: lineage.length,
      exportedAt: nowIso(),
    };

    entries.push(
      { path: 'data/provenance/index.json', data: JSON.stringify(provenanceIndex, null, 2) },
      { path: 'data/provenance/image-configs.json', data: JSON.stringify(configs, null, 2) },
      { path: 'data/provenance/recipes.json', data: JSON.stringify(recipes, null, 2) },
      { path: 'data/provenance/compilations.json', data: JSON.stringify(compilations, null, 2) },
      { path: 'data/provenance/attempts.json', data: JSON.stringify(attempts, null, 2) },
      { path: 'data/provenance/execution-snapshots.json', data: JSON.stringify(snapshots, null, 2) },
      { path: 'data/provenance/lineage.json', data: JSON.stringify(lineage, null, 2) },
    );
  }

  // 4. Offline Reader HTML
  const readerHtml = generateOfflineReaderHtml(
    activity,
    contentRev.document,
    mediaDoc,
    '../assets/media/',
  );
  entries.push({
    path: 'reader/index.html',
    data: readerHtml,
  });

  // 5. HyperFrames Composition HTML & configs (if format == 'hyperframes-project')
  if (format === 'hyperframes-project') {
    const compiled = compileHyperFramesComposition(
      contentRev.document,
      mediaDoc || { schemaVersion: 1, slotBindings: [] },
      playbackDoc,
      {
        assetUrlMap: Object.fromEntries(mediaEntries.map((m) => [m.assetKey, `assets/${m.relativePath}`])),
      },
    );

    entries.push({
      path: 'index.html',
      data: compiled.html,
    });

    entries.push({
      path: 'package.json',
      data: JSON.stringify(
        {
          name: `activity-${activity.id}-render`,
          version: '1.0.0',
          private: true,
          description: `HyperFrames render project for ${activity.title}`,
          scripts: {
            check: 'npx hyperframes check .',
            inspect: 'npx hyperframes inspect .',
            render: 'npx hyperframes render . -o output.mp4',
          },
          devDependencies: {
            hyperframes: '0.8.30',
          },
        },
        null,
        2,
      ),
    });

    // Bundle assets/gsap.min.js
    const candidateGsap = [
      fileURLToPath(new URL('../../../../packages/activity-playback/templates/phone-v1/assets/gsap.min.js', import.meta.url)),
      resolve(process.cwd(), 'packages/activity-playback/templates/phone-v1/assets/gsap.min.js'),
      resolve(process.cwd(), '../../packages/activity-playback/templates/phone-v1/assets/gsap.min.js'),
      resolve(process.cwd(), 'packages/activity-playback/sample-render/assets/gsap.min.js'),
      resolve(process.cwd(), '../../packages/activity-playback/sample-render/assets/gsap.min.js'),
    ];
    const foundGsap = candidateGsap.find((p) => existsSync(p));
    if (foundGsap) {
      entries.push({ path: 'assets/gsap.min.js', filePath: foundGsap });
    }

    // Bundle assets/default_avatar.png
    const candidateAvatar = [
      fileURLToPath(new URL('../../../../packages/activity-playback/templates/phone-v1/assets/default_avatar.png', import.meta.url)),
      resolve(process.cwd(), 'packages/activity-playback/templates/phone-v1/assets/default_avatar.png'),
      resolve(process.cwd(), '../../packages/activity-playback/templates/phone-v1/assets/default_avatar.png'),
      resolve(process.cwd(), 'packages/activity-playback/fixtures/lan_avatar.png'),
      resolve(process.cwd(), '../../packages/activity-playback/fixtures/lan_avatar.png'),
    ];
    const foundAvatar = candidateAvatar.find((p) => existsSync(p));
    if (foundAvatar) {
      entries.push({ path: 'assets/default_avatar.png', filePath: foundAvatar });
    }

    entries.push({
      path: 'README.md',
      data: `# ${activity.title} - HyperFrames 视频渲染工程

本项目是由 SthStart 活动工作室导出的自包含可渲染视频工程。

## 系统要求
- Node.js >= 18
- Chrome Headless Shell: 执行 \`npx hyperframes browser ensure\`
- FFmpeg 与 FFprobe: 请确保系统中已安装（如 \`brew install ffmpeg\`）

## 快速渲染命令
1. 检查工程规范：
   \`\`\`bash
   npm run check
   \`\`\`
2. 预览画面状态：
   \`\`\`bash
   npm run inspect
   \`\`\`
3. 渲染最终成片 MP4 视频：
   \`\`\`bash
   npm run render
   \`\`\`
`,
    });
  }

  // 6. Manifest with SHA-256
  const manifestFiles: ExportManifest['files'] = await Promise.all(entries.map(async (e) => {
    if (e.filePath) {
      const stat = statSync(e.filePath);
      const hasher = createHash('sha256');
      for await (const chunk of createReadStream(e.filePath)) hasher.update(chunk);
      return {
        path: e.path,
        byteSize: stat.size,
        sha256: hasher.digest('hex'),
      };
    }
    const b = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : (e.data || Buffer.alloc(0));
    return {
      path: e.path,
      byteSize: b.length,
      sha256: computeSha256(b),
    };
  }));

  const manifest: ExportManifest = {
    schemaVersion: 1,
    activityId: activity.id,
    title: activity.title,
    format,
    contentRevisionId: contentRevId,
    mediaRevisionId: mediaRev?.id,
    imageConfigRevisionId: mediaRev?.imageConfigRevisionId || undefined,
    playbackRevisionId: playbackDoc.schemaVersion === 1 ? 'auto' : undefined,
    exportedAt: nowIso(),
    files: manifestFiles,
  };

  entries.push({
    path: 'manifest.json',
    data: JSON.stringify(manifest, null, 2),
  });

  return entries;
}

export async function buildActivityExportPackageToFile(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  options: ExportOptions = {},
  targetFilePath: string,
): Promise<{ byteSize: number }> {
  const entries = await collectExportEntries(config, database, store, activityId, options);
  const result = await createZipToFile(entries, targetFilePath);
  return { byteSize: result.totalBytes };
}

export async function buildActivityExportPackage(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  options: ExportOptions = {},
): Promise<Buffer> {
  const entries = await collectExportEntries(config, database, store, activityId, options);
  return createZip(entries);
}

export function startExportJob(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  options: ExportOptions = {},
): string {
  const jobId = randomUUID();
  const now = nowIso();
  const format = options.format || 'hyperframes-project';

  database.connection.prepare(`
    INSERT INTO activity_jobs (
      id, activity_id, kind, mode, status, request_hash,
      idempotency_key, target_revision_id, result_candidate_ids_json,
      error_message, model_metadata_json, created_at, updated_at
    ) VALUES (?, ?, 'export', ?, 'running', ?, NULL, ?, '[]', NULL, '{}', ?, ?)
  `).run(
    jobId,
    activityId,
    format,
    createHash('sha256').update(`${activityId}-${now}`).digest('hex'),
    options.contentRevisionId || null,
    now,
    now,
  );

  // Run async streaming export packaging
  setImmediate(async () => {
    try {
      const exportDir = resolve(config.artifactDirectory, 'activities', 'exports');
      mkdirSync(exportDir, { recursive: true });
      const exportPath = resolve(exportDir, `${jobId}.zip`);

      const { byteSize } = await buildActivityExportPackageToFile(
        config,
        database,
        store,
        activityId,
        options,
        exportPath,
      );

      const doneAt = nowIso();
      database.connection.prepare(`
        UPDATE activity_jobs
        SET status = 'succeeded', model_metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ exportPath, byteSize }),
        doneAt,
        jobId,
      );
    } catch (err) {
      const failedAt = nowIso();
      const msg = err instanceof Error ? err.message : String(err);
      database.connection.prepare(`
        UPDATE activity_jobs
        SET status = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(msg, failedAt, jobId);
    }
  });

  return jobId;
}
