import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveBirthday, findLabeledBirthdayText, isValidMonthDay, occursInYear, parseBirthdayText } from './characters/birthday.js';
import { normalizeCharacterDraft } from './characters/draft.js';

test('birthday parsing accepts explicit gregorian month/day and never invents dates', () => {
  const known = parseBirthdayText('生日：8月8日', 'card_text');
  assert.equal(known.status, 'known');
  assert.equal(known.calendar, 'gregorian');
  assert.equal(known.month, 8);
  assert.equal(known.day, 8);

  const full = parseBirthdayText('1998-03-14', 'card_field');
  assert.equal(full.status, 'known');
  assert.equal(full.month, 3);
  assert.equal(full.day, 14);

  assert.equal(parseBirthdayText('2月29日').status, 'known');
  // 2 月 30 日不是有效日期，不能进入日历。
  assert.equal(parseBirthdayText('2月30日').status, 'needs_confirmation');
  assert.equal(parseBirthdayText('13月1日').status, 'needs_confirmation');
});

test('ambiguous, lunar, conflicting and vague birthdays stay in needs_confirmation', () => {
  const lunar = parseBirthdayText('农历八月十五');
  assert.equal(lunar.status, 'needs_confirmation');
  assert.equal(lunar.calendar, 'lunar');
  assert.equal(lunar.rawText, '农历八月十五');

  const ambiguousOrder = parseBirthdayText('08/08');
  assert.equal(ambiguousOrder.status, 'needs_confirmation');
  assert.equal(ambiguousOrder.month, undefined);

  const conflicting = parseBirthdayText('生日是5月1日或10月1日');
  assert.equal(conflicting.status, 'needs_confirmation');

  const vague = parseBirthdayText('生日在春天');
  assert.equal(vague.status, 'needs_confirmation');
  assert.equal(vague.month, undefined);
  assert.equal(vague.rawText, '生日在春天');
});

test('only labeled birthday lines are discovered in free text', () => {
  assert.equal(findLabeledBirthdayText(['今天和朋友去吃了火锅', '她喜欢在海边散步']), null);
  const found = findLabeledBirthdayText(['她的生日：3月14日', '其他资料']);
  assert.ok(found);
  assert.equal(found.raw, '3月14日');
});

test('effective birthday derives from legacy text but respects an explicit clear', () => {
  const legacy = normalizeCharacterDraft({ displayName: '旧角色', identity: '档案\n生日：3月14日' });
  const derived = effectiveBirthday(legacy);
  assert.equal(derived.status, 'known');
  assert.equal(derived.month, 3);
  assert.equal(derived.day, 14);

  const cleared = normalizeCharacterDraft({ displayName: '旧角色', identity: '档案\n生日：3月14日', birthday: { status: 'unset', calendar: 'unknown', source: 'manual' } });
  const afterClear = effectiveBirthday(cleared);
  assert.equal(afterClear.status, 'unset');
  assert.equal(afterClear.source, 'manual');
});

test('calendar month/day helpers keep february 29 only on leap years', () => {
  assert.equal(isValidMonthDay(2, 29), true);
  assert.equal(isValidMonthDay(2, 30), false);
  assert.equal(occursInYear(2, 29, 2024), true);
  assert.equal(occursInYear(2, 29, 2025), false);
  assert.equal(occursInYear(2, 29, 2000), true);
  assert.equal(occursInYear(3, 14, 2025), true);
});
