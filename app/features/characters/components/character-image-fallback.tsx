'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { ImageOff, RefreshCw, User } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { IconButton } from '@/app/components/ui/icon-button';
import { pickAvatarTone } from '../model/avatar-tone';

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
  const tone = pickAvatarTone(name || '');

  if (!src || failedSrc === src) {
    return (
      <div
        data-tone={tone}
        data-character-avatar-fallback="true"
        className={`relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-[var(--tone-soft)] font-[680] text-[var(--tone-fg)] ${fallbackClassName || ''}`}
        title={name}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(130% 95% at 15% 5%, color-mix(in srgb, var(--tone) 24%, transparent), transparent 58%), radial-gradient(80% 80% at 90% 95%, color-mix(in srgb, var(--tone) 16%, transparent), transparent 60%)',
          }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2.5 -right-1 select-none text-[2.8em] font-bold leading-none opacity-[0.09]"
        >
          {initialLetter}
        </span>
        <span className="relative text-[1.4em] font-[680] leading-none tracking-tight">{initialLetter}</span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgb(255_255_255/30%),inset_0_0_0_1px_color-mix(in_srgb,var(--tone)_22%,transparent)]"
        />
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

  const hasAnyVisual = Boolean(portraitUrl || avatarUrl);

  return (
    <div
      className={`group relative w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken shadow-inner flex items-center justify-center ${
        hasAnyVisual ? 'aspect-[3/4]' : 'aspect-[4/3]'
      }`}
    >
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={retryBoth}
              className="mt-2 h-auto min-h-[var(--control-h-touch)] sm:min-h-7 px-2.5 py-1 text-xs shadow-2xs [&_.ui-mantine-button-label]:gap-1"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>重试加载</span>
            </Button>
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
          <IconButton
            icon={RefreshCw}
            label="重试立绘加载"
            size="icon"
            variant="ghost"
            onClick={retryPortrait}
            className="h-auto !size-6 sm:!size-6 !min-h-6 !min-w-6 p-0 text-ink hover:underline"
            iconClassName="h-3 w-3"
          />
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setFailedSrc(null);
            setRetryCount((c) => c + 1);
          }}
          className="mt-1.5 h-auto min-h-[var(--control-h-touch)] sm:min-h-7 px-2 py-0.5 text-xs shadow-2xs [&_.ui-mantine-button-label]:gap-1"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          <span>重试</span>
        </Button>
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
