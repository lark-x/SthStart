'use client';

import { useState } from 'react';
import { PlayCircle } from 'lucide-react';

export function LazyVideo({ url, className }: { url: string; className: string }) {
  const [active, setActive] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const thumbnailUrl = `${url}${url.includes('?') ? '&' : '?'}thumbnail=true`;

  if (active) {
    return <video src={url} controls autoPlay muted loop playsInline preload="metadata" className={className} />;
  }

  return (
    <button
      type="button"
      onClick={(event) => { event.preventDefault(); setActive(true); }}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden ${className}`}
      aria-label="点击播放视频"
    >
      {!thumbnailFailed && (
        <img
          src={thumbnailUrl}
          onError={() => setThumbnailFailed(true)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="relative z-10 rounded-full bg-[#18201d]/70 p-2 text-white">
        <PlayCircle className="h-7 w-7" aria-hidden="true" />
      </span>
    </button>
  );
}
