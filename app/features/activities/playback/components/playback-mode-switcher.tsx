'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageTabs } from '@/app/components/ui/page-tabs';

export interface PlaybackModeSwitcherProps {
  comicMode: boolean;
}

export function PlaybackModeSwitcher({ comicMode }: PlaybackModeSwitcherProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSelectMode = (mode: 'playback' | 'comic') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'playback');
    if (mode === 'comic') {
      params.set('mode', 'comic');
    } else {
      params.delete('mode');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border-default bg-surface px-3 py-2">
      <PageTabs
        ariaLabel="活动回放模式"
        variant="local"
        value={comicMode ? 'comic' : 'playback'}
        onChange={(mode) => handleSelectMode(mode as 'playback' | 'comic')}
        tabs={[
          { id: 'playback', label: '原回放' },
          { id: 'comic', label: '漫画' },
        ]}
      />
      {comicMode && (
        <span className="text-xs text-muted">独立漫画草稿；不会改写分镜原图</span>
      )}
    </div>
  );
}
