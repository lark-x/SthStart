'use client';

import { useEffect, useRef, useState } from 'react';
import type { ContentDocument } from '@sthstart/contracts';
import { saveDraft } from '@/app/features/activities/api/activities';
import {
  DraftSaveController,
  createSessionStorageAdapter,
  attachBeforeUnload,
} from '@/app/lib/drafts';
import { getEffectiveStageScenes, writeStageBeatMedia } from '../scene-beat-utils';

/** One writer per mounted editor. Refetches never replace pending input. */
export function useStudioDraft(id: string, incoming?: { document: ContentDocument; draftVersion: number }) {
  const [document, setDocument] = useState<ContentDocument | null>(null);
  const [status, setStatus] = useState<'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'>('saved');
  const [error, setError] = useState<string | null>(null);
  const controller = useRef(new DraftSaveController<ContentDocument>());
  const backupKey = `sthstart:activity-draft:${id}`;
  const storage = useRef(createSessionStorageAdapter<ContentDocument>(
    backupKey,
    (raw): raw is ContentDocument => {
      const candidate = raw as ContentDocument | null;
      return Boolean(candidate && candidate.schemaVersion === 1 && Array.isArray(candidate.stages));
    }
  ));

  useEffect(() => {
    storage.current = createSessionStorageAdapter<ContentDocument>(
      backupKey,
      (raw): raw is ContentDocument => {
        const candidate = raw as ContentDocument | null;
        return Boolean(candidate && candidate.schemaVersion === 1 && Array.isArray(candidate.stages));
      }
    );
  }, [backupKey]);

  useEffect(() => {
    const ctrl = controller.current;
    if (!incoming || ctrl.dirty || ctrl.saving) return;
    ctrl.document = incoming.document;
    ctrl.version = incoming.draftVersion;
    setDocument(incoming.document);
    try {
      const recovered = storage.current.get();
      if (recovered && JSON.stringify(recovered) !== JSON.stringify(incoming.document)) {
        ctrl.document = recovered;
        ctrl.dirty = true;
        ctrl.blocked = true;
        setDocument(recovered);
        setStatus('conflict');
        setError('已找回离开前未保存的输入，请与服务器草稿比较后继续。');
      }
    } catch { /* unavailable device storage does not block editing */ }
  }, [incoming, backupKey]);

  function flush(): Promise<boolean> {
    const ctrl = controller.current;
    if (ctrl.blocked) return Promise.resolve(false);
    return ctrl.flush(
      async (snapshot, version) => {
        const result = await saveDraft(id, version, snapshot);
        return result.draftVersion;
      },
      (_err, conflict) => {
        setStatus(conflict ? 'conflict' : 'error');
        setError(conflict ? '服务器草稿已更新。你的输入仍保留在此页面。' : '保存失败，你的输入已保留。请重试。');
      },
      {
        onStart: () => {
          setStatus('saving');
          setError(null);
        },
        onSuccess: () => {
          storage.current.remove();
          setStatus('saved');
        },
      }
    );
  }

  function update(next: ContentDocument) {
    const ctrl = controller.current;
    ctrl.document = next;
    ctrl.dirty = true;
    setDocument(next);
    if (!ctrl.blocked) setStatus('unsaved');
    storage.current.set(next);
    ctrl.schedule(() => void flush(), 600);
  }

  function resolve(server: { document: ContentDocument; draftVersion: number }, keepLocal: boolean) {
    const ctrl = controller.current;
    ctrl.version = server.draftVersion;
    ctrl.unblock();
    setError(null);
    if (keepLocal && ctrl.document) {
      update(ctrl.document);
      return;
    }
    ctrl.document = server.document;
    ctrl.dirty = false;
    setDocument(server.document);
    setStatus('saved');
    storage.current.remove();
  }

  async function adoptBeatMedia(
    server: { document: ContentDocument; draftVersion: number },
    target: { stageId: string; sceneId: string; beatId: string }
  ) {
    // A media response can arrive while the author is still typing. Only merge its image.
    const ctrl = controller.current;
    if (ctrl.pendingPromise) await ctrl.pendingPromise;
    const current = ctrl.document;
    if (!current || server.draftVersion < ctrl.version) return;
    const stage = server.document.stages.find(item => item.id === target.stageId);
    const image = stage && getEffectiveStageScenes(stage, server.document.scenes).find(item => item.id === target.sceneId)?.beats.find(item => item.id === target.beatId)?.mediaUrl;
    if (!image) return;
    const merged = writeStageBeatMedia(current, target.stageId, target.sceneId, target.beatId, image);
    if (!merged) return;
    const dirty = ctrl.dirty;
    ctrl.version = server.draftVersion;
    if (dirty) {
      // The known media write accounts for this version; preserve subsequent authored edits.
      update(merged);
    } else {
      resolve(server, false);
    }
  }

  useEffect(() => {
    const current = controller.current;
    const detach = attachBeforeUnload(() => current.dirty);
    return () => { current.dispose(); detach(); };
  }, []);

  return {
    document,
    status,
    error,
    update,
    flush,
    resolve,
    adoptBeatMedia,
    version: () => controller.current.version,
    isClean: () => controller.current.isClean(),
    retry: () => {
      controller.current.unblock();
      void flush();
    },
  };
}
