'use client';

import { Upload, X } from 'lucide-react';
import type { ArtifactDescriptor } from '@sthstart/contracts';
import { IconButton } from '@/app/components/ui/icon-button';
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
    <div className="rounded-panel border border-dashed border-border-strong bg-paper/60 p-4">
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
        {previewUrl ? <img src={previewUrl} alt={`${label}预览`} className="h-20 w-20 rounded object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded bg-ink/8 text-muted"><Upload className="h-5 w-5" aria-hidden="true" /></div>}
        <div className="flex-1">
          <label htmlFor={id} className="inline-flex min-h-[var(--control-h-touch)] cursor-pointer items-center justify-center gap-2 rounded-control border border-border-default bg-surface px-3 text-sm font-semibold text-ink hover:bg-surface-hover sm:min-h-[var(--control-h-sm)]">
            {uploading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
            {uploading ? '正在加入媒体库…' : artifact ? `更换${label}` : `选择并上传${label}`}
            <input id={id} type="file" accept={accept ?? 'image/png,image/jpeg,image/webp,image/gif,image/avif'} className="sr-only" disabled={disabled || uploading} onChange={(event) => { onSelect(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{hint} 浏览器不会发送 Base64。</p>
        </div>
        {artifact && (
          <IconButton icon={X} label={`移除${label}`} size="sm" variant="danger-ghost" onClick={onRemove} className="self-start" />
        )}
      </div>
    </div>
  );
}
