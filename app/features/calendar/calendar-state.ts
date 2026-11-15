export function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function toDateKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 将日历使用的 YYYY-MM-DD 键格式化为界面可读日期，避免经过 UTC 换算。 */
export function formatCalendarDate(value: string, options: { short?: boolean } = {}) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  const weekday = new Date(year, month - 1, day).getDay();
  const date = `${month} 月 ${day} 日`;
  return options.short ? date : `${date} ${WEEKDAY_LABELS[weekday]}`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** 周一作为每周第一天。 */
export function leadingBlanks(year: number, month: number) {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7;
}

/** 切换月份时把当前选中日收进新月份，并优先保留原日号。 */
export function shiftCalendarMonth(year: number, month: number, delta: number, selectedDate: string) {
  const next = new Date(year, month - 1 + delta, 1);
  const nextYear = next.getFullYear();
  const nextMonth = next.getMonth() + 1;
  const selectedDay = Number(selectedDate.slice(8, 10));
  const day = Math.min(
    Number.isSafeInteger(selectedDay) && selectedDay > 0 ? selectedDay : 1,
    daysInMonth(nextYear, nextMonth),
  );
  return {
    year: nextYear,
    month: nextMonth,
    selectedDate: toDateKey(nextYear, nextMonth, day),
  };
}
