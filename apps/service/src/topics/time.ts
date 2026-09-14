/**
 * 定时搜集的时间计算。
 * 时间以设置里的固定时区解释（默认 Asia/Shanghai），不随部署机器时区改变。
 * 只用 Intl 计算偏移，不引入额外依赖。
 */

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_DAILY_TIME = '09:00';

function partsInZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  // Intl 在部分环境把午夜归一到 24，折算成 0 点。
  if (values.hour === 24) values.hour = 0;
  return {
    year: values.year ?? 1970,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** 该时刻在目标时区的 UTC 偏移（毫秒）。 */
export function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = partsInZone(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - instant;
}

/** 把目标时区的本地时刻换算成 UTC 时间戳；两轮迭代足以跨过夏令时切换。 */
export function zonedTimeToInstant(input: {
  year: number; month: number; day: number; hour: number; minute: number;
}, timeZone: string): number {
  const naive = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, 0, 0);
  let instant = naive;
  for (let round = 0; round < 2; round += 1) {
    instant = naive - zoneOffsetMs(instant, timeZone);
  }
  return instant;
}

/** 校验 HH:mm 并拆成时/分；非法输入回退到默认 09:00。 */
export function parseDailyTime(value: string | null | undefined): { hour: number; minute: number } {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(value ?? '').trim());
  if (!match) return { hour: 9, minute: 0 };
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** 校验时区名；非法输入回退到默认时区。 */
export function normalizeTimezone(value: string | null | undefined): string {
  const candidate = String(value ?? '').trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * 计算下一次执行时间：目标时区里下一个 dailyTime 时刻。
 * 今天的 dailyTime 已经过去时顺延到明天。
 */
export function computeNextRunAt(from: Date, dailyTime: string, timeZone: string): string {
  const zone = normalizeTimezone(timeZone);
  const { hour, minute } = parseDailyTime(dailyTime);
  const local = partsInZone(from, zone);
  const todayTarget = zonedTimeToInstant({ year: local.year, month: local.month, day: local.day, hour, minute }, zone);
  if (todayTarget > from.getTime()) return new Date(todayTarget).toISOString();
  // 顺延一天：先在本地日历上 +1 天，再换算回 UTC。
  const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day) + 86_400_000);
  const target = zonedTimeToInstant({
    year: nextDay.getUTCFullYear(),
    month: nextDay.getUTCMonth() + 1,
    day: nextDay.getUTCDate(),
    hour, minute,
  }, zone);
  return new Date(target).toISOString();
}

/** 展示用的本地时间描述，例如 2026-09-14 09:00。 */
export function describeInZone(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return null;
  const zone = normalizeTimezone(timeZone);
  const p = partsInZone(new Date(instant), zone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return p.year + '-' + pad(p.month) + '-' + pad(p.day) + ' ' + pad(p.hour) + ':' + pad(p.minute);
}
