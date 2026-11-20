/**
 * EntityArt 纯模型：按实体 ID 生成稳定的生成式纹样参数。
 * 不依赖浏览器或 React；同一 seed 永远得到同一组参数，不同 seed 尽量落在不同纹样上。
 */

export type EntityArtTone = 'violet' | 'blue' | 'orange' | 'green' | 'pink' | 'slate';
export type EntityArtVariant = 'arcs' | 'bands' | 'dots' | 'waves';
export type EntityArtRatio = 'avatar' | 'portrait' | 'cover';

export const ENTITY_ART_TONES: readonly EntityArtTone[] = ['violet', 'blue', 'orange', 'green', 'pink', 'slate'];
export const ENTITY_ART_VARIANTS: readonly EntityArtVariant[] = ['arcs', 'bands', 'dots', 'waves'];

/** 与设计语言 §5 一致：头像 1:1、立绘 3:4、封面 16:10。 */
export const ENTITY_ART_ASPECT: Record<EntityArtRatio, string> = {
  avatar: '1 / 1',
  portrait: '3 / 4',
  cover: '16 / 10',
};

export interface EntityArtSpec {
  tone: EntityArtTone;
  variant: EntityArtVariant;
  /** 纹样整体旋转角度（度）。 */
  angle: number;
  /** 纹样中心偏移，0–100 的百分比坐标。 */
  originX: number;
  originY: number;
  /** 1–3：纹样层数，控制疏密。 */
  density: 1 | 2 | 3;
  glyph: string;
  /** 便于测试与调试的稳定指纹。 */
  fingerprint: string;
}

/** FNV-1a 32 位哈希：足够稳定、分布均匀，且无需依赖加密 API。 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 取标题的第一个可见字符（按码点切分，避免把代理对或组合字符切坏）。 */
export function entityGlyph(title: string): string {
  const trimmed = (title || '').trim();
  const first = Array.from(trimmed)[0];
  return first ? first.toLocaleUpperCase('zh-CN') : '';
}

export function entityArtSpec(seed: string, title: string, tone?: EntityArtTone | null): EntityArtSpec {
  const base = hashSeed(seed || title || 'entity');
  // 每个参数取哈希的不同位段，降低参数之间的相关性。
  const mix = (shift: number) => (Math.imul(base ^ (base >>> shift), 0x9e3779b1) >>> 0);
  const variant = ENTITY_ART_VARIANTS[mix(3) % ENTITY_ART_VARIANTS.length];
  const resolvedTone = tone ?? ENTITY_ART_TONES[mix(7) % ENTITY_ART_TONES.length];
  const angle = (mix(11) % 12) * 15;
  const originX = 20 + (mix(13) % 61);
  const originY = 15 + (mix(17) % 71);
  const density = (1 + (mix(19) % 3)) as 1 | 2 | 3;
  const glyph = entityGlyph(title);
  return {
    tone: resolvedTone, variant, angle, originX, originY, density, glyph,
    fingerprint: [resolvedTone, variant, angle, originX, originY, density].join(':'),
  };
}
