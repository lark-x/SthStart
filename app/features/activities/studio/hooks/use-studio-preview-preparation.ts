'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';
import type { Activity, ContentDocument } from '@sthstart/contracts';
import { useCommitDraft } from '../../mutations/activities';
import { sameDocument } from '../model/document-equality';
import type { StudioDraftController } from '../model/draft-controller';

export interface ActivityStudioSnapshot {
  activity: Activity;
  draft: { document: ContentDocument; draftVersion: number };
  currentContentRevision?: { document: ContentDocument } | null;
}

export interface DraftSnapshot {
  draft: { document: ContentDocument; draftVersion: number };
}

export interface StudioPreviewPreparationOptions {
  activityId: string;
  draft: StudioDraftController;
  mediaFlushRef: RefObject<(() => Promise<boolean>) | null>;
  refetchActivity: () => Promise<{ data?: ActivityStudioSnapshot }>;
  refetchDraft: () => Promise<{ data?: DraftSnapshot }>;
}

/** 试演/导出前的草稿落版本；内容未变化时不新增正式版本。 */
export function useStudioPreviewPreparation({
  activityId,
  draft,
  mediaFlushRef,
  refetchActivity,
  refetchDraft,
}: StudioPreviewPreparationOptions) {
  const [prepareStatus, setPrepareStatus] = useState<'idle' | 'preparing' | 'ready' | 'error'>('idle');
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const preparing = useRef<Promise<boolean> | null>(null);
  const commitDraftMutation = useCommitDraft();

  const prepareContent = useCallback(() => {
    if (preparing.current) return preparing.current;
    setPrepareStatus('preparing');
    setPrepareError(null);
    const run = (async () => {
      try {
        if (mediaFlushRef.current && !await mediaFlushRef.current()) throw new Error('素材修改尚未保存，请先处理素材页的提示。');
        if (!await draft.flush()) throw new Error('草稿尚未保存，请先处理页头下方的保存提示。');
        const latest = await refetchActivity();
        if (!latest.data) throw new Error('无法读取活动，请重试。');
        if (sameDocument(latest.data.currentContentRevision?.document, latest.data.draft.document)) return true;
        await commitDraftMutation.mutateAsync({
          id: activityId,
          expectedHeadVersion: latest.data.activity.headVersion,
          expectedDraftVersion: draft.version(),
        });
        // 提交后服务端草稿版本号会重置；同步过来，后续自动保存才不会误报冲突。
        const fresh = await refetchDraft();
        if (fresh.data?.draft) draft.resolve(fresh.data.draft, !draft.isClean());
        await refetchActivity();
        return true;
      } catch (error) {
        setPrepareError(error instanceof Error ? error.message : '准备试演内容失败');
        return false;
      }
    })().then((ok) => {
      setPrepareStatus(ok ? 'ready' : 'error');
      return ok;
    }).finally(() => { preparing.current = null; });
    preparing.current = run;
    return run;
  }, [activityId, commitDraftMutation, draft, mediaFlushRef, refetchActivity, refetchDraft]);

  return { prepareStatus, prepareError, prepareContent };
}
