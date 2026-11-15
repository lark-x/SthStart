'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { CreativeNote } from '@sthstart/contracts';
import { useToast } from '@/app/providers/ui-provider';
import { notebookKeys } from '@/app/lib/query-keys';
import { markLocalNoteDeleted } from '../local-store';
import { syncPendingNotebookData } from '../sync';

export interface NoteDeletionOptions {
  effectiveNoteId: string;
  note: CreativeNote;
  online: boolean;
  standalone: boolean;
  onDeleted?: () => void;
  markClean: () => void;
}

export function useNoteDeletion({
  effectiveNoteId,
  note,
  online,
  standalone,
  onDeleted,
  markClean,
}: NoteDeletionOptions) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback(async () => {
    if (!effectiveNoteId || !window.confirm('确定删除此条笔记及其本地图片素材吗？')) return;
    try {
      await markLocalNoteDeleted(effectiveNoteId, { ...note, id: effectiveNoteId });
      markClean();
      queryClient.removeQueries({ queryKey: notebookKeys.detail(effectiveNoteId) });
      queryClient.setQueriesData<{ items: CreativeNote[] }>({ queryKey: [...notebookKeys.all, 'list'] }, (current) =>
        current ? { ...current, items: current.items.filter((item) => item.id !== effectiveNoteId) } : current);
      void syncPendingNotebookData(queryClient, { force: true, noteId: effectiveNoteId });
      toast.success('已从本机移除', online ? '正在后台同步删除。' : '联网后会自动同步删除。');
      // 嵌入工作台时删除后交回父组件清除选中态；router.push 会整页跳走，
      // 工作台的筛选与列表状态全部丢失。
      if (!standalone && onDeleted) onDeleted();
      else router.push('/apps/notebook');
    } catch (err) {
      toast.error('删除失败', err instanceof Error ? err.message : String(err));
    }
  }, [effectiveNoteId, markClean, note, online, onDeleted, queryClient, router, standalone, toast]);
}
