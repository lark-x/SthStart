import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * SthStart UI token 守门（sthstart-ui-system §1）。
 *
 * 业务层（外框、工作台、业务模块、页面入口、设置）不应直接写原生色板、hex、过小字号、
 * 超过 600 的字重、任意像素值或用字符代替图标。存量按文件、按类别记在 baseline.json：
 * 数量只能减少，基线里没有的新文件必须为 0。读不了的文件单独报错，不按 0 处计。
 */

export const SCAN_ROOTS = ['app/shell', 'app/workspaces', 'app/features', 'app/apps', 'app/settings'];
export const BASELINE_PATH = 'scripts/ui/baseline.json';

const COLORS = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white';
const UTILITIES = 'bg|text|border(?:-[trblxyse])?|ring|ring-offset|from|to|via|fill|stroke|outline|shadow|divide|decoration|caret|accent|placeholder';
const SPACING = [
  'm[trblxyse]?', 'p[trblxyse]?', 'gap(?:-[xy])?', 'space-[xy]', 'inset(?:-[xy])?', 'top', 'right', 'bottom', 'left', 'start', 'end',
  'w', 'h', 'min-w', 'min-h', 'max-w', 'max-h', 'size', 'basis', 'translate-[xy]', 'scroll-m[trblxy]?', 'scroll-p[trblxy]?',
  'rounded(?:-(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?',
].join('|');

/** 每类规则：id、说明、正则（全局匹配）。正则只认 class 记号，前后不能紧贴字母数字或连字符。 */
export const RULES = [
  { id: 'palette', label: 'Tailwind 原生色板类', pattern: new RegExp(`(?<![\\w-])(?:${UTILITIES})-(?:${COLORS})(?:-\\d{2,3})?(?:\\/(?:\\d{1,3}|\\[[^\\]]+\\]))?(?![\\w-])`, 'g') },
  { id: 'hex', label: '6 位 hex 颜色', pattern: /#[0-9a-fA-F]{6}(?![0-9a-zA-Z])/g },
  { id: 'tinyText', label: '小于 12px 的字号', pattern: /(?<![\w-])text-\[(?:9|10|11)(?:\.\d+)?px\]/g },
  { id: 'heavyWeight', label: '超过 600 的字重', pattern: /(?<![\w-])font-(?:bold|extrabold|black)(?![\w-])/g },
  { id: 'arbitraryPx', label: '任意像素值', pattern: new RegExp(`(?<![\\w-])-?(?:${SPACING})-\\[-?\\d+(?:\\.\\d+)?px\\]`, 'g') },
  { id: 'glyphIcon', label: '字符图标或表情符号', pattern: /[✓✔✗✘○◯☐☑☒★☆]|(?![©®™])\p{Extended_Pictographic}/gu },
];

export const RULE_IDS = RULES.map(rule => rule.id);

const slash = value => value.split(path.sep).join('/');
const sourceFile = file => /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file) && !file.endsWith('.d.ts');

/** 注释里经常引用被禁止的写法（如规则说明），按行跳过 `//`、`/*`、`*` 开头的注释行。 */
function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/** 扫描一段源码，返回各类别的数量与命中行。 */
export function scanSource(text) {
  const counts = Object.fromEntries(RULE_IDS.map(id => [id, 0]));
  const hits = Object.fromEntries(RULE_IDS.map(id => [id, []]));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        counts[rule.id] += 1;
        hits[rule.id].push({ line: index + 1, match: match[0] });
      }
    }
  });
  return { counts, hits };
}

function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesIn(file);
    return sourceFile(file) ? [file] : [];
  });
}

/** 扫描仓库。读不了的文件放进 unreadable，不计入 files。 */
export function scanRepository(root, { roots = SCAN_ROOTS, read = file => fs.readFileSync(file, 'utf8') } = {}) {
  const files = {};
  const unreadable = [];
  for (const scanRoot of roots) {
    for (const absolute of filesIn(path.join(root, scanRoot))) {
      const relative = slash(path.relative(root, absolute));
      let text;
      try {
        text = read(absolute);
      } catch (error) {
        unreadable.push({ file: relative, error: error.code ?? String(error.message ?? error) });
        continue;
      }
      files[relative] = scanSource(text);
    }
  }
  return { files, unreadable };
}

/** 只保留非零类别，基线更小、差异更容易审阅。 */
export function toBaseline(scan) {
  const counts = {};
  for (const file of Object.keys(scan.files).sort()) {
    const nonZero = Object.fromEntries(Object.entries(scan.files[file].counts).filter(([, count]) => count > 0));
    if (Object.keys(nonZero).length) counts[file] = nonZero;
  }
  return { version: 1, rules: RULE_IDS, counts };
}

/**
 * 与基线比较。increases：数量超过基线（基线没有的文件按 0 计）；decreases：低于基线，
 * 可用 --update 刷新；removed：基线里有、当前已不存在或已清零的文件。
 */
export function compare(baseline, scan) {
  const baseCounts = baseline?.counts ?? {};
  const increases = [];
  const decreases = [];
  for (const [file, result] of Object.entries(scan.files)) {
    for (const id of RULE_IDS) {
      const current = result.counts[id];
      const allowed = baseCounts[file]?.[id] ?? 0;
      if (current > allowed) increases.push({ file, rule: id, allowed, current, hits: result.hits[id], isNewFile: !(file in baseCounts) });
      else if (current < allowed) decreases.push({ file, rule: id, allowed, current });
    }
  }
  const unreadableFiles = new Set(scan.unreadable.map(item => item.file));
  const removed = [];
  for (const [file, counts] of Object.entries(baseCounts)) {
    if (file in scan.files || unreadableFiles.has(file)) continue;
    for (const [rule, allowed] of Object.entries(counts)) decreases.push({ file, rule, allowed, current: 0 });
    removed.push(file);
  }
  return { increases, decreases, removed };
}

export function totals(counts) {
  const sum = Object.fromEntries(RULE_IDS.map(id => [id, 0]));
  for (const fileCounts of Object.values(counts)) for (const [id, count] of Object.entries(fileCounts)) sum[id] = (sum[id] ?? 0) + count;
  return sum;
}

function formatTotals(sum) {
  return RULES.map(rule => `${rule.label} ${sum[rule.id] ?? 0}`).join('，');
}

function readBaseline(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeBaseline(file, baseline) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(baseline, null, 2) + '\n');
}

export function run(argv = process.argv.slice(2), { root = process.cwd(), log = console.log, error = console.error } = {}) {
  const rootIndex = argv.indexOf('--root');
  const projectRoot = rootIndex >= 0 ? path.resolve(argv[rootIndex + 1]) : root;
  const update = argv.includes('--update');
  const baselineFile = path.join(projectRoot, BASELINE_PATH);
  const scan = scanRepository(projectRoot);
  const baseline = readBaseline(baselineFile);
  const scannedCounts = toBaseline(scan).counts;

  log(`UI tokens: 扫描 ${Object.keys(scan.files).length} 个文件。当前合计：${formatTotals(totals(scannedCounts))}。`);

  if (scan.unreadable.length) {
    error(`无法读取 ${scan.unreadable.length} 个文件，不能按 0 处计，请修复权限后重跑：`);
    for (const item of scan.unreadable) error(`  ${item.file}（${item.error}）`);
    return 2;
  }

  if (!baseline) {
    if (!update) {
      error(`缺少基线 ${BASELINE_PATH}。首次建立请运行 npm run check:ui -- --update。`);
      return 1;
    }
    writeBaseline(baselineFile, toBaseline(scan));
    log(`已建立基线 ${BASELINE_PATH}。`);
    return 0;
  }

  const result = compare(baseline, scan);
  if (result.increases.length) {
    error(`有 ${result.increases.length} 处超过基线（只允许减少，新文件必须为 0）：`);
    const label = Object.fromEntries(RULES.map(rule => [rule.id, rule.label]));
    for (const item of result.increases) {
      error(`  ${item.file} · ${label[item.rule]}：基线 ${item.allowed}，当前 ${item.current}${item.isNewFile ? '（新文件）' : ''}`);
      for (const hit of item.hits) error(`    ${item.file}:${hit.line}  ${hit.match}`);
    }
    if (update) error('存在超出基线的项，拒绝更新基线。请先改用语义 token 或共享原语。');
    return 1;
  }

  if (update) {
    if (!result.decreases.length) {
      log('没有低于基线的项，基线保持不变。');
      return 0;
    }
    writeBaseline(baselineFile, toBaseline(scan));
    log(`已按 ${result.decreases.length} 处下降刷新基线。基线合计：${formatTotals(totals(baseline.counts))} → ${formatTotals(totals(scannedCounts))}。`);
    return 0;
  }

  if (result.decreases.length) {
    log(`有 ${result.decreases.length} 处低于基线，可运行 npm run check:ui -- --update 收紧基线。`);
  }
  log('UI tokens: 通过。');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
