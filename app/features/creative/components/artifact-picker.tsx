'use client';

import { Loader2, Upload, X } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { InputLabel } from '../input-label';

export function ArtifactPicker({
  id,
  label,
  hint,
  previewUrl,
  artifact,
  uploading,
  accept,
  disabled,
  onSelect,
  onRemove,
}: {
  id: string;
  label: string;
  hint: string;
  previewUrl: string | null;
  artifact: ArtifactDescriptor | null;
  uploading: boolean;
  accept?: string;
  disabled?: boolean;
  onSelect: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[3px_14px_3px_3px] border border-dashed border-[rgb(24_32_29/24%)] bg-[#f4f0e7]/60 p-4">
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        {previewUrl ? <img src={previewUrl} alt={`${label}预览`} className="h-20 w-20 rounded object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded bg-[#18201d]/8 text-[#68716d]"><Upload className="h-5 w-5" aria-hidden="true" /></div>}
        <div className="flex-1">
          <label htmlFor={id} className="inline-flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded border border-[rgb(24_32_29/18%)] bg-[#fffdf8] px-3 text-xs font-semibold text-[#18201d] hover:bg-[#18201d]/5 active:bg-[#18201d]/10">
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
            {uploading ? '正在加入媒体库…' : artifact ? `更换${label}` : `选择并上传${label}`}
            <input id={id} type="file" accept={accept ?? 'image/png,image/jpeg,image/webp,image/gif,image/avif'} className="sr-only" disabled={disabled || uploading} onChange={(event) => { onSelect(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#68716d]">{hint} 浏览器不会发送 Base64。</p>
        </div>
        {artifact && (
          <button type="button" onClick={onRemove} className="self-start rounded p-1.5 text-[#68716d] hover:bg-[#c9674a]/10 hover:text-[#b83b1b]" aria-label={`移除${label}`}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
