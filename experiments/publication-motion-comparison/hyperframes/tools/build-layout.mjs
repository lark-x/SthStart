// Deterministic text layout precompute for the Snow Echo HyperFrames composition.
//
// Why this exists: the caption card must sit in a fixed pixel band (top ~1470,
// min safe 80px sides, bottom 150) while each sentence is vertically centred.
// Measuring Chinese text in the browser is unreliable because the webfont loads
// asynchronously and the composition must be seek-safe, so wrapping and vertical
// metrics are computed once, font-accurately, and frozen into assets/layout.json.
//
// Usage:  node tools/build-layout.mjs
//
// Reads : assets/manifest.json, assets/NotoSansSC-VF.ttf
// Writes: layout.json   (project root, so the derived geometry is versioned
//         even though assets/ is gitignored)

import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

const require = createRequire(import.meta.url);
const fontkit = require('fontkit');

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const manifest = JSON.parse(await readFile(join(root, 'assets/manifest.json'), 'utf8'));
const font = fontkit.openSync(join(root, 'assets/NotoSansSC-VF.ttf'));

// ---------- canvas geometry (fixed 1080x1920 portrait) ----------
const CANVAS = {width: manifest.width, height: manifest.height};
const MARGIN = 80;                       // minimum safe side margin
const SAFE_BOTTOM = 150;
const FRAME_BAND = {left: 70, top: 300, width: 940, height: 1040};
const FRAME_BAND_MAX_H = 1100;           // portrait variants may grow downward
const FRAME_PAD = 14;                    // thin cream edge inset
const CARD = {top: 1470, width: 920, padX: 44, padY: 30};
const CAPTION_FONT = 50;                 // 48-52 per brief
const CAPTION_LH = 1.42;
const SPEAKER_FONT = 30;
const HEADLINE_FONT = 58;
const MASTHEAD_FONT = 24;
const HEADLINE_TOP = 206;
const HEADLINE_WIDTH = CANVAS.width - MARGIN * 2;

// ---------- font metrics ----------
const UPM = font.unitsPerEm;
const ascent = font.ascent / UPM;
const descent = font.descent / UPM;       // negative
const contentEm = ascent - descent;       // full ascender..descender box in em

function advanceEm(ch) {
  const glyph = font.glyphForCodePoint(ch.codePointAt(0));
  const w = glyph && Number.isFinite(glyph.advanceWidth) ? glyph.advanceWidth : UPM;
  return w / UPM;
}

function measureEm(text) {
  let w = 0;
  for (const ch of text) w += advanceEm(ch);
  return w;
}

// CJK line-break hygiene: never start a line with closing punctuation, never
// end a line with opening punctuation. Latin runs break on spaces.
const NO_LINE_START = new Set([...'，。、；：？！）］｝〕〉》」』】·…—～”’%,.;:?!)]}']);
const NO_LINE_END = new Set([...'（［｛〔〈《「『【“‘([{']);

function wrapToWidth(text, maxEm) {
  const chars = [...text];
  const lines = [];
  let cur = '';
  let curEm = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const chEm = advanceEm(ch);
    if (cur && curEm + chEm > maxEm) {
      const prev = cur[cur.length - 1];
      if (NO_LINE_START.has(ch) && cur.length > 1) {
        // pull the previous glyph down so the forbidden char is not line-initial
        lines.push(cur.slice(0, -1));
        cur = prev + ch;
        curEm = advanceEm(prev) + chEm;
      } else if (NO_LINE_END.has(prev) && cur.length > 1) {
        // opening bracket would end the line; carry it down too
        lines.push(cur.slice(0, -1));
        cur = prev + ch;
        curEm = advanceEm(prev) + chEm;
      } else {
        lines.push(cur);
        cur = ch;
        curEm = chEm;
      }
    } else {
      cur += ch;
      curEm += chEm;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ---------- caption card metrics ----------
// 16px of slack so a slightly-wider-than-measured browser render still fits.
const captionMaxEm = (CARD.width - CARD.padX * 2 - 16) / CAPTION_FONT;
const lineHeightPx = CAPTION_FONT * CAPTION_LH;
const lineBoxPx = Math.min(contentEm * CAPTION_FONT, lineHeightPx * 0.96);
const speakerLineBox = SPEAKER_FONT * 1.5;
const speakerGap = 20;

const slides = manifest.shots.map((shot, i) => {
  const key = 's' + (i + 1);
  const aspect = shot.imageWidth / shot.imageHeight;

  // Fit the artwork into the fixed frame band without distorting it. Landscape
  // art uses the band exactly and is cropped by the inner viewport (per brief);
  // portrait art grows the frame downward so faces are not cut.
  const bandAspect = FRAME_BAND.width / FRAME_BAND.height;
  let fw = FRAME_BAND.width;
  let fh = FRAME_BAND.height;
  if (aspect < bandAspect) {
    fh = FRAME_BAND.width / aspect;
    if (fh > FRAME_BAND_MAX_H) {
      fh = FRAME_BAND_MAX_H;
      fw = fh * aspect;
    }
  }
  fw = Math.round(fw * 100) / 100;
  fh = Math.round(fh * 100) / 100;
  const frame = {
    left: Math.round((CANVAS.width - fw) / 2 * 100) / 100,
    top: FRAME_BAND.top,
    width: fw,
    height: fh,
    viewportWidth: Math.round((fw - FRAME_PAD * 2) * 100) / 100,
    viewportHeight: Math.round((fh - FRAME_PAD * 2) * 100) / 100,
  };

  const captionLines = shot.captions.map((c) => wrapToWidth(c.text, captionMaxEm));

  const headlineLines = wrapToWidth(
    shot.headline,
    (HEADLINE_WIDTH - 16) / HEADLINE_FONT,
  );

  return {key, shot, frame, captionLines, headlineLines};
});

// One shared band so every sentence is centred in the same place regardless of
// how many lines it needs; the card is as tall as the worst case needs.
const captionBlockHeights = slides.map(({captionLines}) =>
  captionLines.map((lines) => (lines.length - 1) * lineHeightPx + lineBoxPx),
);
const maxBlock = Math.max(...captionBlockHeights.flat());
const captionBandTop = CARD.top + CARD.padY + speakerLineBox + speakerGap;
const cardHeight =
  CARD.padY * 2 + speakerLineBox + speakerGap + maxBlock;

const card = {
  left: Math.round((CANVAS.width - CARD.width) / 2 * 100) / 100,
  top: CARD.top,
  width: CARD.width,
  height: Math.round(cardHeight * 100) / 100,
  padX: CARD.padX,
  padY: CARD.padY,
  captionBandTop,
  maxBlock: Math.round(maxBlock * 100) / 100,
  lineHeight: lineHeightPx,
  lineBox: Math.round(lineBoxPx * 100) / 100,
  speakerLineBox,
  speakerGap,
  fontSize: CAPTION_FONT,
  speakerFontSize: SPEAKER_FONT,
  contentWidth: CARD.width - CARD.padX * 2,
};

const objects = {};
for (const {key, shot, frame, captionLines, headlineLines} of slides) {
  objects[key + '_frame'] = {
    kind: 'frame',
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
  };
  objects[key + '_hl'] = {
    kind: 'headline',
    top: HEADLINE_TOP,
    left: MARGIN,
    width: HEADLINE_WIDTH,
    fontSize: HEADLINE_FONT,
    lines: headlineLines,
  };
  captionLines.forEach((lines, ci) => {
    const block = (lines.length - 1) * lineHeightPx + lineBoxPx;
    objects[key + '_c' + (ci + 1)] = {
      kind: 'caption',
      top: Math.round((captionBandTop + (maxBlock - block) / 2) * 100) / 100,
      height: Math.round(block * 100) / 100,
      lines,
      lead: shot.captions[ci].startMs,
      end: shot.captions[ci].endMs,
    };
  });
  objects[key + '_ch'] = {kind: 'chapter', text: shot.chapter};
  objects[key + '_sp'] = {kind: 'speaker', text: shot.speaker};
}

const durationSec = manifest.durationMs / 1000;
const out = {
  generatedBy: 'tools/build-layout.mjs',
  source: 'assets/manifest.json',
  canvas: {...CANVAS, fps: manifest.fps, durationSec},
  font: {
    file: 'assets/NotoSansSC-VF.ttf',
    unitsPerEm: UPM,
    ascentPx: Math.round(ascent * CAPTION_FONT * 100) / 100,
    descentPx: Math.round(descent * CAPTION_FONT * 100) / 100,
  },
  geometry: {
    margin: MARGIN,
    safeBottom: SAFE_BOTTOM,
    frameBand: FRAME_BAND,
    framePad: FRAME_PAD,
    card,
    headlineTop: HEADLINE_TOP,
    mastheadFont: MASTHEAD_FONT,
  },
  objects,
  clips: slides.map(({key, shot, frame}) => ({
    key,
    start: shot.startMs / 1000,
    duration: shot.durationMs / 1000,
    end: shot.endMs / 1000,
    image: 'assets/' + shot.image,
    speaker: shot.speaker,
    accent: shot.accent,
    chapter: shot.chapter,
    headline: shot.headline,
    captions: shot.captions.map((c) => ({
      start: c.startMs / 1000,
      end: c.endMs / 1000,
      text: c.text,
    })),
    frame,
  })),
};

await writeFile(join(root, 'layout.json'), JSON.stringify(out, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      durationSec,
      card: {height: card.height, captionBandTop, maxBlock, lineBox: card.lineBox},
      frames: out.clips.map((c) => ({key: c.key, w: c.frame.width, h: c.frame.height, l: c.frame.left, t: c.frame.top})),
      captions: out.clips.map((c) => c.captions.map((x, i) => 'c' + (i + 1) + ':' + objects[c.key + '_c' + (i + 1)].lines.join(' / '))),
    },
    null,
    2,
  ),
);
