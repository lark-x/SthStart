'use client';

import React from 'react';
import { Eye } from 'lucide-react';
import { useEyeCare } from '@/app/providers/ui-provider';

export function EyeCareToggle({ className }: { className?: string }) {
  const { eyeCare, toggleEyeCare } = useEyeCare();

  return (
    <button
      type="button"
      onClick={() => toggleEyeCare()}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-semibold transition-all cursor-pointer select-none ${
        eyeCare
          ? 'bg-[#d35832]/15 text-[#a8391b] border border-[#d35832]/35 shadow-2xs'
          : 'bg-[#fffdf8]/80 hover:bg-white text-[#68716d] hover:text-[#18201d] border border-[rgb(24_32_29/14%)] shadow-2xs'
      } ${className ?? ''}`}
      title={eyeCare ? '关闭暖杏护眼模式' : '开启暖杏护眼模式'}
      aria-label={eyeCare ? '关闭暖杏护眼模式' : '开启暖杏护眼模式'}
    >
      <Eye className={`h-3.5 w-3.5 ${eyeCare ? 'text-[#d35832]' : 'text-[#68716d]'}`} />
      <span>{eyeCare ? '暖杏护眼' : '护眼'}</span>
    </button>
  );
}
