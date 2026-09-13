import type { CharacterBirthday, CharacterDraft, CharacterDraftV2 } from '@sthstart/contracts';
import type { ServiceDatabase } from '../database.js';
import { nowIso } from '../database.js';

type CharacterDraftAny = CharacterDraft | CharacterDraftV2;

/** 未填写且从未被用户确认过的生日。source 缺失表示“从未处理”，source=manual 表示用户明确清空。 */
export const EMPTY_BIRTHDAY: CharacterBirthday = { status: 'unset', calendar: 'unknown' };

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 2 月 29 日有效；2 月 30 日无效。 */
export function isValidMonthDay(month: number, day: number): boolean {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= MONTH_DAYS[month - 1];
}

/** 公历生日是否会在该年份出现：2 月 29 日只在闰年显示。 */
export function occursInYear(month: number, day: number, year: number): boolean {
  if (month !== 2 || day !== 29) return true;
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function halfWidth(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/[／－．：]/g, (char) => ({ '／': '/', '－': '-', '．': '.', '：': ':' })[char] || char);
}

function squeeze(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseMonthDay(raw: string, source: CharacterBirthday['source']): CharacterBirthday | null {
  const original = squeeze(raw);
  if (!original) return null;
  const text = halfWidth(original);
  const lunar = /(农历|阴历|農曆|農歷|旧历|lunar)/i.test(text);
  const found: Array<{ month: number; day: number; evidence: string }> = [];
  const push = (month: number, day: number, evidence: string) => {
    if (!isValidMonthDay(month, day)) return;
    if (found.some((item) => item.month === month && item.day === day)) return;
    found.push({ month, day, evidence });
  };

  // 先吃掉完整的年月日，避免其中的月日部分被后续模式重复匹配。
  let rest = text.replace(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/g, (match, _year, month, day) => {
    push(Number(month), Number(day), match);
    return ' ';
  });
  rest = rest.replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g, (match, month, day) => {
    push(Number(month), Number(day), match);
    return ' ';
  });
  // 数字顺序不确定的写法（如 08/08）不能猜月份在前还是日期在前。
  const ambiguous = [...rest.matchAll(/(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/g)].map((match) => match[0]);

  const base: CharacterBirthday = { status: 'unset', calendar: 'unknown', rawText: original, ...(source ? { source } : {}) };
  if (lunar) {
    return found.length === 1
      ? { ...base, status: 'needs_confirmation', calendar: 'lunar', month: found[0].month, day: found[0].day, evidence: found[0].evidence }
      : { ...base, status: 'needs_confirmation', calendar: 'lunar', evidence: original };
  }
  if (found.length === 1) {
    return { ...base, status: 'known', calendar: 'gregorian', month: found[0].month, day: found[0].day, evidence: found[0].evidence };
  }
  if (found.length > 1) {
    return { ...base, status: 'needs_confirmation', evidence: '包含多个日期：' + found.map((item) => item.evidence).join('、') };
  }
  if (ambiguous.length) {
    return { ...base, status: 'needs_confirmation', evidence: '日期书写顺序不明确：' + ambiguous.join('、') };
  }
  return { ...base, status: 'needs_confirmation', evidence: original };
}

/** 从明确标注了生日的文本中提取生日。只有带生日标签的内容才会被解析。 */
export function parseBirthdayText(raw: unknown, source: CharacterBirthday['source'] = 'card_text'): CharacterBirthday {
  const parsed = parseMonthDay(squeeze(raw, 400), source);
  return parsed ?? { ...EMPTY_BIRTHDAY };
}

const LABEL = /(生日|birthday|诞生日|诞辰)/i;

function labelValue(line: string): string {
  const match = line.match(LABEL);
  if (!match || match.index == null) return '';
  const after = line.slice(match.index + match[0].length).replace(/^[\s:：,，、=是为]+/, '').trim();
  return after || line.trim();
}

/** 在自由文本中查找明确标注了生日的条目（不处理未标注的日期）。 */
export function findLabeledBirthdayText(values: (string | string[] | undefined)[]): { raw: string; evidence: string } | null {
  for (const value of values) {
    const blocks = Array.isArray(value) ? value : [value];
    for (const block of blocks) {
      if (typeof block !== 'string' || !block) continue;
      for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !LABEL.test(line)) continue;
        return { raw: labelValue(line), evidence: line.slice(0, 200) };
      }
    }
  }
  return null;
}

export function normalizeBirthday(value: unknown): CharacterBirthday {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!data) return { ...EMPTY_BIRTHDAY };
  const status = data.status === 'known' || data.status === 'needs_confirmation' || data.status === 'unset' ? data.status : 'unset';
  const calendar = data.calendar === 'gregorian' || data.calendar === 'lunar' ? data.calendar : 'unknown';
  const source = data.source === 'manual' || data.source === 'card_field' || data.source === 'card_text' ? data.source : undefined;
  const month = Number(data.month);
  const day = Number(data.day);
  const hasDate = isValidMonthDay(month, day);
  // 只有“已知且公历”的生日可以携带可用于日历的月日。
  const usable = status === 'known' && calendar === 'gregorian' && hasDate;
  const rawText = squeeze(data.rawText, 200);
  const evidence = squeeze(data.evidence, 200);
  return {
    status: usable ? 'known' : status,
    calendar: usable ? 'gregorian' : calendar,
    ...(usable || (status === 'needs_confirmation' && hasDate) ? { month, day } : {}),
    ...(rawText ? { rawText } : {}),
    ...(source ? { source } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * 角色卡中可用于识别生日的自由文本字段。
 * V1 读取细分字段；V2 读取人设正文、说话方式、行为约束与示例。
 */
function birthdayTextValues(draft: CharacterDraftAny): (string | string[] | undefined)[] {
  if ('schemaVersion' in draft && draft.schemaVersion === 2) {
    return [draft.summary, draft.personaText, draft.speechText, draft.behaviorRules, draft.dialogueExamples];
  }
  const v1 = draft as CharacterDraft;
  return [
    v1.summary,
    v1.identity,
    v1.background,
    v1.currentSituation,
    v1.world,
    v1.extraRules,
    v1.personality,
    v1.likes,
    v1.speech?.examples,
  ];
}

/**
 * 角色生日最终取值：
 * 1. 用户明确清空（source=manual）→ 保持未填写，不再从文本自动补回。
 * 2. 已有结构化生日 → 直接使用。
 * 3. 其余情况从标注了“生日”的文本中派生。
 */
export function effectiveBirthday(draft: CharacterDraftAny): CharacterBirthday {
  const structured = normalizeBirthday(draft.birthday);
  if (structured.source === 'manual') return structured;
  if (structured.status !== 'unset') return structured;
  const labeled = findLabeledBirthdayText(birthdayTextValues(draft));
  if (!labeled) return { ...EMPTY_BIRTHDAY };
  const parsed = parseBirthdayText(labeled.raw, 'card_text');
  return { ...parsed, evidence: parsed.evidence || labeled.evidence };
}

export function monthlyBirthday(birthday: CharacterBirthday): { month: number; day: number } | null {
  if (birthday.status !== 'known' || birthday.calendar !== 'gregorian') return null;
  if (!isValidMonthDay(Number(birthday.month), Number(birthday.day))) return null;
  return { month: Number(birthday.month), day: Number(birthday.day) };
}

function projectionColumns(birthday: CharacterBirthday) {
  const monthly = monthlyBirthday(birthday);
  return {
    status: monthly ? 'known' : birthday.status,
    calendar: monthly ? 'gregorian' : birthday.calendar,
    month: monthly ? monthly.month : null,
    day: monthly ? monthly.day : null,
    rawText: birthday.rawText ?? null,
    source: birthday.source ?? null,
  };
}

const UPSERT_BIRTHDAY = 'INSERT INTO character_birthdays(character_id,status,calendar,month,day,raw_text,source,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(character_id) DO UPDATE SET status=excluded.status,calendar=excluded.calendar,month=excluded.month,day=excluded.day,raw_text=excluded.raw_text,source=excluded.source,updated_at=excluded.updated_at';

/** 生日投影完全由角色草稿推导，因此随时可以重建，且不会反过来影响创作内容。 */
export function upsertCharacterBirthday(database: ServiceDatabase, characterId: string, draft: CharacterDraftAny): CharacterBirthday {
  const birthday = effectiveBirthday(draft);
  const columns = projectionColumns(birthday);
  database.connection.prepare(UPSERT_BIRTHDAY)
    .run(characterId, columns.status, columns.calendar, columns.month, columns.day, columns.rawText, columns.source, nowIso());
  return birthday;
}

export function rebuildCharacterBirthdays(database: ServiceDatabase): number {
  const rows = database.connection.prepare('SELECT id,draft_json FROM character_profiles').all() as { id: string; draft_json: string }[];
  database.transaction(() => {
    for (const row of rows) {
      let draft: CharacterDraftAny;
      try { draft = JSON.parse(String(row.draft_json)) as CharacterDraftAny; } catch { continue; }
      upsertCharacterBirthday(database, String(row.id), draft);
    }
  });
  return rows.length;
}
