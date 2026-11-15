'use client';

import { useCallback, useRef, useState } from 'react';
import type { StoryCharacter, StoryDocument } from '@sthstart/contracts';
import { storyApi } from '../api';
import type { NewKind } from '../model/story-entry';

export function useStoryEntryCreation({
  projectId, flush, refreshEntries, onCreated,
}: {
  projectId: string;
  flush: () => Promise<boolean>;
  refreshEntries: () => Promise<unknown>;
  onCreated: (kind: NewKind, id: string) => void;
}) {
  const creationDrafts = useRef<Partial<Record<NewKind, { title: string; body: string }>>>({});
  const createLock = useRef(false);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<NewKind | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [createError, setCreateError] = useState('');

  const openCreate = useCallback((kind: NewKind) => {
    const saved = creationDrafts.current[kind];
    setNewKind(kind);
    setNewTitle(saved?.title ?? '');
    setNewBody(saved?.body ?? '');
    setCreateError('');
  }, []);

  const closeCreate = useCallback(() => {
    if (createLock.current) return;
    setNewKind(null);
    setCreateError('');
  }, []);

  const changeTitle = useCallback((value: string) => {
    setNewTitle(value);
    if (newKind) creationDrafts.current[newKind] = { title: value, body: newBody };
  }, [newBody, newKind]);

  const changeBody = useCallback((value: string) => {
    setNewBody(value);
    if (newKind) creationDrafts.current[newKind] = { title: newTitle, body: value };
  }, [newKind, newTitle]);

  const submit = useCallback(async () => {
    if (!newKind || !newTitle.trim() || createLock.current) return;
    const kind = newKind;
    createLock.current = true;
    setCreating(true);
    if (!await flush()) {
      setCreateError('请先解决当前条目的保存状态。');
      createLock.current = false;
      setCreating(false);
      return;
    }
    setCreateError('');
    try {
      let created: StoryDocument | StoryCharacter;
      if (kind === 'character') created = await storyApi.createCharacter(projectId, { name: newTitle.trim(), notes: newBody });
      else created = await storyApi.createDocument(projectId, { kind, title: newTitle.trim(), body: newBody });
      await refreshEntries();
      onCreated(kind, created.id);
      delete creationDrafts.current[kind];
      setNewKind(null);
      setNewTitle('');
      setNewBody('');
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : '创建失败。');
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  }, [flush, newBody, newKind, newTitle, onCreated, projectId, refreshEntries]);

  return {
    creation: { newKind, newTitle, newBody, creating, createError },
    openCreate, closeCreate, changeTitle, changeBody, submit,
  };
}
