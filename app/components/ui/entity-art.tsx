'use client';

import React, { useState } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './skeleton';
import {
  ENTITY_ART_ASPECT,
  entityArtSpec,
  type EntityArtRatio,
  type EntityArtSpec,
  type EntityArtTone,
} from './entity-art-model';

export type { EntityArtRatio, EntityArtTone } from './entity-art-model';

function Pattern({ spec, id }: { spec: EntityArtSpec; id: string }) {
  const layers = Array.from({ length: spec.density + 1 }, (_, index) => index);
  const transform = `rotate(${spec.angle} ${spec.originX} ${spec.originY})`;
  switch (spec.variant) {
    case 'arcs':
      return (
        <g transform={transform} fill="none" stroke="var(--tone)" strokeWidth="1.6">
          {layers.map((index) => (
            <circle key={index} cx={spec.originX} cy={spec.originY} r={18 + index * 16} opacity={0.32 - index * 0.06} />
          ))}
        </g>
      );
    case 'bands':
      return (
        <g transform={transform} fill="var(--tone)">
          {layers.map((index) => (
            <rect key={index} x={-40} y={spec.originY - 30 + index * 22} width={200} height={9} opacity={0.2 - index * 0.035} />
          ))}
        </g>
      );
    case 'dots':
      return (
        <g transform={transform} fill="var(--tone)">
          <pattern id={`${id}-dots`} width={10 - spec.density} height={10 - spec.density} patternUnits="userSpaceOnUse">
            <circle cx={2} cy={2} r={1.1} opacity={0.45} />
          </pattern>
          <rect x={-30} y={-30} width={160} height={160} fill={`url(#${id}-dots)`} opacity={0.45} />
          <circle cx={spec.originX} cy={spec.originY} r={30 + spec.density * 6} fill={`url(#${id}-dots)`} />
        </g>
      );
    case 'waves':
    default:
      return (
        <g transform={transform} fill="none" stroke="var(--tone)" strokeWidth="1.8" strokeLinecap="round">
          {layers.map((index) => {
            const y = spec.originY - 18 + index * 14;
            return <path key={index} d={`M-20 ${y} Q 15 ${y - 12} 50 ${y} T 120 ${y}`} opacity={0.34 - index * 0.06} />;
          })}
        </g>
      );
  }
}

export interface EntityArtProps {
  /** 稳定来源：实体 ID。改名不会改变纹样。 */
  seed: string;
  /** 用于首字与可读名称。 */
  title: string;
  /** 模块识别色；缺省时由 seed 派生。 */
  tone?: EntityArtTone | null;
  ratio?: EntityArtRatio;
  /** 填满父容器（父容器自行决定尺寸与比例）。 */
  fill?: boolean;
  /** 纯装饰时不进入读屏（例如旁边已有标题）。 */
  decorative?: boolean;
  className?: string;
}

/** 生成式占位：暖纸底 + 模块色纹样 + 首字。不发请求，四套主题跟随 token。 */
export function EntityArt({ seed, title, tone, ratio = 'cover', fill = false, decorative = true, className }: EntityArtProps) {
  const spec = entityArtSpec(seed, title, tone);
  const id = `entity-art-${seed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'x'}`;
  return (
    <span
      className={cn('entity-art', fill && 'entity-art-fill', className)}
      data-tone={spec.tone}
      data-variant={spec.variant}
      data-entity-art="true"
      data-fingerprint={spec.fingerprint}
      data-ratio={ratio}
      style={fill ? undefined : { aspectRatio: ENTITY_ART_ASPECT[ratio] }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative ? true : undefined}
    >
      <svg className="entity-art-pattern" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <Pattern spec={spec} id={id} />
      </svg>
      {spec.glyph && <span className="entity-art-glyph" aria-hidden="true">{spec.glyph}</span>}
    </span>
  );
}

export interface EntityImageProps extends Omit<EntityArtProps, 'decorative'> {
  /** 真实图像地址：封面、立绘或首图。缺省或加载失败时显示 EntityArt。 */
  src?: string | null;
  alt?: string;
  /** object-fit，默认裁切填满。 */
  fit?: 'cover' | 'contain';
}

/**
 * 统一的实体图像：固定比例、面板圆角、1px 发丝边、懒加载；加载中显示同尺寸 Skeleton，
 * 没有图或加载失败时回落到 EntityArt，不出现破图。
 */
export function EntityImage({ src, alt, fit = 'cover', ratio = 'cover', fill = false, className, ...art }: EntityImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const loading = showImage && loadedSrc !== src;
  return (
    <span
      className={cn('entity-image', fill && 'entity-art-fill', className)}
      style={fill ? undefined : { aspectRatio: ENTITY_ART_ASPECT[ratio] }}
      data-ratio={ratio}
      data-entity-image={showImage ? 'image' : 'art'}
    >
      {showImage ? (
        <>
          {loading && <Skeleton className="entity-image-skeleton" aria-hidden="true" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- 媒体由门户代理提供，不经 next/image 优化 */}
          <img
            key={src!}
            src={src!}
            alt={alt ?? art.title}
            loading="lazy"
            decoding="async"
            className="entity-image-img"
            data-fit={fit}
            data-loaded={loading ? 'false' : 'true'}
            onLoad={() => setLoadedSrc(src!)}
            onError={() => setFailedSrc(src!)}
          />
        </>
      ) : (
        <EntityArt {...art} ratio={ratio} fill decorative={alt === ''} />
      )}
    </span>
  );
}
