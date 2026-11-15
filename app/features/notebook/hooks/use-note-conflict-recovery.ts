'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { CreativeNote } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { generateId } from '@/app/lib/uuid';
import { ApiClientError } from '@/app/lib/api-client';
import { fetchNoteAssetBlob, fetchNoteDetail } from '../api';
import {
  addLocalAsset,
  localAssetId,
  preserveConflictCopy,
  removeLocalAsset,
  type LocalNoteRecord,
} from '../local-store';
import { syncPendingNotebookData } from '../sync';

export interface NoteConflictRecoveryOptions {
  effectiveNoteId: string;
  persistLocal: (quiet?: boolean) => Promise<LocalNoteRecord | null>;
  setNote: (note: CreativeNote) => void;
  markClean: () => void;
  updateNoteCaches: (note: CreativeNote) => void;
  setErrorMessage: (message: string) => void;
}

/** 冲突时先保留本机完整草稿，再载入服务端版本；自动同步不覆盖用户内容。 */
export function useNoteConflictRecovery({
  effectiveNoteId,
  persistLocal,
  setNote,
  markClean,
  updateNoteCaches,
  setErrorMessage,
}: NoteConflictRecoveryOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const resolvingRef = useRef(false);
  const [preservedCopyId, setPreservedCopyId] = useState<string | null>(null);

  const resolveConflict = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolvingConflict(true);
    const copiedAssets: string[] = [];
    let preserved = false;
    try {
      const saved = await persistLocal(true);
      if (!saved) return;
      let remote: CreativeNote | null;
      try { remote = await fetchNoteDetail(effectiveNoteId, AbortSignal.timeout(30_000)); }
      catch (error) {
        if (error instanceof ApiClientError && error.status === 404) remote = null;
        else throw error;
      }
      const copyId = generateId();
      const content: CreativeNote['content'] = [];
      for (const block of saved.note.content) {
        const match = block.type === 'image' ? block.src.match(/^\/api\/(?:v1\/)?admin\/notebook\/assets\/([A-Za-z0-9_-]+)$/) : null;
        if (block.type === 'image' && match) {
          const src = await addLocalAsset(copyId, await fetchNoteAssetBlob(match[1]), 'preserved-note-image');
          copiedAssets.push(localAssetId(src)!);
          content.push({ ...block, src });
        } else content.push(block);
      }
      const copy = await preserveConflictCopy(effectiveNoteId, saved.localVersion, copyId, remote, content);
      preserved = true;
      markClean();
      setPreservedCopyId(copy.id!);
      if (remote) { setNote(remote); updateNoteCaches(remote); }
      else router.replace(`/apps/notebook/${copy.id}`);
      void syncPendingNotebookData(queryClient, { force: true, noteId: copy.id });
      toast.success('本机草稿已另存为副本', remote ? '当前页面已载入服务端版本。' : '原笔记已删除，已打开本机副本。');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (!preserved) await Promise.allSettled(copiedAssets.map((id) => removeLocalAsset(id)));
      resolvingRef.current = false;
      setResolvingConflict(false);
    }
  }, [effectiveNoteId, markClean, persistLocal, queryClient, router, setErrorMessage, setNote, toast, updateNoteCaches]);

  return { resolvingConflict, preservedCopyId, resolveConflict };
}
