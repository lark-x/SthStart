import { createHash } from 'node:crypto';
import type { SceneDiscovery, SceneEvidence, SceneSource, StorySceneDraft } from '@sthstart/contracts';
import type { AkashaDocument, AkashaSearchResult } from '../narrative-connectors.js';

type SceneWorld = 'gi' | 'hsr';
export interface SceneSourceReader {
  search(world: SceneWorld, keyword: string, maxResults: number): Promise<AkashaSearchResult[]>;
  read(world: SceneWorld, pathHash: string, offset: number, limit: number): Promise<AkashaDocument & { excerptLocator?: string }>;
  readRecord?(world: SceneWorld, pathHash: string): Promise<{ text: string; complete: boolean }>;
  close?(): Promise<void>;
}

const WORK_NAMES = { gi: '原神', hsr: '崩坏：星穹铁道', other: '其他作品', original: '原创' };
const SEARCH_LIMIT = 8;
const READ_LIMIT = 12;
const EXCERPT_LIMIT = 1_800;

export function sceneSourceId(...key: Array<string | number>): string {
  return `scene-src-${createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 32)}`;
}

/** The connector's default primary tier includes unknown categories. Require positive metadata here. */
export function sourceKind(tags: Record<string, string>, fileName = ''): SceneSource['kind'] {
  const metadata = `${fileName}\n${Object.values(tags).filter((value): value is string => typeof value === 'string').join('\n')}`;
  if (/百科学习笔记|二手|非官方|同人|考据|wiki|moegirl|miyoushe|米游社|萌娘百科|攻略|任务条件|解锁条件/i.test(metadata)) return 'secondary';
  if (/\[(?:角色故事\s*\/\s*Character Story|角色语音\s*\/\s*Voice[- ]?Over|Readable|Quest(?:\s+Dialogue)?|Dialog(?:ue)?|Subtitles?|Item|Codex|Geography|Achievement|Loading Tip)\]/i.test(metadata)
    || /ingame(?:_[a-z]+)?[\\/]|原作|官方(?:剧情|文本|漫画|资料|故事)|原文|\d{2}-任务|角色故事|角色资料|角色语音|阅读物|书籍|漫画|剧情文本|game[-_ ]?text|official/i.test(metadata)) return 'canon';
  return 'unknown';
}

function sourceRank(hit: AkashaSearchResult, hasCharacterMatch: boolean) {
  const tier = sourceKind(hit.tags, hit.fileName);
  if (tier === 'secondary') return 6;
  if (tier === 'unknown') return 5;
  const metadata = `${hit.fileName} ${Object.values(hit.tags).join(' ')}`;
  const narrative = /角色故事|阅读物|书籍|任务|漫画/.test(metadata);
  if (narrative && hasCharacterMatch) return 0;
  if (narrative && hit.totalLines >= 12) return 1;
  if (hasCharacterMatch) return 2;
  if (narrative) return 3;
  return 4;
}

export function sourceHasText(source: SceneSource) {
  const excerpt = source.excerpt.trim();
  if (!excerpt) return false;
  const lines = excerpt.split('\n').map((line) => line.trim()).filter(Boolean);
  const content = lines.filter((line) => !/^\[?(?:readable|item|codex)\]?$/i.test(line)
    && !/^#{1,6}\s|^(?:zh|jp|kr|en)\s*[:：]|(?:未找到可读取|没有找到可读取|原文未收录|暂无正文|不可读取)/i.test(line)
    && !/^\|(?:[-:|\s]+)\|?$/.test(line)
    && !/^\|/.test(line)
    && !/^\*{0,2}(?:描述|简介)\s*[:：]?\s*\*{0,2}/.test(line)
    && !/^(?:书名|类型|作者|基本信息|项目|章节)\s*[|:：]/.test(line));
  if (!content.length) return false;
  return content.some((line) => /[。！？!?，,；;“「]/.test(line));
}

function readRange(lineRange: string) {
  const range = /^\s*(\d+)(?:\s*[-–—]\s*(\d+))?(?:\s*\/.*)?\s*$/.exec(lineRange);
  if (!range) return null;
  const start = Number(range[1]);
  const end = Number(range[2] ?? range[1]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= start ? { start, end } : null;
}

function excerptWindow(content: string, start: number, end: number, anchor: number): { startLine: number; endLine: number; excerpt: string } | null {
  const lines = content.replace(/\r\n?/g, '\n').split('\n').slice(0, end - start + 1);
  if (!lines.some((line) => line.trim())) return null;
  // When a paragraph exceeds the excerpt cap, preserve a contiguous range around the match.
  const index = Math.min(Math.max(anchor - start, 0), lines.length - 1);
  let first = index;
  let last = index;
  let size = lines[index].length;
  while (first > 0 || last + 1 < lines.length) {
    const earlier = first > 0 && first >= 2 * index - last;
    const next = earlier || last + 1 >= lines.length ? first - 1 : last + 1;
    const nextSize = size + lines[next].length + 1;
    if (nextSize > EXCERPT_LIMIT) break;
    if (next < first) first = next;
    else last = next;
    size = nextSize;
  }
  const excerpt = lines.slice(first, last + 1).join('\n').slice(0, EXCERPT_LIMIT);
  return excerpt.trim() ? { startLine: start + first, endLine: start + last, excerpt } : null;
}

export function sceneAuthorSources(draft: StorySceneDraft): SceneSource[] {
  const work = draft.character.work?.trim() || WORK_NAMES[draft.character.origin];
  const sources = draft.authorSources.flatMap(({ title, locator, text }) => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const name = draft.character.name.trim();
    const match = lines.findIndex((line) => line.includes(name));
    const first = Math.max(0, match - 3);
    const excerpt = excerptWindow(lines.slice(first, first + READ_LIMIT).join('\n'), first + 1, Math.min(first + READ_LIMIT, lines.length), Math.max(match, 0) + 1);
    if (!excerpt) return [];
    return [{ id: sceneSourceId('author', work, title, locator ?? '', text), title, work, locator: locator ?? '', kind: 'author' as const, ...excerpt, fullText: text, fullTextComplete: true }];
  });
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

function retrievalError(error: unknown): 'timeout' | 'unavailable' {
  if (error instanceof Error && (error.name === 'TimeoutError' || /\b(?:timeout|timed out|ETIMEDOUT)\b/i.test(error.message))) return 'timeout';
  return 'unavailable';
}

export async function collectSceneSources(
  draft: StorySceneDraft, aliases: string[], reader: SceneSourceReader | null, hypothesis: boolean,
): Promise<{ sources: SceneSource[]; discovery: SceneDiscovery }> {
  const author = sceneAuthorSources(draft);
  const world = draft.character.origin;
  if (world === 'original' || world === 'other') {
    if (author.length) return { sources: author, discovery: { status: 'ready', message: '本次联想使用作者提供的材料。' } };
    return { sources: author, discovery: world === 'original' || hypothesis
      ? { status: 'ready', message: '本次联想基于人物设定，时地是待作者确认的创作假设。' }
      : { status: 'empty', message: '尚未贴入作品资料。可以添加原文、手动填写，或基于已有信息联想。' } };
  }
  if (hypothesis) return {
    sources: [...draft.sources.filter((source) => source.kind !== 'author').slice(-4), ...author],
    discovery: { status: 'ready', message: '本次基于已有材料进行创作联想，新增时地需要作者确认。' },
  };
  if (!reader) return { sources: author, discovery: {
    status: 'not-configured', message: '虚空终端 Story MCP 未配置。可以贴入资料、手动填写，或基于已有信息联想。',
  } };

  const name = draft.character.name.trim();
  const clue = [draft.start?.location, draft.start?.time, draft.start?.hook, draft.notes]
    .map((value) => value?.trim()).find((value) => value && value !== name);
  const second = aliases.find((alias) => alias !== name) ?? (clue ? `${name} ${clue.slice(0, 180)}` : undefined);
  const keywords = second ? [name, second] : [name];
  const found = new Map<string, AkashaSearchResult>();
  const failures = new Set<'timeout' | 'unavailable'>();
  for (const keyword of keywords) {
    try {
      for (const hit of (await reader.search(world, keyword, SEARCH_LIMIT)).slice(0, SEARCH_LIMIT)) {
        if (!hit.pathHash || hit.pathHash.length > 450) continue;
        const existing = found.get(hit.pathHash);
        if (!existing) found.set(hit.pathHash, hit);
        else found.set(hit.pathHash, { ...existing, tags: { ...hit.tags, ...existing.tags }, hits: [...existing.hits, ...hit.hits] });
      }
    } catch (error) { failures.add(retrievalError(error)); }
  }

  const names = [name, ...aliases];
  const ranked = [...found.values()].map((hit) => {
    const lines = hit.hits.filter(({ line }) => Number.isSafeInteger(line) && line >= 1);
    const characterMatch = lines.find(({ snippet }) => typeof snippet === 'string' && names.some((identity) => snippet.includes(identity)));
    const titleMatch = names.some((identity) => evidenceText(hit.fileName).includes(evidenceText(identity)));
    const semanticResult = lines.length === 0;
    const unquotedLine = lines.some(({ snippet }) => !snippet?.trim());
    const relevant = !!characterMatch || titleMatch || semanticResult || unquotedLine;
    const titleBonus = titleMatch && hit.totalLines >= READ_LIMIT && sourceKind(hit.tags, hit.fileName) === 'canon' ? 3 : Number(titleMatch);
    return { hit, anchor: characterMatch ?? lines[0], rank: sourceRank(hit, !!characterMatch) - titleBonus, relevant };
  }).filter(({ relevant }) => relevant).sort((a, b) => a.rank - b.rank);
  const passages: SceneSource[] = [];
  for (const { hit, anchor } of ranked) {
    if (passages.length >= 4) break;
    const line = anchor?.line ?? 1;
    const offset = Math.max(1, line - 5);
    try {
      const document = await reader.read(world, hit.pathHash, offset, READ_LIMIT);
      const range = readRange(document.lineRange);
      const chunkLocal = !!document.excerptLocator;
      if (!range || document.pathHash !== hit.pathHash || (!chunkLocal && range.start !== offset) || range.end >= range.start + READ_LIMIT) {
        failures.add('unavailable');
        continue;
      }
      const excerpt = excerptWindow(document.content, range.start, range.end, line);
      if (!excerpt) continue;
      const source = {
        id: sceneSourceId(world, document.excerptLocator ?? hit.pathHash, excerpt.startLine, excerpt.endLine, excerpt.excerpt),
        title: (document.fileName || hit.fileName || hit.pathHash).slice(0, 240), work: WORK_NAMES[world],
        locator: document.excerptLocator ?? `akasha:${world}:${hit.pathHash}`, kind: sourceKind({ ...hit.tags, ...document.tags }, `${hit.fileName}\n${document.fileName}`), ...excerpt,
      } satisfies SceneSource;
      let recorded: SceneSource = source;
      if (reader.readRecord) {
        try {
          const record = await reader.readRecord(world, hit.pathHash);
          if (record?.text.trim()) recorded = { ...source, fullText: record.text.slice(0, 60_000), fullTextComplete: record.complete && record.text.length <= 60_000 };
        } catch (error) { failures.add(retrievalError(error)); }
      }
      // Legacy books often start with a multilingual heading and metadata. Cite their
      // actual body using the original document's line numbers, even for title hits.
      if (!chunkLocal && recorded.fullText && (!anchor || !sourceHasText(recorded))) {
        const lines = recorded.fullText.replace(/\r\n?/g, '\n').split('\n');
        const heading = lines.findIndex((text) => /^#{1,6}\s+正文\s*$/.test(text.trim()));
        const match = heading >= 0 ? lines.findIndex((text, index) => index > heading && !!text.trim())
          : lines.findIndex((text) => names.some((identity) => text.includes(identity)) && sourceHasText({ ...source, excerpt: text }));
        if (match >= 0) {
          const first = Math.max(heading + 1, match - 3);
          const replacement = excerptWindow(lines.slice(first, first + READ_LIMIT).join('\n'), first + 1, Math.min(first + READ_LIMIT, lines.length), match + 1);
          if (replacement) recorded = { ...recorded, ...replacement, id: sceneSourceId(world, recorded.locator, replacement.startLine, replacement.endLine, replacement.excerpt) };
        }
      }
      if (!sourceHasText(recorded)) continue;
      if (!names.some((identity) => evidenceText(`${source.title}\n${recorded.excerpt}`).includes(evidenceText(identity)))) continue;
      passages.push(recorded);
    } catch (error) {
      failures.add(retrievalError(error));
    }
  }
  const retrieved = passages;
  const sources = [...retrieved, ...author];
  const recovery = '可以重试检索、贴入资料、手动填写，或基于已有信息联想。';
  if (retrieved.length) return { sources, discovery: { status: 'ready', message: failures.size
    ? '部分资料读取失败，本次仅使用已取得的原文片段。'
    : '参考资料已更新。出处卡可查看引用行段和已记录的原文。' } };
  if (failures.has('timeout')) return { sources, discovery: { status: 'timeout', message: `原文检索或读取超时。${recovery}` } };
  if (failures.size) return { sources, discovery: { status: 'unavailable', message: `暂时无法获取原文。${recovery}` } };
  return { sources, discovery: { status: 'empty', message: `未找到可供引用的相关原文片段。${recovery}` } };
}

export function evidenceText(value: string) {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

function regexEscape(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// This is a conservative lexical check of the quoted claim. Indirect references and
// antecedents left implicit by the prose stay accessible as inferences.
function directClaim(field: 'time' | 'location', value: string, quote: string, excerpt: string, characterName: string): boolean {
  const claim = evidenceText(value);
  if (!claim || /^(?:地点|时间)?(?:待定|未知|不详|待确认)$/.test(claim)) return false;
  const sentences = evidenceText(quote).split(/[。！？!?；;]/);
  const original = excerpt.normalize('NFKC').split(/[。！？!?；;\n]/).map(evidenceText);
  const indirect = /据说|传言|听说|传闻|相传|流言|如果|假若|并未|不曾|没有(?:去|到|来|在)|(?:想|打算|计划|准备)(?:要)?(?:去|到|前往)|(?:听闻|谈起|讲起|提及|提到|追述|回忆|回想|转述|讲述|述说|记得)|曾想|梦见|解锁条件|任务要求|需要完成|可能|或许/;
  const name = evidenceText(characterName);
  const subject = regexEscape(name);
  const qualifier = '(?:本人|此刻|当时|独自|仍|正|也|终于|曾|已经|就|是|被|随后|便|先|又|才|一度|依旧|还|最终|一路|一直|从此|一起|慢慢|悄然|默默|曾经|后来|最后|则|只|都)*';
  const motion = '身处|关在|困在|坐在|站在|住在|留在|抵达|到达|走进|走出|来到|进入|回到|返回|降临';
  const locativeAction = '与|同|和|相见|会面|相遇|见到|见过|看着|守候|醒来|睡|伏|躺|站|坐|跪|等|战|宣誓|道别|逗留|遇见|登上|飞向|离开|告别|仰望|升上|登临';
  const namedSubject = `(?:(?:${subject})[，,]?|[^，,:：]{1,20}(?:的|骑士|队长|船长|女士|先生)(?:${subject})[，,])`;
  const presentAt = (place: string, sentence: string) => {
    const presence = `(?:${motion})${place}(?:$|[，,：:]|(?:里|中|内|外|旁|下|边)?(?:${locativeAction}))|(?:在|于)${place}(?:(?:的[^，,：:]{1,16})?(?:里|中|内|外|旁|下|边)?(?:${locativeAction})|$)`;
    return !!subject && new RegExp(`(?:^|[，,：:「“])${namedSubject}${qualifier}(?:(?:在|于)[^，,:：]{1,40}(?:之刻|之际|之后|之前|时))?(?:${presence})`, 'u').test(sentence);
  };
  return sentences.some((sentence, index) => {
    if (!sentence || !name || !sentence.includes(name)) return false;
    if (!original.some((line) => line.includes(sentence) && !indirect.test(line))) return false;
    if (field === 'time') {
      const timeMarker = /之后|以后|之前|以前|之际|之刻|当时|当天|当晚|前后|当日|同年|年|月|日|黎明|清晨|黄昏|夜|午|傍晚|清早|时候|时期|期间|末期|尾声|晚年|最终|最后|尽头|时|前|后/;
      if (claim.length < 2 || !timeMarker.test(claim)) return false;
      const time = regexEscape(claim);
      const action = `(?:${motion}|(?:在|于)[^，,:：]{1,30}(?:${locativeAction})|${locativeAction})`;
      const scopedTime = `(?:^|[，,])(?:(?:在|于)?${time}[，,]${namedSubject}${qualifier}${action}|${namedSubject}${qualifier}(?:在|于)?${time}${qualifier}${action})`;
      return new RegExp(scopedTime, 'u').test(sentence);
    }
    if (presentAt(regexEscape(claim), sentence)) return true;
    const previous = sentences[index - 1];
    if (!previous || !new RegExp(`^${regexEscape(claim)}(?:的|是)`, 'u').test(previous)
      || /[与和及或、]/.test(previous.slice(claim.length).split(/[，,]/, 1)[0]) || indirect.test(previous)) return false;
    return presentAt('(?:此地|这里|此处)', sentence)
      && original.some((line, lineIndex) => line.includes(previous)
        && !indirect.test(line) && original.slice(lineIndex + 1).find(Boolean)?.includes(sentence));
  });
}

export function compactScenePassages(sources: SceneSource[], identities: string[]) {
  const names = identities.map(evidenceText).filter(Boolean);
  return sources.slice(0, 8).map((source, index) => {
    const lines = source.excerpt.split('\n');
    const anchor = lines.findIndex((line) => line.trim() && !line.startsWith('[') && names.some((name) => evidenceText(line).includes(name)));
    const start = Math.max(0, anchor - 2);
    const selected: Record<string, string> = {};
    let remaining = 480;
    for (let i = start; i < lines.length && remaining > 0; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.length > remaining && Object.keys(selected).length) break;
      selected[`${index + 1}.${source.startLine + i}`] = line.slice(0, remaining);
      remaining -= line.length;
    }
    return { source, lines: selected };
  });
}

export function resolveSceneEvidence(
  field: 'time' | 'location', value: string, refs: string[], passages: ReturnType<typeof compactScenePassages>, characterName: string, hypothesis: boolean,
): SceneEvidence {
  const valid = passages.flatMap(({ source, lines }) => Object.entries(lines).flatMap(([id, quote]) =>
    refs.includes(id) ? [{ source, quote, line: Number(id.split('.')[1]) }] : []));
  const sourceIds = [...new Set(valid.map(({ source }) => source.id))];
  const corroborates = (kind: SceneSource['kind']) => valid.some(({ source, quote, line }) => {
    if (source.kind !== kind) return false;
    const previous = valid.find((item) => item.source.id === source.id && item.line === line - 1);
    const original = source.excerpt.split('\n');
    const completeLine = original[line - source.startLine]?.trim() === quote;
    if (!completeLine) return false;
    return directClaim(field, value, quote, source.excerpt, characterName)
      || !!previous && original[previous.line - source.startLine]?.trim() === previous.quote
        && directClaim(field, value, `${previous.quote}\n${quote}`, source.excerpt, characterName);
  });
  const label = field === 'time' ? '时间' : '地点';
  if (corroborates('author')) return { status: 'author', sourceIds, note: '来自作者提供的文本。' };
  if (!hypothesis && corroborates('canon')) return { status: 'supported', sourceIds, note: '已读原文直接支持。' };
  if (!value.trim() || /^(?:地点|时间)?(?:待定|未知|不详|待确认)$/.test(evidenceText(value)) || (!hypothesis && !sourceIds.length)) {
    return { status: 'unconfirmed', sourceIds, note: `已读片段未能核实此${label}。` };
  }
  const note = valid.length ? `引文可供联想，尚不足以确认此${label}。` : '这是待作者确认的创作假设。';
  return { status: 'inferred', sourceIds, note };
}
