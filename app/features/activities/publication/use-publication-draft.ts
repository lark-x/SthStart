'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Value } from '@sinclair/typebox/value';
import {
  PublicationDocumentSchema,
  type PublicationDocument,
  type PublicationDraft,
} from '@sthstart/contracts';
import {
  DraftSaveController,
  createLocalStorageAdapter,
  attachBeforeUnload,
} from '@/app/lib/drafts';
import { publicationApi } from './api';

export function usePublicationDraft(id: string, incoming?: PublicationDraft) {
  const controller = useRef(new DraftSaveController<PublicationDocument>());
  const recovered = useRef(false);
  const [document, setDocument] = useState<PublicationDocument | null>(null);
  const [status, setStatus] = useState('载入中');
  const [error, setError] = useState('');
  const key = `sthstart:publication-draft:${id}`;
  const storage = useRef(
    createLocalStorageAdapter<PublicationDocument>(key, (raw) =>
      Value.Check(PublicationDocumentSchema, raw)
    )
  );

  useEffect(() => {
    storage.current = createLocalStorageAdapter<PublicationDocument>(key, (raw) =>
      Value.Check(PublicationDocumentSchema, raw)
    );
  }, [key]);

  useEffect(() => {
    const ctrl = controller.current;
    if (!incoming || ctrl.dirty || ctrl.saving || ctrl.blocked) return;
    ctrl.document = incoming.document;
    ctrl.version = incoming.draftVersion;
    setDocument(incoming.document);
    setStatus('已保存');
    if (!recovered.current) {
      recovered.current = true;
      try {
        const local = storage.current.get();
        if (local && JSON.stringify(local) !== JSON.stringify(incoming.document)) {
          ctrl.document = local;
          ctrl.dirty = true;
          ctrl.blocked = true;
          setDocument(local);
          setStatus('待恢复');
          setError('已找回本机未同步内容。请先复制或检查服务器版本，再手动决定恢复。');
        }
      } catch {}
    }
  }, [incoming, key]);

  const flush = useCallback(async () => {
    const ctrl = controller.current;
    ctrl.cancelSchedule();
    if (ctrl.pendingPromise) return ctrl.pendingPromise;
    if (ctrl.blocked) return false;
    if (!ctrl.dirty) return true;
    let latest: PublicationDraft | null = null;
    return ctrl.flush(
      async (doc, version) => {
        latest = await publicationApi.save(id, version, doc);
        return latest.draftVersion;
      },
      (e, conflict) => {
        setStatus(conflict ? '版本冲突' : '仅保存在本机');
        setError(e instanceof Error ? e.message : '保存失败，本地输入保留。');
      },
      {
        onStart: () => {
          setStatus('保存中');
          setError('');
        },
        onSuccess: () => {
          if (!ctrl.dirty) {
            if (latest) {
              const result = latest as PublicationDraft;
              ctrl.document = result.document;
              setDocument(result.document);
            }
            setStatus('已保存');
            storage.current.remove();
          }
        },
      }
    );
  }, [id]);

  const update = (next: PublicationDocument) => {
    const ctrl = controller.current;
    ctrl.document = next;
    ctrl.dirty = true;
    setDocument(next);
    if (!ctrl.blocked) setStatus('未保存');
    const ok = storage.current.set(next);
    if (!ok) {
      setError('本机存储不可用，请保存或复制文本后再离开。');
    }
    ctrl.schedule(() => void flush(), 600);
  };

  const accept = (server: PublicationDraft) => {
    const ctrl = controller.current;
    if (ctrl.dirty || ctrl.saving) {
      setError('后台已更新图片或音频。当前文字输入保留，保存时会检查版本。');
      return;
    }
    ctrl.document = server.document;
    ctrl.version = server.draftVersion;
    setDocument(server.document);
  };

  const resolve = (server: PublicationDraft, keep: boolean) => {
    const ctrl = controller.current;
    ctrl.version = server.draftVersion;
    ctrl.unblock();
    setError('');
    if (keep && ctrl.document) {
      update(ctrl.document);
    } else {
      ctrl.document = server.document;
      ctrl.dirty = false;
      setDocument(server.document);
      setStatus('已保存');
      storage.current.remove();
    }
  };

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
    accept,
    resolve,
    version: () => controller.current.version,
    clean: () => controller.current.isClean(),
  };
}
