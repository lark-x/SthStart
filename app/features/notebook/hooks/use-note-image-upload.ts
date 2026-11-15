'use client';

import { useEffect, useRef, type ChangeEvent, type RefObject } from 'react';
import type { NoteBlock } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { generateId } from '@/app/lib/uuid';
import { addLocalAsset, localAssetId, removeLocalAsset } from '../local-store';

export function useNoteImageUpload({
  effectiveNoteId,
  online,
  imageAnchorRef,
  insertBlock,
}: {
  effectiveNoteId: string;
  online: boolean;
  imageAnchorRef: RefObject<string | null>;
  insertBlock: (block: NoteBlock, after: string | null) => void;
}) {
  const toast = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return async (event: ChangeEvent<HTMLInputElement>) => {
    const after = imageAnchorRef.current;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片过大', '单张图片大小不能超过 8MB');
      return;
    }

    if (!effectiveNoteId) return;

    try {
      const localUrl = await addLocalAsset(effectiveNoteId, file, file.name);
      if (!mountedRef.current) {
        await removeLocalAsset(localAssetId(localUrl)!);
        return;
      }
      insertBlock({ id: generateId(), type: 'image', src: localUrl, caption: '' }, after);
      toast.success('图片已保存到本机', online ? '将由后台上传。' : '联网后会自动上传。');
    } catch (err) {
      const message = err instanceof Error && err.message === 'local_asset_quota_exceeded'
        ? '待同步图片已达到 100MB，请先联网完成同步。'
        : err instanceof Error ? err.message : String(err);
      toast.error('图片保存失败', message);
    }
  };
}
