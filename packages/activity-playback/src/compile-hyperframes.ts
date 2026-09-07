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
  const width = playback.output.width || 1080;
  const height = playback.output.height || 1920;
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
                  <img src="${escapeHtml(url)}" class="media-thumb" alt="视频预览" />
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
        <div id="${escapeHtml(msg.id)}" class="msg-row ${isViewer ? 'right' : 'left'}" data-order="${msg.storyOrder}">
          <img src="${escapeHtml(avatarUrl)}" class="avatar" alt="${escapeHtml(actorName)}" />
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
          return `<img src="${escapeHtml(url)}" class="post-image" alt="配图" />`;
        })
        .join('');

      // Comments on this post
      const comments = content.comments.filter((c) => c.postId === post.id);
      const commentsHtml = comments
        .map((c) => {
          const cAuthor = actorMap.get(c.authorActorId)?.displayName || '好友';
          return `
            <div class="comment-row">
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
        <div id="${escapeHtml(post.id)}" class="moments-post" data-order="${post.storyOrder}">
          <img src="${escapeHtml(avatarUrl)}" class="avatar" alt="${escapeHtml(authorName)}" />
          <div class="post-content">
            <span class="post-author">${escapeHtml(authorName)}</span>
            <p class="post-text">${escapeHtml(post.text)}</p>
            ${mediaHtml}
            <div class="post-meta">
              <span>${escapeHtml(post.storyTimeLabel || '刚刚')}</span>
              <span>••</span>
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

  // Generate GSAP timeline script from playback actions
  const gsapTimelineCommands: string[] = [];
  const sortedActions = [...playback.actions].sort((a, b) => a.atMs - b.atMs);

  for (const action of sortedActions) {
    const startSec = action.atMs / 1000;
    const durSec = action.durationMs / 1000;

    switch (action.type) {
      case 'open_view':
        if (action.view === 'moments') {
          gsapTimelineCommands.push(`
            tl.call(() => { navTitle.innerHTML = '<span>朋友圈</span>'; }, null, ${startSec});
            tl.to(chatView, { x: -1080, duration: ${Math.max(0.3, durSec)}, ease: "power2.inOut" }, ${startSec});
            tl.to(momentsView, { x: -1080, duration: ${Math.max(0.3, durSec)}, ease: "power2.inOut" }, ${startSec});
          `);
        } else {
          gsapTimelineCommands.push(`
            tl.call(() => { navTitle.innerHTML = '<span>${escapeHtml(content.conversations[0]?.title || '群聊')}</span>'; }, null, ${startSec});
            tl.to(chatView, { x: 0, duration: ${Math.max(0.3, durSec)}, ease: "power2.inOut" }, ${startSec});
            tl.to(momentsView, { x: 0, duration: ${Math.max(0.3, durSec)}, ease: "power2.inOut" }, ${startSec});
          `);
        }
        break;

      case 'scroll_to':
        if (action.targetType === 'message' && action.targetId) {
          const idx = content.messages.findIndex((m) => m.id === action.targetId);
          const scrollTargetY = Math.max(0, idx * 240);
          gsapTimelineCommands.push(`
            tl.to(chatScroll, { y: -${scrollTargetY}, duration: ${durSec}, ease: "power2.inOut" }, ${startSec});
          `);
        } else if (action.targetType === 'post' && action.targetId) {
          const pIdx = content.posts.findIndex((p) => p.id === action.targetId);
          const scrollTargetY = Math.max(0, pIdx * 300);
          gsapTimelineCommands.push(`
            tl.to(momentsScroll, { y: -${scrollTargetY}, duration: ${durSec}, ease: "power2.inOut" }, ${startSec});
          `);
        }
        break;

      case 'open_media':
        if (action.kind === 'video') {
          const videoUrl = assetMap[action.assetKey || ''] || '';
          gsapTimelineCommands.push(`
            tl.call(() => {
              modalPhoto.style.display = 'none';
              modalVideo.src = '${escapeHtml(videoUrl)}';
              modalVideo.style.display = 'block';
              modalVideo.currentTime = ${(action.sourceInMs || 0) / 1000};
            }, null, ${startSec});
            tl.to(mediaModal, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${startSec});
          `);
        } else {
          const photoUrl = assetMap[action.assetKey || ''] || '';
          gsapTimelineCommands.push(`
            tl.call(() => {
              modalPhoto.src = '${escapeHtml(photoUrl)}';
              modalPhoto.style.display = 'block';
              modalVideo.style.display = 'none';
            }, null, ${startSec});
            tl.to(mediaModal, { opacity: 1, duration: 0.3, ease: "power1.out" }, ${startSec});
          `);
        }
        break;

      case 'close_media':
        gsapTimelineCommands.push(`
          tl.to(mediaModal, { opacity: 0, duration: ${durSec}, ease: "power1.in" }, ${startSec});
          tl.call(() => {
            modalPhoto.style.display = 'none';
            modalVideo.style.display = 'none';
            modalVideo.pause();
          }, null, ${startSec + durSec});
        `);
        break;

      case 'hold':
        gsapTimelineCommands.push(`
          tl.to({}, { duration: ${durSec} }, ${startSec});
        `);
        break;

      default:
        break;
    }
  }

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}, initial-scale=1.0" />
    <title>${escapeHtml(content.activity.title)} - 回放</title>
    <script src="assets/gsap.min.js"></script>
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
        background: #111;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        color: #1a1a1a;
        -webkit-font-smoothing: antialiased;
      }
      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        background: #ededed;
        overflow: hidden;
      }
      .status-bar {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 88px;
        padding: 0 48px;
        display: flex; justify-content: space-between; align-items: center;
        font-size: 32px; font-weight: 600; color: #000;
        z-index: 100; background: rgba(237, 237, 237, 0.96);
      }
      .status-icons { display: flex; gap: 16px; font-size: 28px; }
      .nav-bar {
        position: absolute; top: 88px; left: 0; width: 100%; height: 110px;
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 36px; background: #ededed;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08); z-index: 90;
      }
      .nav-title { font-size: 42px; font-weight: 600; color: #111; display: flex; align-items: center; gap: 12px; }
      .nav-action { font-size: 36px; color: #333; }
      .viewport-container {
        position: absolute; top: 198px; left: 0; width: ${width}px; height: ${height - 198}px;
        overflow: hidden;
      }
      #chat-view {
        position: absolute; top: 0; left: 0; width: ${width}px; height: ${height - 198}px;
        background: #ededed;
      }
      .chat-scroll {
        position: absolute; top: 0; left: 0; width: 100%;
        padding: 40px 36px 140px; display: flex; flex-direction: column; gap: 36px;
      }
      .msg-row { display: flex; gap: 24px; max-width: 860px; }
      .msg-row.right { align-self: flex-end; flex-direction: row-reverse; }
      .avatar {
        width: 96px; height: 96px; border-radius: 18px; object-fit: cover;
        background: #ccc; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      }
      .msg-body { display: flex; flex-direction: column; gap: 8px; }
      .msg-name { font-size: 26px; color: #777; }
      .msg-row.right .msg-name { text-align: right; }
      .bubble {
        padding: 24px 32px; border-radius: 20px; font-size: 36px;
        line-height: 1.45; position: relative; word-break: break-word;
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      }
      .bubble.left { background: #ffffff; color: #111; border-top-left-radius: 4px; }
      .bubble.right { background: #95ec69; color: #000; border-top-right-radius: 4px; }
      .media-bubble { padding: 0; border-radius: 20px; overflow: hidden; background: #000; display: inline-block; }
      .media-thumb { display: block; width: 440px; height: 280px; object-fit: cover; }
      .video-preview-wrapper { position: relative; width: 440px; height: 280px; }
      .play-badge {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        width: 72px; height: 72px; background: rgba(0,0,0,0.65); border-radius: 50%;
        display: flex; align-items: center; justify-content: center; color: #fff; font-size: 32px;
      }
      #moments-view {
        position: absolute; top: 0; left: ${width}px; width: ${width}px; height: ${height - 198}px;
        background: #ffffff; overflow: hidden;
      }
      .moments-scroll { position: absolute; top: 0; left: 0; width: 100%; padding-bottom: 80px; }
      .moments-cover {
        width: 100%; height: 480px; background: linear-gradient(135deg, #2b4c7e 0%, #1e3557 100%);
        position: relative; margin-bottom: 80px;
      }
      .moments-user-strip { position: absolute; right: 48px; bottom: -44px; display: flex; align-items: center; gap: 24px; }
      .moments-user-name { color: #fff; font-size: 38px; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.5); }
      .moments-user-avatar { width: 140px; height: 140px; border-radius: 24px; border: 4px solid #fff; object-fit: cover; }
      .moments-post { display: flex; gap: 28px; padding: 40px 48px; border-bottom: 1px solid #f0f0f0; }
      .post-content { flex: 1; display: flex; flex-direction: column; gap: 18px; }
      .post-author { font-size: 34px; font-weight: 600; color: #576b95; }
      .post-text { font-size: 36px; line-height: 1.5; color: #222; }
      .post-image { width: 520px; height: 320px; border-radius: 12px; object-fit: cover; }
      .post-meta { display: flex; justify-content: space-between; font-size: 28px; color: #999; margin-top: 8px; }
      .post-comments-box { background: #f7f7f7; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; font-size: 30px; }
      .post-likes { color: #576b95; font-weight: 600; border-bottom: 1px solid #eee; padding-bottom: 12px; }
      .comment-row { color: #333; }
      .comment-author { color: #576b95; font-weight: 600; }
      #media-modal {
        position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px;
        background: rgba(0, 0, 0, 0.94); display: flex; align-items: center; justify-content: center;
        z-index: 200; opacity: 0; pointer-events: none;
      }
      .modal-content { width: 960px; max-height: 1400px; display: flex; align-items: center; justify-content: center; }
      #modal-photo-img { width: 100%; max-height: 1300px; object-fit: contain; border-radius: 16px; display: none; }
      #modal-video-elem { width: 100%; max-height: 1300px; border-radius: 16px; display: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${durationSec}" data-width="${width}" data-height="${height}">
      <div class="status-bar">
        <span>18:30</span>
        <div class="status-icons"><span>5G</span><span>●●●</span><span>98%</span></div>
      </div>
      <div class="nav-bar">
        <div id="nav-title-text" class="nav-title">
          <span>${escapeHtml(content.conversations[0]?.title || '群聊')}</span>
        </div>
        <div class="nav-action">•••</div>
      </div>
      <div class="viewport-container">
        <div id="chat-view">
          <div id="chat-scroll" class="chat-scroll">
            ${chatMessagesHtml}
          </div>
        </div>
        <div id="moments-view">
          <div id="moments-scroll" class="moments-scroll">
            <div class="moments-cover">
              <div class="moments-user-strip">
                <span class="moments-user-name">${escapeHtml(content.actors[0]?.displayName || '')}</span>
                <img src="${escapeHtml((content.actors[0]?.avatarAssetKey && assetMap[content.actors[0].avatarAssetKey]) || 'assets/default_avatar.png')}" class="moments-user-avatar" alt="用户头像" />
              </div>
            </div>
            ${momentsPostsHtml}
          </div>
        </div>
      </div>
      <div id="media-modal">
        <div class="modal-content">
          <img id="modal-photo-img" src="" alt="展开图片" />
          <video id="modal-video-elem" playsinline preload="auto"></video>
        </div>
      </div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      const chatScroll = document.getElementById("chat-scroll");
      const chatView = document.getElementById("chat-view");
      const momentsView = document.getElementById("moments-view");
      const momentsScroll = document.getElementById("moments-scroll");
      const navTitle = document.getElementById("nav-title-text");
      const mediaModal = document.getElementById("media-modal");
      const modalPhoto = document.getElementById("modal-photo-img");
      const modalVideo = document.getElementById("modal-video-elem");

      ${gsapTimelineCommands.join('\n')}

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;

  return {
    html,
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
