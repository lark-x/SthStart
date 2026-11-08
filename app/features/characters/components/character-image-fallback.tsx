'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ImageOff, RefreshCw, User } from 'lucide-react';

interface CharacterAvatarProps {
  src?: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
}

export function CharacterAvatar({
  src,
  name,
  className = 'object-cover',
  fallbackClassName,
}: CharacterAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initialLetter = (name || '').trim().slice(0, 1) || '?';

  if (!src || failedSrc === src) {
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center select-none font-semibold text-muted bg-surface-sunken ${fallbackClassName || ''}`}
        title={name}
      >
        <span>{initialLetter}</span>
      </div>
    );
  }

  return (
    <Image
      key={src}
      src={src}
      alt={name}
      fill
      unoptimized
      className={className}
      onError={() => setFailedSrc(src)}
    />
  );
}

interface CharacterVisualPreviewProps {
  portraitUrl?: string | null;
  avatarUrl?: string | null;
  displayName: string;
}

export function CharacterVisualPreview({
  portraitUrl,
  avatarUrl,
  displayName,
}: CharacterVisualPreviewProps) {
  const [failedPortraitSrc, setFailedPortraitSrc] = useState<string | null>(null);
  const [failedAvatarSrc, setFailedAvatarSrc] = useState<string | null>(null);
  const [portraitRetry, setPortraitRetry] = useState(0);
  const [avatarRetry, setAvatarRetry] = useState(0);

  const effectivePortraitSrc: string = portraitUrl && portraitRetry > 0
    ? `${portraitUrl}${portraitUrl.includes('?') ? '&' : '?'}retry=${portraitRetry}`
    : portraitUrl || '';

  const effectiveAvatarSrc: string = avatarUrl && avatarRetry > 0
    ? `${avatarUrl}${avatarUrl.includes('?') ? '&' : '?'}retry=${avatarRetry}`
    : avatarUrl || '';

  const showPortrait = Boolean(portraitUrl && failedPortraitSrc !== portraitUrl);
  const showAvatarFallback = !showPortrait && Boolean(avatarUrl && failedAvatarSrc !== avatarUrl);
  const isPortraitFailedWithAvatar = Boolean(portraitUrl && failedPortraitSrc === portraitUrl && avatarUrl && failedAvatarSrc !== avatarUrl);

  const retryPortrait = () => {
    setFailedPortraitSrc(null);
    setPortraitRetry((c) => c + 1);
  };

  const retryAvatar = () => {
    setFailedAvatarSrc(null);
    setAvatarRetry((c) => c + 1);
  };

  const retryBoth = () => {
    if (portraitUrl) retryPortrait();
    if (avatarUrl) retryAvatar();
  };

  return (
    <div className="group relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken shadow-inner flex items-center justify-center">
      {showPortrait ? (
        <Image
          key={effectivePortraitSrc}
          src={effectivePortraitSrc}
          alt={displayName || '角色立绘'}
          fill
          unoptimized
          className="object-contain"
          onError={() => setFailedPortraitSrc(portraitUrl || '')}
        />
      ) : showAvatarFallback ? (
        <Image
          key={effectiveAvatarSrc}
          src={effectiveAvatarSrc}
          alt={displayName || '角色头像'}
          fill
          unoptimized
          className="object-cover opacity-90"
          onError={() => setFailedAvatarSrc(avatarUrl || '')}
        />
      ) : (
        <div className="flex flex-col items-center justify-center text-muted p-4 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface border border-border-subtle flex items-center justify-center mb-2 shadow-2xs">
            {(portraitUrl && failedPortraitSrc === portraitUrl) ||
            (avatarUrl && failedAvatarSrc === avatarUrl) ? (
              <ImageOff className="h-6 w-6 stroke-[1.5]" aria-hidden="true" />
            ) : (
              <User className="h-6 w-6 opacity-40" />
            )}
          </div>
          <span className="text-xs text-muted">
            {(portraitUrl && failedPortraitSrc === portraitUrl) ||
            (avatarUrl && failedAvatarSrc === avatarUrl) ? '立绘与头像加载失败' : '暂无立绘与头像'}
          </span>
          {((portraitUrl && failedPortraitSrc === portraitUrl) ||
            (avatarUrl && failedAvatarSrc === avatarUrl)) && (
            <button
              type="button"
              onClick={retryBoth}
              className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-control bg-surface border border-border-subtle text-xs text-ink hover:bg-surface-hover shadow-2xs cursor-pointer"
            >
              <RefreshCw className="h-3 w-3" />
              <span>重试加载</span>
            </button>
          )}
        </div>
      )}

      {/* 头像徽章（左上角微圆图）：若立绘正常显示且头像也有效，显示左上角头像徽章 */}
      {showPortrait && avatarUrl && failedAvatarSrc !== avatarUrl && (
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-surface/90 backdrop-blur-md p-1 pr-2 shadow-sm border border-border-subtle">
          <div className="relative h-7 w-7 overflow-hidden rounded-full border border-border-subtle bg-surface-sunken">
            <Image
              key={effectiveAvatarSrc}
              src={effectiveAvatarSrc}
              alt={displayName || '角色头像'}
              fill
              unoptimized
              className="object-cover"
              onError={() => setFailedAvatarSrc(avatarUrl || '')}
            />
          </div>
          <span className="text-xs font-semibold text-ink">当前头像</span>
        </div>
      )}

      {/* 状态徽标与回退提示 */}
      {showPortrait && (
        <div className="absolute top-2.5 right-2.5 rounded-md bg-surface/85 backdrop-blur-md px-1.5 py-0.5 text-xs font-medium text-ink shadow-sm border border-border-subtle">
          当前立绘
        </div>
      )}

      {isPortraitFailedWithAvatar && (
        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-control bg-surface/95 px-2 py-1 text-xs font-medium text-warning-fg border border-border-subtle">
          <span>立绘不可用 · 显示头像</span>
          <button
            type="button"
            onClick={retryPortrait}
            className="hover:underline flex items-center gap-0.5 text-ink cursor-pointer"
            title="重试立绘加载"
            aria-label="重试立绘加载"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

interface CharacterAssetImageProps {
  src?: string | null;
  alt?: string;
  title?: string;
  className?: string;
  fill?: boolean;
}

export function CharacterAssetImage({
  src,
  alt,
  title,
  className = 'w-full h-full object-cover',
  fill = false,
}: CharacterAssetImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const effectiveSrc: string = src && retryCount > 0
    ? `${src}${src.includes('?') ? '&' : '?'}retry=${retryCount}`
    : src || '';

  if (!src || failedSrc === src) {
    if (fill) return <div className="flex h-full w-full items-center justify-center bg-surface-sunken text-muted" title="素材暂不可用"><ImageOff className="h-5 w-5" aria-label="素材暂不可用" /></div>;
    return (
      <div className="w-full h-full min-h-[96px] bg-surface-sunken flex flex-col items-center justify-center p-3 text-center select-none overflow-hidden border border-border-subtle/60 rounded-lg">
        <div className="w-8 h-8 rounded-control bg-surface border border-border-subtle flex items-center justify-center text-muted mb-1 shadow-2xs">
          <ImageOff className="h-4 w-4 stroke-[1.5]" aria-hidden="true" />
        </div>
        <p className="text-xs text-muted">素材暂不可用</p>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFailedSrc(null);
            setRetryCount((c) => c + 1);
          }}
          className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-control bg-surface border border-border-subtle text-xs text-ink hover:bg-surface-hover shadow-2xs cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" />
          <span>重试</span>
        </button>
      </div>
    );
  }

  if (fill) {
    return (
      <Image
        key={effectiveSrc}
        src={effectiveSrc}
        alt={alt || title || '资产图片'}
        fill
        unoptimized
        className={className}
        onError={() => setFailedSrc(src)}
      />
    );
  }

  return (
    <img
      key={effectiveSrc}
      src={effectiveSrc}
      alt={alt || title || '资产图片'}
      className={className}
      onError={() => setFailedSrc(src)}
      loading="lazy"
    />
  );
}
