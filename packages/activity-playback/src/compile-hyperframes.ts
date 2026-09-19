import type {
  ContentDocument,
  MediaRevisionDocument,
  PlaybackDocument,
} from '@sthstart/contracts';
import { escapeHtml } from './layout.js';
import type { CompiledHyperFramesProject } from './types.js';

export interface CompileOptions {
  assetUrlMap?: Record<string, string>; // assetKey -> relative path (e.g. assets/photo.png)
  standalone?: boolean;
  gsapSource?: string;
}

/**
 * Compiles an activity's content, media, and playback documents into a
 * self-contained HyperFrames composition HTML.
 */
export function compileHyperFramesComposition(
  content: ContentDocument,
  media: MediaRevisionDocument,
  playback: PlaybackDocument,
  options: CompileOptions = {}
): CompiledHyperFramesProject {
  const assetMap = options.assetUrlMap || {};
  const durationSec = Math.max(1, Math.ceil(playback.totalDurationMs / 1000));

  /*
   * 两套坐标系，别再混用：
   *   output = 画布分辨率（手机 1080×1920 / 电脑 1920×1080），决定成片尺寸；
   *   layout = 逻辑视口（手机 360×640 / 电脑 1280×720），决定「看起来多大」。
   * ratio 把逻辑 px 换算成画布 px，CSS 因此只写一套逻辑数值，
   * 同一份动作序列在横竖两种画布下都能编译出正确比例。
   */
  const width = playback.output.width || 1080;
  const height = playback.output.height || 1920;
  const isPhone = width <= height;
  const device = isPhone ? 'phone' : 'desktop';
  const layoutWidth = playback.layout.width || (isPhone ? 360 : 1280);
  const layoutHeight = playback.layout.height || (isPhone ? 640 : 720);
  const ratio = width / layoutWidth;
  const px = (value: number) => `${+(value * ratio).toFixed(2)}px`;
  const fps = playback.output.fps || 30;

  // Actor lookup
  const actorMap = new Map(content.actors.map((a) => [a.id, a]));
  const viewerId = playback.viewerActorId || content.actors[0]?.id;

  // Slot binding lookup
  const slotAssetMap = new Map<string, string>();
  for (const binding of media.slotBindings) {
    if (binding.assets[0]) {
      slotAssetMap.set(binding.slotId, binding.assets[0].assetKey);
    }
  }

  // Generate chat messages HTML
  const chatMessagesHtml = content.messages
    .map((msg) => {
      const isViewer = msg.speakerActorId === viewerId;
      const actor = msg.speakerActorId ? actorMap.get(msg.speakerActorId) : undefined;
      const avatarUrl = (actor?.avatarAssetKey && assetMap[actor.avatarAssetKey]) || 'assets/default_avatar.png';
      const actorName = actor?.displayName || '未知';

      const mediaHtml = msg.mediaSlotIds
        .map((slotId) => {
          const assetKey = slotAssetMap.get(slotId);
          const url = (assetKey && assetMap[assetKey]) || '';
          const slot = content.mediaSlots.find((s) => s.id === slotId);
          if (slot?.kind === 'video') {
            return `
              <div class="media-bubble">
                <div class="video-preview-wrapper">
                  <div class="media-thumb" aria-label="视频">视频</div>
                  <div class="play-badge">▶</div>
                </div>
              </div>`;
          }
          return `
            <div class="media-bubble">
              <img src="${escapeHtml(url)}" class="media-thumb" alt="图片" />
            </div>`;
        })
        .join('');

      return `
        <div id="msg_${escapeHtml(msg.id)}" data-conversation="${escapeHtml(msg.conversationId)}" class="msg-row ${isViewer ? 'right' : 'left'}" data-order="${msg.storyOrder}">
          <img src="${escapeHtml(avatarUrl)}" class="msg-avatar" alt="${escapeHtml(actorName)}" />
          <div class="msg-body">
            <span class="msg-name">${escapeHtml(actorName)}</span>
            <div class="bubble ${isViewer ? 'right' : 'left'}">${escapeHtml(msg.text)}</div>
            ${mediaHtml}
          </div>
        </div>`;
    })
    .join('\n');

  // Generate moments posts HTML
  const momentsPostsHtml = content.posts
    .map((post) => {
      const author = actorMap.get(post.authorActorId);
      const avatarUrl = (author?.avatarAssetKey && assetMap[author.avatarAssetKey]) || 'assets/default_avatar.png';
      const authorName = author?.displayName || '未知';

      const mediaHtml = post.mediaSlotIds
        .map((slotId) => {
          const assetKey = slotAssetMap.get(slotId);
          const url = (assetKey && assetMap[assetKey]) || '';
          const slot = content.mediaSlots.find((s) => s.id === slotId);
          return slot?.kind === 'video'
            ? '<div class="post-image">▶ 视频</div>'
            : `<img src="${escapeHtml(url)}" class="post-image" alt="配图" />`;
        })
        .join('');

      // Comments on this post
      const comments = content.comments.filter((c) => c.postId === post.id);
      const commentsHtml = comments
        .map((c) => {
          const cAuthor = actorMap.get(c.authorActorId)?.displayName || '好友';
          return `
              <div id="comment_${escapeHtml(c.id)}" class="comment-row" data-post="${escapeHtml(post.id)}" data-order="${c.storyOrder}">
                <span class="comment-author">${escapeHtml(cAuthor)}：</span>${escapeHtml(c.text)}
              </div>`;
        })
        .join('');

      // Likes on this post
      const likes = content.likes.filter((l) => l.postId === post.id);
      const likesText = likes
        .map((l) => actorMap.get(l.actorId)?.displayName || '好友')
        .join(', ');

      return `
        <div id="post_${escapeHtml(post.id)}" class="moments-post" data-order="${post.storyOrder}">
          <div class="moments-card-header">
            <img src="${escapeHtml(avatarUrl)}" class="post-avatar" alt="${escapeHtml(authorName)}" />
            <div class="moments-author-col">
              <span class="post-author">${escapeHtml(authorName)}</span>
              <span class="post-time">${escapeHtml(post.storyTimeLabel || '刚刚')}</span>
            </div>
          </div>
          <div class="post-content">
            <p class="post-text">${escapeHtml(post.text)}</p>
            ${mediaHtml ? `<div class="post-images${post.mediaSlotIds.length === 1 ? ' single' : ''}">${mediaHtml}</div>` : ''}
            <div class="post-meta">
              <span>❤ ${likes.length} · 评论 ${comments.length}</span>
              <span>•••</span>
            </div>
            ${likes.length > 0 || comments.length > 0 ? `
              <div class="post-comments-box">
                ${likes.length > 0 ? `<div class="post-likes">❤️ ${escapeHtml(likesText)}</div>` : ''}
                ${commentsHtml}
              </div>
            ` : ''}
          </div>
        </div>`;
    })
    .join('\n');

  const sortedActions = [...playback.actions].sort((a, b) => a.atMs - b.atMs);
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const mediaClips = sortedActions.flatMap((action, index) => {
    if (action.type !== 'open_media') return [];
    const key = action.assetKey || slotAssetMap.get(action.slotId || '') || '';
    const src = escapeHtml(assetMap[key] || '');
    const next = sortedActions.slice(index + 1).find(a => a.type === 'close_media' || a.type === 'open_media');
    const end = Math.min(action.atMs + action.durationMs, next?.atMs ?? playback.totalDurationMs);
    const duration = Math.max(0, end - action.atMs) / 1000;
    if (!duration) return [];
    const timing = `data-start="${action.atMs / 1000}" data-duration="${duration}" data-media-start="${(action.sourceInMs || 0) / 1000}"`;
    return action.kind === 'video'
      ? [`<video id="media_${index}" class="clip media-overlay" src="${src}" ${timing} data-track-index="2" muted playsinline preload="auto"></video>`,
         `<audio id="sound_${index}" class="clip" src="${src}" ${timing} data-track-index="3" data-volume="${Math.max(0, Math.min(1, action.volume ?? 1))}" preload="auto"></audio>`]
      : [`<div id="media_${index}" class="clip media-overlay" data-start="${action.atMs / 1000}" data-duration="${duration}" data-track-index="2"><img src="${src}" alt="展开图片" /></div>`];
  }).join('\n');

  /*
   * 逻辑 px 尺寸表：数值一律按逻辑视口书写（手机 360 宽、电脑 1280 宽），
   * 再由 px() 乘 ratio 换算成画布 px。字号量级取自邻舍
   * （气泡 14px/1.6、头像 42px 圆形、卡片圆角 16px），两种画布观感一致。
   */
  const m = isPhone
    ? {
        statusH: 28, navH: 44, barPadX: 14, statusFont: 11, navFont: 15,
        chatPadY: 14, chatPadX: 14, chatPadBottom: 40, chatGap: 12,
        avatar: 40, rowGap: 10, rowMax: 300, nameFont: 11.5,
        bubbleFont: 14, bubblePadY: 9, bubblePadX: 12, bubbleRadius: 12,
        mediaW: 200, mediaH: 140, playBadge: 34,
        momentsPadY: 10, momentsPadX: 10, momentsPadBottom: 30, momentsGap: 10,
        postRadius: 14, postPad: 14, postGap: 8, postAvatar: 32,
        postAuthorFont: 13.5, postTimeFont: 11, postTextFont: 13.5, postImageH: 120,
        metaFont: 11.5, commentFont: 12.5,
        stagePad: 40, stageGap: 12, stageLabel: 11, stageLetter: 4, stageText: 22,
        typingBottom: 14, typingLeft: 14, typingFont: 12,
        topBarH: 0, navWidth: 0, bodyGap: 0, bodyPadX: 0, bodyPadBottom: 0,
      }
    : {
        statusH: 0, navH: 0, barPadX: 18, statusFont: 0, navFont: 15,
        chatPadY: 16, chatPadX: 18, chatPadBottom: 40, chatGap: 12,
        avatar: 34, rowGap: 10, rowMax: 380, nameFont: 12,
        bubbleFont: 14, bubblePadY: 10, bubblePadX: 14, bubbleRadius: 12,
        mediaW: 260, mediaH: 170, playBadge: 36,
        momentsPadY: 14, momentsPadX: 14, momentsPadBottom: 40, momentsGap: 12,
        postRadius: 16, postPad: 18, postGap: 10, postAvatar: 40,
        postAuthorFont: 14.5, postTimeFont: 12, postTextFont: 14.5, postImageH: 150,
        metaFont: 12.5, commentFont: 13,
        stagePad: 60, stageGap: 14, stageLabel: 12, stageLetter: 6, stageText: 30,
        typingBottom: 16, typingLeft: 16, typingFont: 12.5,
        topBarH: 56, navWidth: 240, bodyGap: 14, bodyPadX: 16, bodyPadBottom: 16,
      };

  /*
   * 内容可视高度（逻辑 px）：手机扣状态栏与导航栏，电脑扣顶栏与内边距。
   * 滚动定位需要画布 px，因此使用时乘回 ratio。
   */
  const viewportLogicalH = isPhone
    ? layoutHeight - (m.statusH + m.navH)
    : layoutHeight - m.topBarH - m.bodyPadBottom;

  const stageNavHtml = [...content.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage, index) => `
          <div class="stage-nav-item" data-stage-id="${escapeHtml(stage.id)}">
            <span class="idx">${index + 1}</span>
            <span class="stage-nav-title">${escapeHtml(stage.title)}</span>
          </div>`)
    .join('');

  const phoneChromeHtml = `
      <div class="status-bar" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
        <span>18:30</span>
        <div class="status-icons"><span>5G</span><span>●●●</span><span>98%</span></div>
      </div>
      <div class="nav-bar" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
        <div id="nav-title-text" class="nav-title" data-layout-allow-overlap="true"><span>${escapeHtml(content.conversations[0]?.title || '群聊')}</span></div>
        <div class="nav-action">•••</div>
      </div>`;

  const desktopChromeHtml = `
      <div class="top-bar">
        <span class="app-dot"></span>
        <div id="nav-title-text" class="nav-title"><span>${escapeHtml(content.conversations[0]?.title || '群聊')}</span></div>
        <div class="nav-action">•••</div>
      </div>`;

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}, initial-scale=1.0" />
    <title>${escapeHtml(content.activity.title)} - 回放</title>
    ${options.gsapSource ? `<script>${options.gsapSource.replace(/<\/script/gi, '<\\/script')}</script>` : '<script src="assets/gsap.min.js"></script>'}
    <style>
      @font-face {
        font-family: 'PingFang SC';
        src: local('PingFang SC');
      }
      @font-face {
        font-family: 'Hiragino Sans GB';
        src: local('Hiragino Sans GB');
      }
      @font-face {
        font-family: 'Microsoft YaHei';
        src: local('Microsoft YaHei');
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${isPhone ? '#f4efe7' : '#efe7db'};
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: #3d3229;
        -webkit-font-smoothing: antialiased;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: inherit;
      }
      #device-content { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
      .bubble, .post-text { white-space: pre-wrap; }

      /* ── 手机版式：单列，群聊与朋友圈左右平铺后整屏平移 ── */
      .device-phone .status-bar {
        position: absolute; top: 0; left: 0; width: 100%; height: ${px(m.statusH)};
        padding: 0 ${px(m.barPadX)}; display: flex; justify-content: space-between; align-items: center;
        font-size: ${px(m.statusFont)}; font-weight: 600; color: #3d3229;
        z-index: 100; background: rgba(250, 247, 242, 0.94);
      }
      .device-phone .status-icons { display: flex; gap: ${px(6)}; font-size: ${px(10)}; }
      .device-phone .nav-bar {
        position: absolute; top: ${px(m.statusH)}; left: 0; width: 100%; height: ${px(m.navH)};
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 ${px(m.barPadX)}; background: rgba(250, 247, 242, 0.94);
        border-bottom: 1px solid rgba(61, 50, 41, 0.08); z-index: 90;
      }
      .device-phone .nav-title { font-size: ${px(m.navFont)}; font-weight: 600; color: #3d3229; }
      .device-phone .nav-action { font-size: ${px(14)}; color: #8a7d70; }
      .device-phone .viewport-container {
        position: absolute; top: ${px(m.statusH + m.navH)}; left: 0;
        width: ${px(layoutWidth)}; height: ${px(viewportLogicalH)};
        overflow: hidden; background: #f4efe7;
      }
      .device-phone #chat-view {
        position: absolute; top: 0; left: 0;
        width: ${px(layoutWidth)}; height: ${px(viewportLogicalH)};
      }
      .device-phone #moments-view {
        position: absolute; top: 0; left: ${px(layoutWidth)};
        width: ${px(layoutWidth)}; height: ${px(viewportLogicalH)};
        overflow: hidden;
      }

      /* ── 电脑版式：阶段导航 + 群聊 + 朋友圈三栏常驻，open_view 只切换焦点 ── */
      .device-desktop .top-bar {
        position: absolute; top: 0; left: 0; width: 100%; height: ${px(m.topBarH)};
        display: flex; align-items: center; gap: ${px(10)};
        padding: 0 ${px(m.barPadX)}; border-bottom: 1px solid rgba(61, 50, 41, 0.08);
      }
      .device-desktop .app-dot { width: ${px(10)}; height: ${px(10)}; border-radius: 50%; background: #b8563f; flex-shrink: 0; }
      .device-desktop .nav-title { font-size: ${px(m.navFont)}; font-weight: 600; color: #3d3229; }
      .device-desktop .nav-action { margin-left: auto; font-size: ${px(14)}; color: #8a7d70; }
      .device-desktop .desktop-body {
        position: absolute; top: ${px(m.topBarH)}; left: 0;
        width: ${px(layoutWidth)}; height: ${px(layoutHeight - m.topBarH)};
        display: flex; gap: ${px(m.bodyGap)};
        padding: 0 ${px(m.bodyPadX)} ${px(m.bodyPadBottom)};
      }
      .device-desktop .pane {
        background: #fffdf9; border-radius: ${px(16)};
        box-shadow: 0 2px 12px rgba(61, 50, 41, 0.06);
        overflow: hidden; position: relative;
      }
      .device-desktop #stage-nav {
        width: ${px(m.navWidth)}; flex: 0 0 auto;
        padding: ${px(12)}; display: flex; flex-direction: column; gap: ${px(6)};
      }
      .device-desktop #chat-view, .device-desktop #moments-view { flex: 1 1 0; min-width: 0; }
      .stage-nav-item {
        display: flex; align-items: center; gap: ${px(8)};
        padding: ${px(8)} ${px(10)}; border-radius: ${px(10)};
        font-size: ${px(12.5)}; color: #8a7d70; background-color: rgba(247, 237, 228, 0);
      }
      .stage-nav-item .idx {
        width: ${px(18)}; height: ${px(18)}; border-radius: 50%;
        background: rgba(61, 50, 41, 0.08);
        display: flex; align-items: center; justify-content: center;
        font-size: ${px(10.5)}; flex-shrink: 0;
      }
      .stage-nav-item .stage-nav-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* ── 群聊 ── */
      .chat-scroll {
        position: absolute; top: 0; left: 0; width: 100%;
        padding: ${px(m.chatPadY)} ${px(m.chatPadX)} ${px(m.chatPadBottom)};
        display: flex; flex-direction: column; gap: ${px(m.chatGap)};
      }
      .msg-row { display: flex; gap: ${px(m.rowGap)}; max-width: ${px(m.rowMax)}; }
      .msg-row.right { align-self: flex-end; flex-direction: row-reverse; }
      .msg-avatar {
        width: ${px(m.avatar)}; height: ${px(m.avatar)}; border-radius: 50%;
        object-fit: cover; background: #e0c9b8; flex-shrink: 0; display: block;
      }
      .msg-body { display: flex; flex-direction: column; gap: ${px(3)}; min-width: 0; }
      .msg-name { font-size: ${px(m.nameFont)}; color: #8a7d70; margin: 0 ${px(4)}; }
      .msg-row.right .msg-name { text-align: right; }
      .bubble {
        padding: ${px(m.bubblePadY)} ${px(m.bubblePadX)};
        border-radius: ${px(m.bubbleRadius)}; font-size: ${px(m.bubbleFont)};
        line-height: 1.6; position: relative; word-break: break-word;
        box-shadow: 0 2px 10px rgba(61, 50, 41, 0.06);
      }
      .bubble.left { background: #fffdf9; color: #3d3229; }
      .bubble.right { background: #b8563f; color: #f7ede4; }
      .media-bubble { padding: ${px(3)}; border-radius: ${px(m.bubbleRadius)}; overflow: hidden; background: #efe7db; display: inline-block; }
      .media-thumb { display: block; width: ${px(m.mediaW)}; height: ${px(m.mediaH)}; object-fit: cover; border-radius: ${px(8)}; }
      .video-preview-wrapper { position: relative; width: ${px(m.mediaW)}; height: ${px(m.mediaH)}; }
      .play-badge {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: ${px(m.playBadge)}; height: ${px(m.playBadge)}; background: rgba(61, 50, 41, 0.55);
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        color: #fff; font-size: ${px(m.playBadge * 0.42)};
      }

      /* ── 朋友圈：邻舍 MomentCard 同构，白卡 + 头像行 + 正文 + 图片网格 + 评论框 ── */
      .moments-scroll {
        position: absolute; top: 0; left: 0; width: 100%;
        padding: ${px(m.momentsPadY)} ${px(m.momentsPadX)} ${px(m.momentsPadBottom)};
        display: flex; flex-direction: column; gap: ${px(m.momentsGap)};
      }
      .moments-post {
        background: #fffdf9; border-radius: ${px(m.postRadius)};
        padding: ${px(m.postPad)}; box-shadow: 0 2px 12px rgba(61, 50, 41, 0.06);
        display: flex; flex-direction: column; gap: ${px(m.postGap)};
      }
      .moments-card-header { display: flex; align-items: center; gap: ${px(10)}; }
      .post-avatar {
        width: ${px(m.postAvatar)}; height: ${px(m.postAvatar)}; border-radius: 50%;
        object-fit: cover; background: #e0c9b8; flex-shrink: 0; display: block;
      }
      .moments-author-col { display: flex; flex-direction: column; gap: ${px(1)}; min-width: 0; }
      .post-author { font-size: ${px(m.postAuthorFont)}; font-weight: 600; color: #3d3229; }
      .post-time { font-size: ${px(m.postTimeFont)}; color: #b3a696; }
      .post-content { display: flex; flex-direction: column; gap: ${px(7)}; min-width: 0; }
      .post-text { font-size: ${px(m.postTextFont)}; line-height: 1.7; color: #4a4038; }
      .post-images { display: grid; grid-template-columns: 1fr 1fr; gap: ${px(5)}; border-radius: ${px(9)}; overflow: hidden; }
      .post-images.single { grid-template-columns: 1fr; }
      .post-image { width: 100%; height: ${px(m.postImageH)}; object-fit: cover; border-radius: ${px(8)}; display: block; }
      div.post-image { display: flex; align-items: center; justify-content: center; background: #3d3229; color: #fff; font-size: ${px(12)}; }
      .post-meta { display: flex; justify-content: space-between; font-size: ${px(m.metaFont)}; color: #b3a696; }
      .post-comments-box {
        background: rgba(61, 50, 41, 0.05); border-radius: ${px(9)};
        padding: ${px(8)} ${px(10)}; display: flex; flex-direction: column; gap: ${px(5)};
        font-size: ${px(m.commentFont)};
      }
      .post-likes { color: #b8563f; font-weight: 600; }
      .comment-row { color: #4a4038; line-height: 1.55; }
      .comment-author { color: #b8563f; font-weight: 600; }

      /* ── 媒体放大层与阶段卡 ── */
      .media-overlay { position: absolute; inset: 0; width: 100%; height: 100%; background: #080808; object-fit: contain; z-index: 200; }
      div.media-overlay { display: flex; align-items: center; justify-content: center; }
      .media-overlay img { width: 100%; height: 100%; object-fit: contain; }
      .stage-card {
        position: absolute; inset: 0; z-index: 210;
        background: linear-gradient(160deg, #f6efe6 0%, #efe3d3 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: ${px(m.stagePad)}; gap: ${px(m.stageGap)};
      }
      .stage-card-label { font-size: ${px(m.stageLabel)}; letter-spacing: ${px(m.stageLetter)}; color: #b8563f; font-weight: 600; }
      .stage-card-text { font-size: ${px(m.stageText)}; font-weight: 700; color: #3d3229; text-align: center; line-height: 1.5; }
      .typing-indicator {
        position: absolute; bottom: ${px(m.typingBottom)}; left: ${px(m.typingLeft)}; z-index: 150;
        background: #fffdf9; border-radius: ${px(11)};
        padding: ${px(7)} ${px(11)}; font-size: ${px(m.typingFont)}; color: #8a7d70;
        box-shadow: 0 2px 10px rgba(61, 50, 41, 0.08);
      }
    </style>
  </head>
  <body>
    <div id="root" class="device-${device}" data-composition-id="main" data-duration="${durationSec}" data-width="${width}" data-height="${height}">
      <div id="device-content">
      ${isPhone ? phoneChromeHtml : desktopChromeHtml}
      ${isPhone ? `<div class="viewport-container" data-layout-allow-overflow="true">
        <div id="chat-view">
          <div id="chat-scroll" class="chat-scroll">
            ${chatMessagesHtml}
          </div>
        </div>
        <div id="moments-view">
          <div id="moments-scroll" class="moments-scroll">
            ${momentsPostsHtml}
          </div>
        </div>
      </div>` : `<div class="desktop-body" data-layout-allow-overflow="true">
        <div id="stage-nav" class="pane">${stageNavHtml}
        </div>
        <div id="chat-view" class="pane">
          <div id="chat-scroll" class="chat-scroll">
            ${chatMessagesHtml}
          </div>
        </div>
        <div id="moments-view" class="pane">
          <div id="moments-scroll" class="moments-scroll">
            ${momentsPostsHtml}
          </div>
        </div>
      </div>`}
      </div>
      ${mediaClips}
      <div id="stage-card" class="stage-card"><span class="stage-card-label">STAGE</span><span id="stage-card-text" class="stage-card-text"></span></div>
      <div id="typing" class="typing-indicator">正在输入…</div>
    </div>
    <script>
      document.fonts.ready.then(() => {
        const actions = ${json(sortedActions)};
        const conversations = ${json(content.conversations.map(c => ({ id: c.id, title: c.title })))};
        const isPhone = ${isPhone};
        // 滚动定位的可用高度（画布 px），与 offsetTop/offsetHeight 同一坐标系。
        const viewportH = ${viewportLogicalH * ratio};
        const byId = id => document.getElementById(id);
        const messages = [...document.querySelectorAll('.msg-row')];
        const comments = [...document.querySelectorAll('.comment-row')];
        const stageNavItems = [...document.querySelectorAll('.stage-nav-item')];
        const offsets = {};
        // Measure each conversation's real text/media layout once at the render dimensions.
        for (const conversation of conversations) {
          messages.forEach(el => { el.style.display = el.dataset.conversation === conversation.id ? 'flex' : 'none'; });
          messages.filter(el => el.dataset.conversation === conversation.id).forEach(el => { offsets[el.id] = { top: el.offsetTop, height: el.offsetHeight }; });
        }
        document.querySelectorAll('.moments-post,.comment-row').forEach(el => {
          const base = byId('moments-scroll').getBoundingClientRect();
          const box = el.getBoundingClientRect(); offsets[el.id] = { top: box.top - base.top, height: box.height };
        });
        const initialConversation = conversations[0]?.id;
        messages.forEach(el => { el.style.display = el.dataset.conversation === initialConversation ? 'flex' : 'none'; });
        const tl = gsap.timeline({ paused: true });
        const chat = byId('chat-view'), moments = byId('moments-view'), nav = byId('nav-title-text');
        const scroll = { message: byId('chat-scroll'), post: byId('moments-scroll'), comment: byId('moments-scroll') };
        gsap.set([...Object.values(scroll)], { x: 0, y: 0 });
        if (isPhone) {
          gsap.set([chat, moments], { x: 0, y: 0 });
          gsap.set(moments, { autoAlpha: 0 });
        } else {
          // 桌面双栏常驻：初始群聊为焦点，朋友圈压暗。
          gsap.set(chat, { opacity: 1 });
          gsap.set(moments, { opacity: 0.5 });
        }
        gsap.set([byId('stage-card'), byId('typing')], { autoAlpha: 0 });
        // Explicit reveal actions own visibility; archive-style scripts without them show all records.
        const reveals = actions.some(a => a.type === 'reveal_message' || a.visibleThroughOrder !== undefined);
        if (reveals) gsap.set(messages, { autoAlpha: 0 });
        for (const comment of comments) {
          if (actions.some(a => a.type === 'reveal_comments' && a.postId === comment.dataset.post)) gsap.set(comment, { autoAlpha: 0 });
        }
        for (const clip of document.querySelectorAll('.media-overlay')) {
          const at = Number(clip.dataset.start), end = at + Number(clip.dataset.duration);
          tl.set(byId('device-content'), { autoAlpha: 0 }, at);
          tl.set(byId('device-content'), { autoAlpha: 1 }, end);
        }
        let visibleOrder = 0;
        for (const action of actions) {
          const at = action.atMs / 1000, duration = action.durationMs / 1000;
          if (action.type === 'open_view') {
            const isMoments = action.view === 'moments';
            tl.set(nav, { textContent: isMoments ? '朋友圈' : (conversations.find(c => c.id === action.conversationId)?.title || conversations[0]?.title || '群聊') }, at);
            if (isPhone) {
              tl.set(isMoments ? moments : chat, { autoAlpha: 1 }, at);
              tl.set(isMoments ? chat : moments, { autoAlpha: 0 }, at + duration);
              tl.to([chat, moments], { x: isMoments ? -${width} : 0, duration, ease: 'power1.inOut' }, at);
            } else {
              // 桌面两栏都在场，只调暗非焦点栏；不做横向位移。
              tl.set(isMoments ? moments : chat, { opacity: 1 }, at);
              tl.set(isMoments ? chat : moments, { opacity: 0.5 }, at);
            }
            if (!isMoments && action.conversationId) {
              for (const el of messages) tl.set(el, { display: el.dataset.conversation === action.conversationId ? 'flex' : 'none' }, at);
              tl.set(scroll.message, { y: 0 }, at);
            }
          }
          if (action.type === 'reveal_message' || action.visibleThroughOrder !== undefined) {
            const target = action.targetId ? byId('msg_' + action.targetId) : null;
            visibleOrder = Math.max(visibleOrder, action.visibleThroughOrder ?? Number(target?.dataset.order || 0));
            for (const el of messages) if (Number(el.dataset.order) <= visibleOrder) tl.set(el, { autoAlpha: 1 }, at);
            /*
             * 聊天区要跟着新消息上滚，否则后面的对白全部落在可视区外，
             * 回放看起来就像「只有前几条」。这里让最新一条贴底显示。
             */
            const box = target ? offsets[target.id] : null;
            if (box) {
              const y = Math.max(0, box.top + box.height + ${12 * ratio} - viewportH);
              tl.to(scroll.message, { y: -y, duration: Math.min(duration, 0.6), ease: 'power1.out' }, at);
            }
          }
          if (action.type === 'reveal_comments') {
            for (const el of comments) if (el.dataset.post === action.postId && Number(el.dataset.order) <= (action.throughOrder ?? Infinity)) tl.set(el, { autoAlpha: 1 }, at);
          }
          if (action.type === 'scroll_to') {
            const prefix = action.targetType === 'message' ? 'msg_' : action.targetType === 'comment' ? 'comment_' : 'post_';
            const box = offsets[prefix + action.targetId];
            if (box) {
              const align = action.align === 'end' ? 1 : action.align === 'start' ? 0 : 0.5;
              const y = Math.max(0, box.top - (viewportH - box.height) * align);
              tl.to(scroll[action.targetType], { y: -y, duration, ease: 'power1.inOut' }, at);
            }
          }
          if (action.type === 'stage_card' || action.type === 'typing') {
            const el = action.type === 'typing' ? byId('typing') : byId('stage-card-text');
            tl.set(el, { textContent: action.text || (action.type === 'typing' ? '正在输入…' : ''), autoAlpha: 1 }, at);
            if (action.type !== 'typing') tl.set(byId('stage-card'), { autoAlpha: 1 }, at);
            tl.set(el, { autoAlpha: 0 }, at + duration);
            if (action.type !== 'typing') tl.set(byId('stage-card'), { autoAlpha: 0 }, at + duration);
          }
          // 桌面阶段导航高亮：写内联样式而非 class，保证正反向 seek 后状态一致。
          if (action.type === 'stage_card') {
            for (const item of stageNavItems) {
              const on = item.dataset.stageId === action.stageId;
              tl.set(item, { backgroundColor: on ? '#f7ede4' : 'rgba(247, 237, 228, 0)', color: on ? '#b8563f' : '#8a7d70' }, at);
            }
          }
        }
        tl.to({}, { duration: ${durationSec} }, 0);
        window.__timelines = window.__timelines || {};
        window.__timelines.main = tl;
        tl.seek(0);
      });
    </script>
  </body>
</html>`;

  return {
    html: html.split('\n').map((line) => line.trimEnd()).join('\n'),
    assets: [],
    manifest: {
      schemaVersion: 1,
      templateId: playback.template.id,
      templateVersion: playback.template.version,
      durationSeconds: durationSec,
      width,
      height,
      fps,
    },
  };
}

