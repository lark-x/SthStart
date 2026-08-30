'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { getLocalAsset, localAssetId } from '../local-store';

export function LocalNoteImage({
  src,
  alt,
  priority = false,
}: {
  src: string;
  alt: string;
  priority?: boolean;
}) {
  const assetId = localAssetId(src);
  const [localImage, setLocalImage] = useState<{ assetId: string; url: string } | null>(null);
  const [missingAssetId, setMissingAssetId] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let objectUrl = '';
    let active = true;
    void getLocalAsset(assetId)
      .then((asset) => {
        if (!active) return;
        if (!asset) {
          setMissingAssetId(assetId);
          return;
        }
        objectUrl = URL.createObjectURL(asset.blob);
        setLocalImage({ assetId, url: objectUrl });
      })
      .catch(() => {
        if (active) setMissingAssetId(assetId);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  const remoteSrc = src.replace('/api/v1/admin/', '/api/admin/');
  const resolvedSrc = assetId
    ? localImage?.assetId === assetId ? localImage.url : ''
    : remoteSrc;
  const imageFailed = resolvedSrc ? failedSrc === resolvedSrc : missingAssetId === assetId;

  return (
    <div className="relative h-full w-full">
      {(!resolvedSrc || loadedSrc !== resolvedSrc || imageFailed) && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-[#e6e4dc] px-4 text-center text-xs text-[#68716d]"
          role={imageFailed ? 'alert' : 'status'}
        >
          {imageFailed ? '图片读取失败，请重新打开或重新上传。' : assetId ? '正在读取本机图片…' : '正在加载图片…'}
        </div>
      )}
      {resolvedSrc && !imageFailed && (
        <Image
          src={resolvedSrc}
          alt={alt}
          fill
          unoptimized
          loading={priority ? 'eager' : 'lazy'}
          sizes="(max-width: 768px) calc(100vw - 88px), 824px"
          decoding="async"
          onLoad={() => setLoadedSrc(resolvedSrc)}
          onError={() => setFailedSrc(resolvedSrc)}
          className={`object-contain transition-opacity duration-200 ${loadedSrc === resolvedSrc ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
