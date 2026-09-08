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
          const slot = content.mediaSlots.find(s => s.id === slotId);
          return slot?.kind === 'video' ? '<div class="post-image">▶ 视频</div>' : `<img src="${escapeHtml(url)}" class="post-image" alt="配图" />`;
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
      .msg-name { font-size: 26px; color: #656565; }
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
      .post-meta { display: flex; justify-content: space-between; font-size: 28px; color: #656565; margin-top: 8px; }
      .post-comments-box { background: #f7f7f7; border-radius: 12px; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; font-size: 30px; }
      .post-likes { color: #576b95; font-weight: 600; border-bottom: 1px solid #eee; padding-bottom: 12px; }
      .comment-row { color: #333; }
      .comment-author { color: #576b95; font-weight: 600; }
      .bubble, .post-text { white-space: pre-wrap; }
      .media-overlay { position:absolute; inset:0; width:100%; height:100%; background:#080808; object-fit:contain; z-index:200; }
      div.media-overlay { display:flex; align-items:center; justify-content:center; }
      .media-overlay img { width:100%; height:100%; object-fit:contain; }
      .stage-card { position:absolute; inset:0; z-index:210; background:#ededed; display:flex; align-items:center; justify-content:center; padding:80px; font-size:54px; }
      .typing-indicator { position:absolute; bottom:30px; left:40px; z-index:150; background:#fff; padding:20px; font-size:30px; }
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
    <div id="root" data-composition-id="main" data-duration="${durationSec}" data-width="${width}" data-height="${height}">
      <div id="device-content">
      <div class="status-bar" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
        <span>18:30</span>
        <div class="status-icons"><span>5G</span><span>●●●</span><span>98%</span></div>
      </div>
      <div class="nav-bar" data-layout-allow-overlap="true" data-layout-allow-occlusion="true">
        <div id="nav-title-text" class="nav-title" data-layout-allow-overlap="true">
          <span>${escapeHtml(content.conversations[0]?.title || '群聊')}</span>
        </div>
        <div class="nav-action">•••</div>
      </div>
      <div class="viewport-container" data-layout-allow-overflow="true">
        <div id="chat-view">
          <div id="chat-scroll" class="chat-scroll">
            ${chatMessagesHtml}
          </div>
        </div>
        <div id="moments-view">
          <div id="moments-scroll" class="moments-scroll">
            <div class="moments-cover" data-layout-allow-overflow="true">
              <div class="moments-user-strip">
                <span class="moments-user-name">${escapeHtml(content.actors[0]?.displayName || '')}</span>
                <img src="${escapeHtml((content.actors[0]?.avatarAssetKey && assetMap[content.actors[0].avatarAssetKey]) || 'assets/default_avatar.png')}" class="moments-user-avatar" alt="用户头像" />
              </div>
            </div>
            ${momentsPostsHtml}
          </div>
        </div>
      </div>
      </div>
      ${mediaClips}
      <div id="stage-card" class="stage-card"></div>
      <div id="typing" class="typing-indicator">正在输入…</div>
    </div>
    <script>
      document.fonts.ready.then(() => {
        const actions = ${json(sortedActions)};
        const conversations = ${json(content.conversations.map(c => ({ id: c.id, title: c.title })))};
        const byId = id => document.getElementById(id);
        const messages = [...document.querySelectorAll('.msg-row')];
        const comments = [...document.querySelectorAll('.comment-row')];
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
        gsap.set([chat, moments, ...Object.values(scroll)], { x: 0, y: 0 });
        gsap.set([byId('stage-card'), byId('typing')], { autoAlpha: 0 });
        // Explicit reveal actions own visibility; archive-style scripts without them show all records.
        const reveals = actions.some(a => a.type === 'reveal_message' || a.visibleThroughOrder !== undefined);
        if (reveals) gsap.set(messages, { autoAlpha: 0 });
        for (const comment of comments) {
          if (actions.some(a => a.type === 'reveal_comments' && a.postId === comment.dataset.post)) gsap.set(comment, { autoAlpha: 0 });
        }
        gsap.set(moments, { autoAlpha: 0 });
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
            tl.set(isMoments ? moments : chat, { autoAlpha: 1 }, at);
            tl.set(isMoments ? chat : moments, { autoAlpha: 0 }, at + duration);
            tl.to([chat, moments], { x: isMoments ? -${width} : 0, duration, ease: 'power1.inOut' }, at);
            tl.set(nav, { textContent: isMoments ? '朋友圈' : (conversations.find(c => c.id === action.conversationId)?.title || conversations[0]?.title || '群聊') }, at);
            if (!isMoments && action.conversationId) {
              for (const el of messages) tl.set(el, { display: el.dataset.conversation === action.conversationId ? 'flex' : 'none' }, at);
              tl.set(scroll.message, { y: 0 }, at);
            }
          }
          if (action.type === 'reveal_message' || action.visibleThroughOrder !== undefined) {
            const target = action.targetId ? byId('msg_' + action.targetId) : null;
            visibleOrder = Math.max(visibleOrder, action.visibleThroughOrder ?? Number(target?.dataset.order || 0));
            for (const el of messages) if (Number(el.dataset.order) <= visibleOrder) tl.set(el, { autoAlpha: 1 }, at);
          }
          if (action.type === 'reveal_comments') {
            for (const el of comments) if (el.dataset.post === action.postId && Number(el.dataset.order) <= (action.throughOrder ?? Infinity)) tl.set(el, { autoAlpha: 1 }, at);
          }
          if (action.type === 'scroll_to') {
            const prefix = action.targetType === 'message' ? 'msg_' : action.targetType === 'comment' ? 'comment_' : 'post_';
            const box = offsets[prefix + action.targetId];
            if (box) {
              const align = action.align === 'end' ? 1 : action.align === 'start' ? 0 : 0.5;
              const y = Math.max(0, box.top - (${height - 198} - box.height) * align);
              tl.to(scroll[action.targetType], { y: -y, duration, ease: 'power1.inOut' }, at);
              if (action.targetType !== 'message') tl.set('.moments-cover', { autoAlpha: y >= 480 ? 0 : 1 }, at + duration);
            }
          }
          if (action.type === 'stage_card' || action.type === 'typing') {
            const el = byId(action.type === 'typing' ? 'typing' : 'stage-card');
            tl.set(el, { textContent: action.text || (action.type === 'typing' ? '正在输入…' : ''), autoAlpha: 1 }, at);
            tl.set(el, { autoAlpha: 0 }, at + duration);
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
