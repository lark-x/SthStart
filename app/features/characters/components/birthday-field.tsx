'use client';

import type { CharacterBirthday } from '@sthstart/contracts';
import { Input } from '@/app/components/ui/input';

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const EMPTY: CharacterBirthday = { status: 'unset', calendar: 'unknown' };

const STATUS_LABEL: Record<CharacterBirthday['status'], string> = {
  known: '已确认（公历）',
  needs_confirmation: '待确认',
  unset: '未填写',
};

/**
 * 生日编辑器。只有“已确认 + 公历”的月日会进入日历；农历、冲突或模糊写法保留原文等待人工确认。
 * 明确选择“未填写”会记录 manual 来源，之后不会再从人设正文自动补回。
 */
export function BirthdayField({ value, onChange }: { value?: CharacterBirthday; onChange: (next: CharacterBirthday) => void }) {
  const birthday = value || EMPTY;
  const month = Number(birthday.month);
  const day = Number(birthday.day);
  const days = Number.isInteger(month) && month >= 1 && month <= 12 ? MONTH_DAYS[month - 1] : 31;

  const setStatus = (status: CharacterBirthday['status']) => {
    if (status === 'unset') return onChange({ status: 'unset', calendar: 'unknown', source: 'manual' });
    if (status === 'needs_confirmation') return onChange({ ...birthday, status, ...(birthday.calendar === 'gregorian' ? { calendar: 'unknown' as const } : {}), source: 'manual' });
    const nextMonth = Number.isInteger(month) ? month : 1;
    const maxDay = MONTH_DAYS[nextMonth - 1];
    onChange({ status: 'known', calendar: 'gregorian', month: nextMonth, day: Number.isInteger(day) && day <= maxDay ? day : 1, ...(birthday.rawText ? { rawText: birthday.rawText } : {}), source: 'manual' });
  };
  const setMonthDay = (nextMonth: number, nextDay: number) => {
    const maxDay = MONTH_DAYS[nextMonth - 1];
    onChange({ ...birthday, month: nextMonth, day: Math.min(nextDay, maxDay), ...(birthday.rawText ? { rawText: birthday.rawText } : {}), source: 'manual' });
  };

  return (
    <fieldset className="rounded-lg border border-border-subtle p-3">
      <legend className="px-1 text-sm font-semibold text-ink">生日</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-ink">
          <span>状态</span>
          <select
            aria-label="生日状态"
            className="mt-1.5 w-full rounded border border-ink/15 bg-surface px-2 py-2 text-sm"
            value={birthday.status}
            onChange={(event) => setStatus(event.target.value as CharacterBirthday['status'])}
          >
            {(['unset', 'known', 'needs_confirmation'] as const).map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-ink">
            <span>月份</span>
            <select
              aria-label="生日月份"
              disabled={birthday.status === 'unset'}
              className="mt-1.5 w-full rounded border border-ink/15 bg-surface px-2 py-2 text-sm disabled:opacity-50"
              value={Number.isInteger(month) ? String(month) : ''}
              onChange={(event) => setMonthDay(Number(event.target.value), Number.isInteger(day) ? day : 1)}
            >
              <option value="">未选择</option>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{item} 月</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">
            <span>日期</span>
            <select
              aria-label="生日日期"
              disabled={birthday.status === 'unset'}
              className="mt-1.5 w-full rounded border border-ink/15 bg-surface px-2 py-2 text-sm disabled:opacity-50"
              value={Number.isInteger(day) ? String(day) : ''}
              onChange={(event) => setMonthDay(Number.isInteger(month) ? month : 1, Number(event.target.value))}
            >
              <option value="">未选择</option>
              {Array.from({ length: days }, (_, index) => index + 1).map((item) => <option key={item} value={item}>{item} 日</option>)}
            </select>
          </label>
        </div>
      </div>

      <label className="mt-3 block text-sm font-semibold text-ink">
        <span>原始生日文字（农历 / 冲突写法保留在此）</span>
        <Input
          aria-label="生日原始文字"
          value={birthday.rawText || ''}
          onChange={(event) => onChange({ ...birthday, ...(event.target.value.trim() ? { rawText: event.target.value } : { rawText: undefined }) })}
          placeholder="例如：农历八月十五"
          className="mt-1.5"
        />
      </label>

      {birthday.status === 'needs_confirmation' && (
        <p className="mt-2 text-sm text-muted">
          待确认的生日不会出现在日历上。确认月日后请把状态改为“已确认”，日历每年按公历显示。
        </p>
      )}
      {birthday.status === 'known' && month === 2 && day === 29 && <p className="mt-2 text-sm text-muted">2 月 29 日只在闰年的日历上显示，平年不会自动改期。</p>}
      {birthday.status === 'unset' && birthday.source === 'manual' && <p className="mt-2 text-sm text-muted">已明确清空：不会再从人设正文自动识别生日。</p>}
      {birthday.evidence && <p className="mt-2 text-sm text-muted">识别依据：{birthday.evidence}</p>}
    </fieldset>
  );
}
