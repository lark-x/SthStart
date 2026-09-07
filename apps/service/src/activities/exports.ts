import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { createZip, type ZipEntryInput } from './zip.js';
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

export async function buildActivityExportPackage(
  config: ServiceConfig,
  database: ServiceDatabase,
  store: ActivityStore,
  activityId: string,
  options: ExportOptions = {},
): Promise<Buffer> {
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
  const mediaEntries: Array<{ relativePath: string; buffer: Buffer; assetKey: string }> = [];

  for (const ast of assets) {
    const file = getActivityAssetFile(database, activityId, ast.assetKey);
    if (file && existsSync(file.localPath)) {
      const buf = readFileSync(file.localPath);
      const ext = ast.type === 'video' ? '.mp4' : (ast.type === 'audio' ? '.mp3' : '.png');
      const relPath = `media/${ast.assetKey}${ext}`;
      mediaEntries.push({ relativePath: relPath, buffer: buf, assetKey: ast.assetKey });
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

  // 3. Media files
  for (const m of mediaEntries) {
    entries.push({
      path: `assets/${m.relativePath}`,
      data: m.buffer,
    });
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
            hyperframes: '^0.8.30',
          },
        },
        null,
        2,
      ),
    });

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
  const manifestFiles: ExportManifest['files'] = entries.map((e) => {
    const b = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : e.data;
    return {
      path: e.path,
      byteSize: b.length,
      sha256: computeSha256(b),
    };
  });

  const manifest: ExportManifest = {
    schemaVersion: 1,
    activityId: activity.id,
    title: activity.title,
    format,
    contentRevisionId: contentRevId,
    mediaRevisionId: mediaRev?.id,
    playbackRevisionId: playbackDoc.schemaVersion === 1 ? 'auto' : undefined,
    exportedAt: nowIso(),
    files: manifestFiles,
  };

  entries.push({
    path: 'manifest.json',
    data: JSON.stringify(manifest, null, 2),
  });

  // Package into zip
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

  // Run async export packaging
  setImmediate(async () => {
    try {
      const zipBuffer = await buildActivityExportPackage(config, database, store, activityId, options);
      const exportDir = resolve(config.artifactDirectory, 'activities', 'exports');
      mkdirSync(exportDir, { recursive: true });
      const exportPath = resolve(exportDir, `${jobId}.zip`);
      writeFileSync(exportPath, zipBuffer);

      const doneAt = nowIso();
      database.connection.prepare(`
        UPDATE activity_jobs
        SET status = 'succeeded', model_metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ exportPath, byteSize: zipBuffer.length }),
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
