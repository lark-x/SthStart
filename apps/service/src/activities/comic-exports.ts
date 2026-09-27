import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import opentype from 'opentype.js';
import { layoutBubbleText, panelLayoutForPage } from '@sthstart/activity-playback';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ComicExportReaderRequestSchema } from '@sthstart/contracts';
import type { ComicDocument } from '@sthstart/contracts';
import type { ServiceConfig } from '../config.js';
import type { ServiceDatabase } from '../database.js';
import { hasArtifactAccess, resolveArtifactStoragePath } from '../artifacts.js';
import { createZip, type ZipEntryInput } from './zip.js';
import { ComicStore } from './comic-store.js';
import { ActivityStore } from './store.js';
import { validateComicDocument } from './comic-validation.js';

type AdminCheck = (request: FastifyRequest, reply: FastifyReply) => boolean;

function exportError(code: string, message: string, statusCode = 409, details?: string[]) {
  return Object.assign(new Error(message), { code, statusCode, details });
}

function sourceFile(...segments: string[]) {
  return resolve(import.meta.dirname, '../../../../', ...segments);
}

function readerBundlePath() {
  const paths = [
    resolve(import.meta.dirname, '../../dist/activities/comic-reader/reader.js'),
    resolve(process.cwd(), 'apps/service/dist/activities/comic-reader/reader.js'),
    resolve(process.cwd(), 'dist/activities/comic-reader/reader.js'),
  ];
  return paths.find((path) => existsSync(path)) ?? null;
}

function extensionFor(contentType: string | null) {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif',
  };
  return normalized ? extensions[normalized] ?? null : null;
}

let comicFont: opentype.Font | null = null;
function validateBubbleLayout(document: ComicDocument, fontPath: string) {
  comicFont ??= opentype.loadSync(fontPath);
  const font = comicFont;
  const panels = new Map(document.panels.map((panel) => [panel.id, panel]));
  const issues: string[] = [];
  for (const [pageIndex, page] of document.pages.entries()) {
    for (const { panelId, rect } of panelLayoutForPage(page.template, page.panelIds)) {
      const panel = panels.get(panelId);
      if (!panel) continue;
      for (const bubble of panel.bubbles) {
        const context = { measureText: (text: string) => ({ width: font.getAdvanceWidth(text, bubble.fontSize) }) } as CanvasRenderingContext2D;
        const layout = layoutBubbleText(context, bubble, bubble.rect.width * rect.width - 36, bubble.rect.height * rect.height - 36);
        if (layout.overflow) issues.push(`第 ${pageIndex + 1} 页，画格 ${panelId}，气泡 ${bubble.id} 的文字超出边界`);
      }
    }
  }
  if (issues.length) throw exportError('comic_bubble_overflow', '离线导出已停止；请扩大气泡、缩短文字或调整字号。', 409, issues);
}

export function buildComicOfflineReaderZip(input: {
  database: ServiceDatabase; config: ServiceConfig; activityId: string; document: ComicDocument; revisionId: string;
}): Buffer {
  const readerPath = readerBundlePath();
  if (!readerPath) throw exportError('comic_reader_build_missing', '离线阅读器尚未构建；请先执行服务构建后再导出。', 503);
  const fontPath = sourceFile('public', 'fonts', 'NotoSansSC-VF.ttf');
  const licensePath = sourceFile('public', 'fonts', 'NotoSansSC-OFL.txt');
  if (!existsSync(fontPath) || !existsSync(licensePath)) throw exportError('comic_font_missing', '本地漫画字体或许可证文件缺失，不能生成离线包。', 503);
  validateBubbleLayout(input.document, fontPath);

  const entries: ZipEntryInput[] = [
    { path: 'assets/reader.js', data: readFileSync(readerPath) },
    { path: 'assets/fonts/NotoSansSC-VF.ttf', data: readFileSync(fontPath) },
    { path: 'licenses/NotoSansSC-OFL.txt', data: readFileSync(licensePath) },
    { path: 'README.txt', data: '漫画离线阅读包\n\n双击 index.html 即可在本地浏览器打开。所有图片、阅读脚本与字体均包含在此文件夹中，不会访问网络。\n' },
  ];
  const imagePaths: Record<string, string> = {};
  const seen = new Set<string>();
  const missing: string[] = [];
  let imageIndex = 0;
  for (const panel of input.document.panels) {
    const selected = panel.selectedImage;
    if (!selected) { missing.push(`页面画格 ${panel.id} 未选择图片`); continue; }
    if (seen.has(selected.artifactId)) { imagePaths[selected.artifactId] = imagePaths[selected.artifactId]!; continue; }
    const row = input.database.connection.prepare('SELECT app_id,media_type,content_type FROM artifacts WHERE id=?').get(selected.artifactId) as
      { app_id: string; media_type: string | null; content_type: string | null } | undefined;
    if (!row || row.app_id !== 'activities' || !(row.media_type === 'image' || row.media_type?.startsWith('image/'))
      || !hasArtifactAccess(input.database, selected.artifactId, 'activities', 'read')) {
      missing.push(`画格 ${panel.id} 的图片产物不可访问`);
      continue;
    }
    const extension = extensionFor(row.content_type);
    if (!extension) { missing.push(`画格 ${panel.id} 的图片格式暂不支持离线导出`); continue; }
    const localPath = resolveArtifactStoragePath(input.database, selected.artifactId, input.config.artifactDirectory);
    if (!localPath) { missing.push(`画格 ${panel.id} 的图片文件已丢失`); continue; }
    imageIndex++;
    const path = `assets/images/image-${String(imageIndex).padStart(3, '0')}${extension}`;
    imagePaths[selected.artifactId] = path;
    seen.add(selected.artifactId);
    entries.push({ path, data: readFileSync(localPath) });
  }
  if (missing.length) throw exportError('comic_export_images_unavailable', '离线导出已停止；请为所有画格补选可读取的图片。', 409, missing);

  const payload = JSON.stringify({ document: input.document, imagePaths }).replaceAll('<', '\\u003c');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>漫画离线阅读</title><style>
@font-face{font-family:"Sthstart Comic Noto Sans SC";src:url("assets/fonts/NotoSansSC-VF.ttf") format("truetype");font-weight:100 900;font-display:block}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#211f1b;color:#f6f1e7;font-family:"Sthstart Comic Noto Sans SC",sans-serif}body{display:flex;flex-direction:column;min-height:100dvh}
header,nav,footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#302d27}header{border-bottom:1px solid #514b40}#comic-reader{display:flex;min-height:0;flex:1;flex-direction:column}main{display:flex;min-height:0;flex:1;align-items:center;justify-content:center;padding:12px;overflow:auto}canvas{display:block;width:auto;height:auto;max-width:100%;max-height:100%;aspect-ratio:16/9;background:#f3eddf;box-shadow:0 10px 36px #0008}button{min-height:40px;border:1px solid #817666;border-radius:8px;background:#423d34;color:#fff;padding:8px 14px;font:inherit}button:disabled{opacity:.45}footer{justify-content:center;color:#d2c8b7;font-size:13px;border-top:1px solid #514b40}
#comic-focus-canvas,#comic-transcript{display:none}
@media(max-width:600px){header,nav{padding:10px}nav{justify-content:center;flex-wrap:wrap}main{padding:8px;flex-direction:column;gap:12px}#comic-canvas{display:none}#comic-focus-canvas{display:block;max-height:55dvh}#comic-focus-canvas[hidden]{display:none}#comic-transcript{display:block;width:100%;max-height:20dvh;overflow:auto;background:#302d27;padding:12px 16px;border-radius:8px;font-size:16px;line-height:1.6}#comic-transcript p{margin:0 0 8px}}
</style></head><body><header><strong>漫画离线阅读</strong><span id="comic-page-title"></span></header>
<div id="comic-reader"><main><canvas id="comic-canvas" width="1920" height="1080" aria-label="漫画画面"></canvas><div id="comic-transcript" aria-live="polite"></div><canvas id="comic-focus-canvas" hidden aria-label="当前画格"></canvas></main>
<nav><button id="comic-previous" type="button" disabled>上一格</button><button id="comic-play" type="button">自动播放</button><button id="comic-next" type="button">下一步</button></nav></div>
<footer id="comic-status" aria-live="polite">正在加载漫画资源…</footer><script id="comic-data" type="application/json">${payload}</script><script src="assets/reader.js"></script></body></html>`;
  entries.unshift({ path: 'index.html', data: html });
  return createZip(entries);
}

export function registerComicExportRoutes(app: FastifyInstance, config: ServiceConfig, database: ServiceDatabase, checkAdmin: AdminCheck) {
  const comicStore = new ComicStore(database);
  const activityStore = new ActivityStore(database);
  app.post<{ Params: { activityId: string }; Body: unknown }>('/api/v1/admin/activities/:activityId/comic/exports/reader', async (request, reply) => {
    if (!checkAdmin(request, reply)) return;
    if (!Value.Check(ComicExportReaderRequestSchema, request.body)) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const body = request.body as { revisionId: string };
      const revision = comicStore.getComicRevision(request.params.activityId, body.revisionId);
      if (!revision) throw exportError('comic_revision_not_found', '指定的漫画版本不存在。', 404);
      const content = activityStore.getContentRevision(request.params.activityId, revision.document.contentRevisionId);
      if (!content) throw exportError('comic_source_missing', '漫画所绑定的剧情版本不存在。', 409);
      validateComicDocument(revision.document, content.document);
      const archive = buildComicOfflineReaderZip({ database, config, activityId: request.params.activityId, document: revision.document, revisionId: revision.id });
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="comic-reader-${revision.id}.zip"`);
      reply.header('content-length', String(archive.length));
      return reply.send(archive);
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number; details?: string[] };
      return reply.code(value.statusCode ?? 400).send({ error: value.code ?? 'comic_export_failed', message: value.message, ...(value.details ? { details: value.details } : {}) });
    }
  });
}
