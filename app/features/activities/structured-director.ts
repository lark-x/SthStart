import type { DirectorSettings } from '@sthstart/contracts';

export const DIRECTOR_OPTIONS = {
  shotSize: [{ value: 'wide', label: '远景' }, { value: 'medium', label: '中景' }, { value: 'closeup', label: '特写' }, { value: 'detail', label: '细节' }, { value: 'full_body', label: '全身' }],
  angle: [{ value: 'eye_level', label: '平视' }, { value: 'high', label: '俯视' }, { value: 'low', label: '仰视' }],
  lighting: [{ value: 'natural', label: '自然光' }, { value: 'warm', label: '暖光' }, { value: 'rim', label: '轮廓光' }, { value: 'low_key', label: '低调光' }],
  mood: [{ value: 'calm', label: '平静' }, { value: 'tense', label: '紧张' }, { value: 'joyful', label: '欢快' }, { value: 'melancholy', label: '忧郁' }],
} as const;

/** Author text is deliberately not parsed or rewritten by toggling a director choice. */
export function toggleDirectorSetting<K extends keyof DirectorSettings>(settings: DirectorSettings, key: K, value: NonNullable<DirectorSettings[K]>): DirectorSettings {
  const next = { ...settings };
  if (next[key] === value) delete next[key]; else next[key] = value;
  return next;
}

export function validVisualNumericValue(raw: string, field: { type: string; minimum?: number; maximum?: number; step?: number }): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || (field.type !== 'number' && !Number.isSafeInteger(value))
    || (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)
    || (field.step !== undefined && field.step > 0 && Math.abs((value - (field.minimum ?? 0)) / field.step - Math.round((value - (field.minimum ?? 0)) / field.step)) > 1e-7)) return null;
  return value;
}
