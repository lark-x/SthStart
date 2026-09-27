import type { ComicDocument } from '@sthstart/contracts';
import { compileComicReadingSteps, getComicFrameState, getComicReadingHoldMs, panelLayoutForPage, renderComicPage } from '@sthstart/activity-playback';

interface OfflineComicPayload { document: ComicDocument; imagePaths: Record<string, string> }
const host = document.getElementById('comic-reader');
const canvas = document.getElementById('comic-canvas') as HTMLCanvasElement | null;
const focusCanvas = document.getElementById('comic-focus-canvas') as HTMLCanvasElement | null;
const transcript = document.getElementById('comic-transcript');
const status = document.getElementById('comic-status');
const pageTitle = document.getElementById('comic-page-title');
const payloadNode = document.getElementById('comic-data');
const payload = payloadNode?.textContent ? JSON.parse(payloadNode.textContent) as OfflineComicPayload : null;
if (!host || !canvas || !status || !pageTitle || !payload) throw new Error('漫画离线包缺少阅读数据或画布。');
const comicData = payload as OfflineComicPayload;

const context = canvas.getContext('2d');
if (!context) throw new Error('浏览器无法创建漫画画布。');
const steps = compileComicReadingSteps(comicData.document);
const imageCache = new Map<string, HTMLImageElement | null>();
let currentStepIndex = -1;
let effectProgress = 1;
let resourceNotice: string | null = '正在加载漫画资源…';
let playing = false;
let animationFrame: number | null = null;
let holdTimer: number | null = null;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const buttons = {
  previous: document.getElementById('comic-previous'),
  next: document.getElementById('comic-next'),
  play: document.getElementById('comic-play'),
};
if (!(buttons.previous instanceof HTMLButtonElement) || !(buttons.next instanceof HTMLButtonElement) || !(buttons.play instanceof HTMLButtonElement)) {
  throw new Error('漫画离线包缺少阅读控制按钮。');
}
const statusElement = status as HTMLElement;
const pageTitleElement = pageTitle as HTMLElement;
const previousButton = buttons.previous as HTMLButtonElement;
const nextButton = buttons.next as HTMLButtonElement;
const playButton = buttons.play as HTMLButtonElement;

function activePage() {
  const step = steps[currentStepIndex];
  return comicData.document.pages.find((page) => page.id === step?.pageId) ?? comicData.document.pages[0] ?? null;
}

function draw() {
  const page = activePage();
  if (!page) { statusElement.textContent = '漫画尚无页面。'; return; }
  pageTitleElement.textContent = `${page.title} · 第 ${comicData.document.pages.findIndex((item) => item.id === page.id) + 1}/${comicData.document.pages.length} 页`;
  renderComicPage(context!, comicData.document, page,
    getComicFrameState(comicData.document, currentStepIndex, effectProgress, reducedMotion),
    { getImage: (artifactId) => {
      const image = imageCache.get(artifactId);
      return image?.complete && image.naturalWidth > 0 ? image : null;
    } });
  const frame = getComicFrameState(comicData.document, currentStepIndex, effectProgress, reducedMotion);
  const activePanel = comicData.document.panels.find((panel) => panel.id === frame.activePanelId);
  const rect = frame.activePanelId ? panelLayoutForPage(page.template, page.panelIds).find((item) => item.panelId === frame.activePanelId)?.rect : null;
  if (focusCanvas && rect) {
    focusCanvas.width = rect.width;
    focusCanvas.height = rect.height;
    focusCanvas.getContext('2d')?.drawImage(canvas!, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    focusCanvas.hidden = false;
  } else if (focusCanvas) focusCanvas.hidden = true;
  if (transcript) {
    transcript.replaceChildren();
    if (activePanel) {
      for (const bubble of activePanel.bubbles.filter((item) => frame.visibleBubbleIds.includes(item.id))) {
        const paragraph = document.createElement('p');
        paragraph.textContent = bubble.text;
        transcript.appendChild(paragraph);
      }
    }
    if (!transcript.childElementCount) transcript.textContent = currentStepIndex < 0 ? '点击“下一步”开始阅读。' : '当前画格还没有显示台词。';
  }
  statusElement.textContent = currentStepIndex < 0 && resourceNotice
    ? resourceNotice
    : `${Math.max(0, currentStepIndex + 1)} / ${steps.length} 阅读步骤${reducedMotion ? ' · 减少动态效果' : ''}`;
  previousButton.disabled = currentStepIndex < 0;
  nextButton.disabled = !steps.length;
  playButton.disabled = !steps.length;
  playButton.textContent = playing ? '暂停' : currentStepIndex >= steps.length - 1 ? '重新播放' : '自动播放';
}

function stepDuration(index: number) {
  const step = steps[index];
  if (!step || step.kind === 'bubble') return step ? 120 : 0;
  const panel = comicData.document.panels.find((item) => item.id === step.panelId);
  if (!panel) return 220;
  return Math.max(220, panel.presentation.camera === 'none' ? 0 : 600,
    panel.presentation.impact === 'shake' ? 180 : panel.presentation.impact === 'flash' ? 80 : 0);
}

function animate(reset = false) {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  if (reset) effectProgress = 0;
  if (currentStepIndex < 0 || reducedMotion) { effectProgress = 1; draw(); scheduleAutoStep(); return; }
  if (document.hidden || effectProgress >= 1) { draw(); scheduleAutoStep(); return; }
  let start: number | null = null;
  const duration = stepDuration(currentStepIndex);
  const tick = (time: number) => {
    start ??= time - effectProgress * duration;
    effectProgress = Math.min(1, (time - start) / duration);
    draw();
    if (effectProgress < 1) animationFrame = requestAnimationFrame(tick);
    else { animationFrame = null; scheduleAutoStep(); }
  };
  draw();
  animationFrame = requestAnimationFrame(tick);
}

function nextStep() {
  if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
  if (currentStepIndex < 0) { currentStepIndex = 0; animate(true); return; }
  if (effectProgress < 1 && !reducedMotion) {
    effectProgress = 1;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    draw();
    scheduleAutoStep();
    return;
  }
  if (currentStepIndex < steps.length - 1) { currentStepIndex++; animate(true); }
  else { playing = false; currentStepIndex = -1; effectProgress = 1; draw(); }
}

function previousPanel() {
  if (holdTimer !== null) clearTimeout(holdTimer);
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  holdTimer = null;
  animationFrame = null;
  const activePanelId = steps[currentStepIndex]?.panelId;
  if (!activePanelId) { currentStepIndex = -1; effectProgress = 1; draw(); return; }
  const panelStart = steps.findIndex((step) => step.kind === 'panel' && step.panelId === activePanelId);
  const previousStart = steps.slice(0, panelStart).map((step, index) => step.kind === 'panel' ? index : -1).filter((index) => index >= 0).at(-1);
  if (previousStart === undefined) currentStepIndex = -1;
  else {
    const previousId = (steps[previousStart] as { panelId: string }).panelId;
    currentStepIndex = steps.map((step, index) => step.panelId === previousId ? index : -1).filter((index) => index >= 0).at(-1) ?? previousStart;
  }
  playing = false;
  effectProgress = 1;
  draw();
}

function scheduleAutoStep() {
  if (!playing || currentStepIndex < 0 || currentStepIndex >= steps.length || document.hidden) return;
  if (!reducedMotion && effectProgress < 1) return;
  if (holdTimer !== null) clearTimeout(holdTimer);
  const step = steps[currentStepIndex];
  const hold = getComicReadingHoldMs(comicData.document, step) ?? (step.kind === 'bubble' ? 120 : 0);
  holdTimer = window.setTimeout(nextStep, Math.max(hold, 0));
}

previousButton.addEventListener('click', previousPanel);
nextButton.addEventListener('click', nextStep);
playButton.addEventListener('click', () => {
  if (playing) {
    playing = false;
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    effectProgress = 1;
    draw();
    return;
  }
  if (currentStepIndex >= steps.length - 1) { currentStepIndex = -1; effectProgress = 1; }
  playing = true;
  draw();
  if (playing && currentStepIndex < 0) nextStep();
  else scheduleAutoStep();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    if (holdTimer !== null) clearTimeout(holdTimer);
    animationFrame = null; holdTimer = null;
  } else { animate(); scheduleAutoStep(); }
});
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => { reducedMotion = event.matches; animate(); });

const imageLoads = Object.entries(comicData.imagePaths).map(([artifactId, relativePath]) => new Promise<void>((resolve) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => { imageCache.set(artifactId, image); resolve(); };
  image.onerror = () => { imageCache.set(artifactId, null); resolve(); };
  image.src = relativePath;
}));
void Promise.all(imageLoads).then(async () => {
  await document.fonts.ready;
  const comicFont = await document.fonts.load('32px "Sthstart Comic Noto Sans SC"');
  const failed = [...imageCache.values()].filter((image) => image === null).length;
  if (failed) resourceNotice = `有 ${failed} 张画格图片无法读取。`;
  else if (!comicFont.length || !document.fonts.check('32px "Sthstart Comic Noto Sans SC"')) resourceNotice = '本地漫画字体无法读取，阅读排版可能不一致。';
  else resourceNotice = '就绪 · 点击“下一步”开始阅读。';
  draw();
});
