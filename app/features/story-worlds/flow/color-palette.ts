/**
 * 角色稳定色彩映射与语义 Token 派生器
 * 遵循项目规范：统一使用现有 --tone-* 识别色变量与 color-mix，杜绝随意硬编码
 */

export interface CharacterTone {
  id: string;
  name: string;
  cssColor: string;
  cssBgSoft: string;
  cssBorderSoft: string;
}

export const CHARACTER_TONE_PRESETS: CharacterTone[] = [
  {
    id: 'violet',
    name: '紫罗兰',
    cssColor: 'var(--tone-violet)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-violet) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-violet) 28%, var(--surface))',
  },
  {
    id: 'blue',
    name: '青蓝',
    cssColor: 'var(--tone-blue)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-blue) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-blue) 28%, var(--surface))',
  },
  {
    id: 'orange',
    name: '琥珀橙',
    cssColor: 'var(--tone-orange)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-orange) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-orange) 28%, var(--surface))',
  },
  {
    id: 'green',
    name: '翡翠绿',
    cssColor: 'var(--tone-green)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-green) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-green) 28%, var(--surface))',
  },
  {
    id: 'pink',
    name: '蔷薇粉',
    cssColor: 'var(--tone-pink)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-pink) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-pink) 28%, var(--surface))',
  },
  {
    id: 'slate',
    name: '岩灰',
    cssColor: 'var(--tone-slate)',
    cssBgSoft: 'color-mix(in srgb, var(--tone-slate) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--tone-slate) 28%, var(--surface))',
  },
  {
    id: 'accent',
    name: '雅紫强调',
    cssColor: 'var(--accent)',
    cssBgSoft: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, var(--accent) 28%, var(--surface))',
  },
  {
    id: 'teal',
    name: '松石绿',
    cssColor: 'color-mix(in srgb, var(--tone-blue) 50%, var(--tone-green))',
    cssBgSoft: 'color-mix(in srgb, color-mix(in srgb, var(--tone-blue) 50%, var(--tone-green)) 12%, var(--surface))',
    cssBorderSoft: 'color-mix(in srgb, color-mix(in srgb, var(--tone-blue) 50%, var(--tone-green)) 28%, var(--surface))',
  },
];

/**
 * 依据角色 ID 或序号生成确定性的稳定色，避免重新渲染或新增事件时颜色闪烁跳变
 */
export function getActorTone(actorId: string, index?: number): CharacterTone {
  if (typeof index === 'number' && index >= 0) {
    return CHARACTER_TONE_PRESETS[index % CHARACTER_TONE_PRESETS.length];
  }
  let hash = 0;
  for (let i = 0; i < actorId.length; i++) {
    hash = (hash << 5) - hash + actorId.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return CHARACTER_TONE_PRESETS[positive % CHARACTER_TONE_PRESETS.length];
}
