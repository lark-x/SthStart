import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkTarget } from './types.js';

export type CardKind = 'playable' | 'story' | 'npc';

export interface LocalCuratedCardCatalogEntry {
  name: string;
  workTarget: 'genshin' | 'starrail';
  workName: '原神' | '崩坏：星穹铁道';
  kind: CardKind;
  filePath: string;
}

export interface ParsedLocalPersonaCard {
  name: string;
  filePath: string;
  workTarget: 'genshin' | 'starrail';
  kind?: CardKind;
  summary: string;
  personaText: string;
  speechText: string;
  behaviorRules: string;
  dialogueExamples: string[];
}

const ARCHIVE_ROOT_CANDIDATES = [
  '.',
  '..',
  '../..',
];

interface IndexedCard {
  filePath: string;
  kind: CardKind;
}

const CARD_KIND_RANK: Record<CardKind, number> = {
  playable: 0,
  story: 1,
  npc: 2,
};

const dirCache = new Map<string, Map<string, IndexedCard[]>>();

function inferCardKind(fullPath: string): CardKind {
  if (/[\\/](?:自机角色|自机)[\\/]/.test(fullPath)) return 'playable';
  if (/[\\/]NPC[\\/]/i.test(fullPath)) return 'npc';
  return 'story';
}

function indexMarkdownCards(dirName: string): Map<string, IndexedCard[]> {
  const cached = dirCache.get(dirName);
  if (cached) return cached;

  const index = new Map<string, IndexedCard[]>();
  for (const relBase of ARCHIVE_ROOT_CANDIDATES) {
    const root = resolve(process.cwd(), relBase, dirName);
    if (!existsSync(root)) continue;
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        if (entry.name.startsWith('_') || entry.name.toLowerCase() === 'readme.md') continue;
        const base = entry.name.replace(/\.md$/i, '').trim();
        const existing = index.get(base) || [];
        existing.push({ filePath: full, kind: inferCardKind(full) });
        index.set(base, existing);
      }
    };
    walk(root);
    if (index.size > 0) break;
  }

  for (const list of index.values()) {
    list.sort((a, b) => CARD_KIND_RANK[a.kind] - CARD_KIND_RANK[b.kind]);
  }

  dirCache.set(dirName, index);
  return index;
}

function balancePair(text: string, open: string, close: string): string {
  const stack: number[] = [];
  let out = '';
  for (const ch of text) {
    if (ch === open) {
      stack.push(out.length);
      out += ch;
    } else if (ch === close) {
      if (stack.length > 0) {
        stack.pop();
        out += ch;
      }
    } else {
      out += ch;
    }
  }
  for (const idx of stack.reverse()) {
    out = out.slice(0, idx) + out.slice(idx + 1);
  }
  return out;
}

function firstSentence(text: string): string {
  let paren = 0;
  let quote = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '（' || ch === '(') paren += 1;
    else if (ch === '）' || ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '「' || ch === '『' || ch === '“') quote += 1;
    else if (ch === '」' || ch === '』' || ch === '”') quote = Math.max(0, quote - 1);
    if (ch === '。' && paren === 0 && quote === 0) return text.slice(0, i);
  }
  return text;
}

/** 清理卡片中的 MCP 原始索引编号、Schema 字段标注与检索调试注释，保留可读人设与原声引号内容 */
export function cleanPersonaProse(raw: string, charName?: string): string {
  let out = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    // 1) 引用外壳与模板占位符
    .replace(/【\s*(?:doc|[A-C]|·)[·\s]*[^】]{0,20}】/gi, '')
    .replace(/【[·•\s]*】/g, '')
    .replace(/\s*[（(]\s*\{\{(?:user|char)\}\}\s*[)）]/gi, '')
    .replace(/\s*[（(]\s*\{NICKNAME\}\s*[)）]/gi, '')
    .replace(/\{\{\s*user\s*\}\}/gi, '用户')
    .replace(/\{\{\s*char\s*\}\}/gi, charName || '角色')
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, speaker: string) => speaker.trim())
    .replace(/\{NICKNAME\}/gi, '开拓者')
    .replace(/\{(?:F|M)#([^}]+)\}\{(?:F|M)#([^}]+)\}/g, '$1/$2')
    .replace(/\{(?:F|M)#([^}]+)\}/g, '$1')
    // 2) 命名空间 / 冒号 / 路径 / 哈希 / UUID / 对话与节点编号
    .replace(/`?(?:documentId|doc_id)\s*[:：=]?\s*`?[0-9a-f]{6,}(?:-[0-9a-f]{4})*(?:-?[0-9a-f]*|…?)\s*`?/gi, '')
    .replace(/`?\bdocument\s*(?:「[^」]+」|`?[0-9a-f]{6,}(?:-[0-9a-f-]+)?…?`?)/gi, '')
    .replace(/`?\b[0-9a-f]{8}-(?:[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|…)\b`?/gi, '')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/gi, '')
    .replace(/`?(?:genshin|starrail):[a-z_]+:[\w/.-]+`?/gi, '')
    .replace(/`?\b(?:achievement|quest|mission|story_quest|character|material|voice|entity_id|doc_id|documentId)\s*[:：]\s*[A-Za-z0-9_.\/-]+`?/gi, '')
    .replace(/`?\b(?:npc|character|material|achievement|item|book|relic|lightcone)\/[A-Za-z0-9_.\/-]+`?/gi, '')
    .replace(/`?\b(?:subquest|quest|mission|node|dialog|dialogue|talk)\s*[\/：:]?\s*\d+(?:\s*[~–—/-]\s*(?:subquest\/|quest\/|mission\/|dialog\/|dialogue\/|node\/|talk\/)?\d+)*`?/gi, '')
    .replace(/\((?:\d+\s*[;；、,，\s]*){1,4}\)/g, '')
    .replace(/（(?:\d+\s*[;；、,，\s]*){1,4}）/g, '')
    .replace(/`?\b(?:sr_char_\d+|sr_ach_\d+|material_\d+|dialogueNodeKey|speakerKey|sourceKey|entity_id|stableId)\b`?(?:\s*[:：=]?\s*[\w/.-]*)?/gi, '')
    .replace(/`?\b_?roster_[\w一-龥.-]+(?:\.md)?(?:\s*终版)?`?/gi, '')
    .replace(/`?\b100\d{5}\/\d+\b`?/g, '')
    .replace(/\bspeaker(?:Key)?\s*[:=]\s*[^\s，；。)）]+/gi, '')
    .replace(/\bspeaker\b(?=\s*(?:节点|[:=]|[,;，；。)）]|$))/gi, '')
    .replace(/\b(?:talk|dialog|dialogue|node|quest|subquest|mission|sub)\b(?=\s*(?:[\/：:\d,;，；。)）]|$))/gi, '')
    .replace(/\b\d{5,9}\b(?:\s*[、/,，~–-]\s*\b\d{5,9}\b)*/g, '')
    .replace(/[（(]\s*\d{1,5}(?:\s*[、,，]\s*\d{1,5})*\s*[)）]/g, '')
    .replace(/\bsp@\S*/gi, '')
    // 3) MCP 检索工具、Schema 字段、调试句式清理
    .replace(/`?(?:get_character|search|get_entity_texts|get_relationships|resolve_entity)(?:\([^)]*\))?`?\s*(?:→\s*`?\w+`?)?\s*(?:核验)?/gi, '')
    .replace(/(?:——|--|—)\s*核验/g, '')
    .replace(/(?<=[（(\s，、；;]|^)核验(?=[，；、\s)）]|$)/g, '')
    .replace(/\*\*注意\*\*：[^。\n]*(?:character_not_found|entity_not_found)[^。\n]*[。；]?/gi, '')
    .replace(/⚠\s*形态说明[^。\n]*[。\n]?/gi, '')
    .replace(/通识推断(?:标注)?[：:为]*/gi, '')
    .replace(/(?:^|[。；])\s*[^。\n；！]*?(?:库内|名册(?:终版|增补|另记|标注|实证|记|未列|sp))[^。\n；]*?(?:(?:为\s*null|为空|=空|未收录|character_not_found|entity_not_found|未检索到|未命中|不另立卡|严格对应|独立(?:记录|建档))[^。\n；]*)[。；]?/gi, (m) => (m.trimStart().startsWith('。') ? '。' : ''))
    .replace(/(?:^|[。；])\s*(?:名册(?:终版|增补|另记|标注|实证|记|未列|经典)[^。\n；]*|本卡[^。\n；]*(?:严格对应|不另立卡|分立建档|仅收|仅对应|单形态|合一|为准|侧写卡)[^。\n；]*|返回[、，\s=]*空[^。\n；]*)[。；]?/gi, (m) => (m.trimStart().startsWith('。') ? '。' : ''))
    .replace(/[（(][^）)\n]*(?:名册|本卡|证据键|sp@|仅对应\s*\d+|仅收\s*\d+|1501|1306|1006|1506)[^）)\n]*[)）]/gi, '')
    .replace(/\s*[—–-]+\s*(?=（|[)）]|$)/g, '')
    .replace(/(?:^|[。；])\s*的\s+`?\b(?:title|name|affiliation|element|region|weaponType|rarity|npc|character|dialogue|structured)\b`?\s*[。；]?/gi, (m) => (m.trimStart().startsWith('。') ? '。' : ''))
    .replace(/\b(?:weaponType|rarity|entity_not_found|character_not_found)\b(?:\s*(?:[:=]\s*)?[^\s，；。)）]*)?/gi, '')
    .replace(/\bprofile[.\s]*path\b\s*(?:[:=]\s*)?[^\s，；。)）]+/gi, '')
    .replace(/\btitle\/(?:affiliation|element\/region)\b(?:\s*(?:结构化)?字段[^，；。)）]*)?/gi, '')
    .replace(/(?:命途|title|affiliation|结构化)?字段[^）)\n；。]*(?:为空|null|未收录|不一致|实证为准|定位为准|先例|据实(?:并列)?记录)[^）)\n；。]*[；;。]?/gi, '')
    .replace(/存疑标注|错标先例/gi, '')
    .replace(/字段[：:][^）)\n；。]*(?:[；;]|(?=[）)]))/gi, '')
    .replace(/`?\btype\s*=\s*"?structured"?`?/gi, '')
    .replace(/[（(][^）)\n]*(?:库内|structured|character_not_found|speaker|按对?[^）)]*推断|推定|非实证|非原句|非直接引证|名册实证|写卡|补录|QA|title\/affiliation|weaponType|rarity|profile[.\s]*path|仅命中|未检索到|未命中)[^）)\n]*[)）]/gi, '')
    .replace(/[^（(。\n；！]*?(?:字段库内为空|character_not_found|structuredKind|库内另有同名|structured\s*(?:库内)?(?:无|未|仅?命中|检索|同名检索)|未随该命中返回|注：任务预判|在本次取证中未命中|本次取证未命中|本轮未单?检索到|称号未收录|库内的\s*(?:title|name|affiliation|npc|character|dialogue)|库内\s*dialogue[^。\n；]*?字段|本卡以[^。\n；]*为准|本卡合一[、，]?不另立卡)[^。\n；)]*(?:[。；]|(?=[)）]))?/gi, '')
    .replace(/(?:^|[；。])\s*[^。\n；！]*?(?:库内(?:无|暂无|未检索到|未命中|未收录|均无|均未)[^。\n；]*|structured[^。\n；]*(?:无|未|仅?命中)[^。\n；]*)[。；]?/gi, (m) => (m.trimStart().startsWith('。') ? '。' : ''))
    .replace(/(?:title\/)?\b(?:title|affiliation)\b\s*(?:结构化)?(?:字段)?/gi, '')
    .replace(/库内\s*(?:character\s*记录(?:\s*[（(][^）)]*[）)])?\s*)?(?:官方)?简介(?:原文)?/gi, '官方简介')
    .replace(/库内(?:仅|另)?/g, '')
    .replace(/\bdocument\s+/gi, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\*\*/g, '');

  // 4) 清理残留分隔符、嵌套空括号、连续标点及括号/引号配对平衡
  out = out.replace(/(?:^|[\s（(])\/+(?=[\s)），。；]|$)/g, ' ');
  for (let i = 0; i < 3; i += 1) {
    out = out
      .replace(/([（(])\s+/g, '$1')
      .replace(/\s+([)）])/g, '$1')
      .replace(/[（(][；;、,，：:\s—–\/-]*[)）]/g, '')
      .replace(/[（(]\s*[；;、,，：:—–\/-]+\s*/g, (m) => m[0])
      .replace(/\s*[；;、,，：:—–\/-]+\s*[)）]/g, (m) => m[m.length - 1])
      .replace(/（(「[^」]+」)）/g, '$1');
  }

  for (const [open, close] of [
    ['（', '）'],
    ['(', ')'],
    ['「', '」'],
    ['『', '』'],
    ['“', '”'],
  ] as const) {
    out = balancePair(out, open, close);
  }

  return out
    .replace(/【[·•\s、，,;；:：]*】/g, '')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/「\s*」/g, '')
    .replace(/\s+([，。；：、])/g, '$1')
    .replace(/：\s*。/g, '。')
    .replace(/：\s*；/g, '：')
    .replace(/；\s*，/g, '；')
    .replace(/，\s*、/g, '，')
    .replace(/：{2,}/g, '：')
    .replace(/：\s*([)）])/g, '$1')
    .replace(/[（(]\s*[，、；：。;,:]+\s*/g, (m) => m[0])
    .replace(/[，、；：。;,]\s*[，、；：。;,]+/g, (m) =>
      m.includes('。') ? '。' : (m.includes('；') || m.includes(';')) ? '；' : (m.includes('：') || m.includes(':')) ? '：' : '，',
    )
    .replace(/([，、；])\s*\1+/g, '$1')
    .replace(/^[；;、,，：:\s]+/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTopSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = markdown.split(/\r?\n/);
  let currentKey = '';
  let buffer: string[] = [];

  for (const line of lines) {
    const match = /^##\s+\d+[.、]\s*([^\n]+)$/.exec(line.trim());
    if (match) {
      if (currentKey) sections[currentKey] = buffer.join('\n').trim();
      currentKey = match[1].trim();
      buffer = [];
    } else if (currentKey) {
      buffer.push(line);
    }
  }
  if (currentKey) sections[currentKey] = buffer.join('\n').trim();
  return sections;
}

function findSection(sections: Record<string, string>, pattern: RegExp): string {
  for (const [key, val] of Object.entries(sections)) {
    if (pattern.test(key)) return val;
  }
  return '';
}

function extractBullets(sectionBody: string, charName?: string): Array<{ label: string; value: string }> {
  const items: Array<{ label: string; value: string }> = [];
  const parseBullet = (line: string) => {
    const m = /^-\s*\*\*([^*]+)\*\*\s*(?:[：:。]+\s*)?(.*)$/.exec(line)
      || /^-\s*([^：:]{1,24})[：:]\s*(.*)$/.exec(line);
    if (m) {
      const label = cleanPersonaProse(m[1], charName).replace(/[：:。]+$/, '');
      if (/^(?:库内档案状态|structured\s*记录|通识推断标注|记录状态|卡池状态|注|备注)$/.test(label)) return;
      const value = cleanPersonaProse(m[2], charName).replace(/^[：:。；;、,，]+\s*/, '');
      if (value && !/^[。；;、,，：:\s-]+$/.test(value)) items.push({ label, value });
      return;
    }
    const plain = cleanPersonaProse(line.replace(/^-\s*/, ''), charName);
    if (plain && !/^[。；;、,，：:\s-]+$/.test(plain)) items.push({ label: '', value: plain });
  };

  let pending: string | null = null;
  const flush = () => {
    if (pending) parseBullet(pending);
    pending = null;
  };
  for (const rawLine of sectionBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^-\s+/.test(line)) {
      flush();
      pending = line;
      continue;
    }
    if (pending && !/^(?:<!--|<START>|#)/.test(line)) {
      pending += ` ${line}`;
    }
  }
  flush();
  return items;
}

function formatDialogueExamples(sectionBody: string, charName: string): string[] {
  const cleaned = sectionBody.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!cleaned) return [];
  const blocks = cleaned.split(/<START>/i).map((b) => b.trim()).filter(Boolean);
  const out: string[] = [];
  for (const block of blocks) {
    const preNormalized = block
      .replace(/\{\{\s*user\s*\}\}\s*[：:]?\s*/gi, '用户：')
      .replace(/\{\{\s*char\s*\}\}\s*[：:]?\s*/gi, `${charName}：`)
      .replace(/\{\{\s*([^{}]+?)\s*\}\}\s*[：:]?\s*/g, (_, speaker: string) => `${speaker.trim()}：`);
    const normalized = cleanPersonaProse(preNormalized, charName)
      .replace(/^[\s]*[A-Za-z0-9\u4e00-\u9fff]{1,12}：\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (normalized) out.push(normalized);
  }
  return out;
}

export function loadLocalCuratedPersonaCard(
  displayName: string,
  workTarget: WorkTarget,
): ParsedLocalPersonaCard | null {
  const name = displayName.trim();
  if (!name) return null;

  const tryTargets: Array<'genshin' | 'starrail'> =
    workTarget === 'genshin' ? ['genshin']
      : workTarget === 'starrail' ? ['starrail']
        : workTarget === 'general' ? ['genshin', 'starrail']
          : [];

  for (const target of tryTargets) {
    const dirName = target === 'genshin' ? '角色人设卡_skill' : '星铁人设卡_skill';
    const index = indexMarkdownCards(dirName);
    const normalizedNeedle = name.replace(/[·•\s]/g, '').toLowerCase();

    let candidates = index.get(name);
    if (!candidates || candidates.length === 0) {
      for (const [k, list] of index.entries()) {
        if (k.replace(/[·•\s]/g, '').toLowerCase() === normalizedNeedle) {
          candidates = list;
          break;
        }
      }
    }
    const matchedPath = candidates?.[0]?.filePath;
    if (!matchedPath) continue;

    let raw = '';
    try {
      raw = readFileSync(matchedPath, 'utf-8');
    } catch {
      continue;
    }

    const sections = splitTopSections(raw);
    const coreBullets = extractBullets(findSection(sections, /核心档案|Core Profile/i), name);
    const psychBullets = extractBullets(findSection(sections, /心理机制|Psychology/i), name);
    const boundaryBullets = extractBullets(findSection(sections, /认知边界|Cognitive Boundaries/i), name);
    const relationBullets = extractBullets(findSection(sections, /社交图谱|Relationship/i), name);
    const voiceBullets = extractBullets(findSection(sections, /语言语流|Voice/i), name);
    const examples = formatDialogueExamples(findSection(sections, /对话范例|Dialogue Examples/i), name);

    const officialTitle = coreBullets.find((b) => /全称|称号/.test(b.label))?.value || '';
    const motivation = coreBullets.find((b) => /核心动机/.test(b.label))?.value || '';
    const stance = coreBullets.find((b) => /世界观立场/.test(b.label))?.value || '';

    const summaryParts = [
      officialTitle ? firstSentence(officialTitle).trim().replace(/[；;，、]+$/, '') : '',
      motivation ? firstSentence(motivation).trim().replace(/[；;，、]+$/, '') : '',
    ].filter(Boolean);
    const joinedSummary = cleanPersonaProse(summaryParts.join('。'), name);
    const summary = joinedSummary
      ? (joinedSummary.endsWith('。') ? joinedSummary : `${joinedSummary}。`)
      : '';

    const personaBlocks: string[] = [];
    const coreLines = coreBullets
      .filter((b) => !/游戏世界|称呼约定/.test(b.label))
      .map((b) => (b.label ? `- ${b.label}：${b.value}` : `- ${b.value}`));
    if (coreLines.length) {
      personaBlocks.push(`### 身份与核心立场\n${coreLines.join('\n')}`);
    }
    if (psychBullets.length) {
      personaBlocks.push(
        `### 性格特征与心理机制\n${psychBullets.map((b) => (b.label ? `- ${b.label}：${b.value}` : `- ${b.value}`)).join('\n')}`,
      );
    }
    if (relationBullets.length) {
      personaBlocks.push(
        `### 主要人物关系与态度\n${relationBullets.map((b) => (b.label ? `- ${b.label}：${b.value}` : `- ${b.value}`)).join('\n')}`,
      );
    }

    const speechText = voiceBullets
      .map((b) => (b.label ? `【${b.label}】${b.value}` : b.value))
      .join('\n');

    const behaviorRules = [
      ...boundaryBullets.map((b) => (b.label ? `【${b.label}】${b.value}` : b.value)),
      ...(stance ? [`【立场原则】${stance}`] : []),
    ].join('\n');

    return {
      name,
      filePath: matchedPath,
      workTarget: target,
      kind: candidates?.[0]?.kind,
      summary,
      personaText: personaBlocks.join('\n\n'),
      speechText,
      behaviorRules,
      dialogueExamples: examples,
    };
  }

  return null;
}

/** 列出本地精选人设库中去重后的全部角色目录条目（自机 > 剧情 > NPC，共 853 位不重复角色）。 */
export function listAllLocalCuratedPersonaCards(): LocalCuratedCardCatalogEntry[] {
  const specs: Array<{ target: 'genshin' | 'starrail'; dirName: string; workName: '原神' | '崩坏：星穹铁道' }> = [
    { target: 'genshin', dirName: '角色人设卡_skill', workName: '原神' },
    { target: 'starrail', dirName: '星铁人设卡_skill', workName: '崩坏：星穹铁道' },
  ];

  const results: LocalCuratedCardCatalogEntry[] = [];
  for (const spec of specs) {
    const index = indexMarkdownCards(spec.dirName);
    const dedup = new Map<string, LocalCuratedCardCatalogEntry>();
    for (const [name, list] of index.entries()) {
      const top = list[0];
      if (!top) continue;
      const normKey = name.replace(/[·•\s]/g, '').toLowerCase();
      const prev = dedup.get(normKey);
      if (!prev || CARD_KIND_RANK[top.kind] < CARD_KIND_RANK[prev.kind]) {
        dedup.set(normKey, {
          name,
          workTarget: spec.target,
          workName: spec.workName,
          kind: top.kind,
          filePath: top.filePath,
        });
      }
    }
    results.push(...dedup.values());
  }

  return results.sort((a, b) => {
    const kindDiff = CARD_KIND_RANK[a.kind] - CARD_KIND_RANK[b.kind];
    if (kindDiff !== 0) return kindDiff;
    const workDiff = a.workTarget.localeCompare(b.workTarget);
    if (workDiff !== 0) return workDiff;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}
