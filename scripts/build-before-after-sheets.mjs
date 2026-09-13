#!/usr/bin/env node
/*
 * 计划 §13 第 4 条：把「代表页面同条件前后对照图」合成到一张图上，便于评审。
 *
 * 输入是两次采集的输出目录（tests/capture 采集脚本产出）：
 *   <dir>/before-<page>-<viewport>.png 与 <dir>/after-<page>-<viewport>.png
 * 输出每页每视口一张左右并排对照图，页眉标注各自的实际像素尺寸。
 *
 * 用法：
 *   node scripts/build-before-after-sheets.mjs --before <dir> --after <dir> --out <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PAGE_LABELS = {
  dashboard: '首页工作台',
  characters: '角色库',
  'activity-editor': '活动编辑（工作台）',
  'model-config': '模型配置',
};
const VIEWPORT_LABELS = { desktop: '桌面 1440×900', mobile: '手机 390×844' };

/* 整页很高的页面（如 160 多条模型配置）只截取顶部区域，否则对照图无法阅读。 */
const MAX_PANEL_HEIGHT = 2400;
const PANEL_WIDTH = { desktop: 1440, mobile: 430 };
const GAP = 24;
const HEADER_HEIGHT = 76;

function argOf(name) {
  const index = process.argv.indexOf('--' + name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const beforeDir = argOf('before');
const afterDir = argOf('after');
const outDir = argOf('out');
if (!beforeDir || !afterDir || !outDir) {
  throw new Error('用法：node scripts/build-before-after-sheets.mjs --before <dir> --after <dir> --out <dir>');
}
fs.mkdirSync(outDir, { recursive: true });

const escapeXml = (value) =>
  String(value).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]
  );

function headerSvg(width, title, subtitle, accent) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEADER_HEIGHT}">` +
    `<rect width="${width}" height="${HEADER_HEIGHT}" fill="${accent}"/>` +
    `<text x="20" y="34" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>` +
    `<text x="20" y="60" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="16" fill="#ffffffcc">${escapeXml(subtitle)}</text>` +
    `</svg>`;
  return Buffer.from(svg);
}

async function panel(file, width) {
  const meta = await sharp(file).metadata();
  const fullWidth = meta.width ?? 0;
  const fullHeight = meta.height ?? 0;
  const cropHeight = Math.min(fullHeight, MAX_PANEL_HEIGHT);
  const resized = await sharp(file)
    .extract({ left: 0, top: 0, width: fullWidth, height: cropHeight })
    .resize({ width, kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const scaled = await sharp(resized).metadata();
  return {
    buffer: resized,
    width: scaled.width ?? width,
    height: scaled.height ?? 0,
    fullWidth,
    fullHeight,
    truncated: cropHeight < fullHeight,
  };
}

const report = [];

for (const page of Object.keys(PAGE_LABELS)) {
  for (const viewport of Object.keys(VIEWPORT_LABELS)) {
    const beforeFile = path.join(beforeDir, `before-${page}-${viewport}.png`);
    const afterFile = path.join(afterDir, `after-${page}-${viewport}.png`);
    if (!fs.existsSync(beforeFile) || !fs.existsSync(afterFile)) continue;

    const width = PANEL_WIDTH[viewport];
    const left = await panel(beforeFile, width);
    const right = await panel(afterFile, width);
    const bodyHeight = Math.max(left.height, right.height);
    const canvasWidth = width * 2 + GAP;
    const canvasHeight = HEADER_HEIGHT + bodyHeight;

    /* 视口宽 390 却渲染得更宽，说明旧版存在页面级横向滚动；这里客观标注出来。 */
    const overflowNote = (data) =>
      viewport === 'mobile' && data.fullWidth > 390 ? `· 横向溢出 ${data.fullWidth - 390}px` : '';

    const subtitle = (data, side) =>
      `${data.fullWidth}×${data.fullHeight}` +
      (data.truncated ? `（仅显示顶部 ${MAX_PANEL_HEIGHT}px）` : '') +
      overflowNote(data) +
      (side === 'after' && data.fullWidth <= 390 && viewport === 'mobile' ? '· 无横向溢出' : '');

    const output = path.join(outDir, `compare-${page}-${viewport}.png`);
    await sharp({
      create: { width: canvasWidth, height: canvasHeight, channels: 4, background: '#ffffff' },
    })
      .composite([
        { input: headerSvg(width, '改造前', subtitle(left, 'before'), '#6b7280'), left: 0, top: 0 },
        { input: headerSvg(width, '改造后', subtitle(right, 'after'), '#b84420'), left: width + GAP, top: 0 },
        { input: left.buffer, left: 0, top: HEADER_HEIGHT },
        { input: right.buffer, left: width + GAP, top: HEADER_HEIGHT },
      ])
      .png()
      .toFile(output);

    report.push({
      label: `${PAGE_LABELS[page]} / ${VIEWPORT_LABELS[viewport]}`,
      before: `${left.fullWidth}x${left.fullHeight}`,
      after: `${right.fullWidth}x${right.fullHeight}`,
      output,
    });
  }
}

for (const row of report) {
  console.log(`${row.label}  前 ${row.before}  后 ${row.after}  -> ${path.basename(row.output)}`);
}
console.log(`共 ${report.length} 张对照图，输出目录：${outDir}`);

