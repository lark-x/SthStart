'use client';

import {
  useCallback, useMemo, useState,
  type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject,
} from 'react';
import { completeDialogue, findMentionTrigger } from '../model/story-editor-text';

export interface CastMember {
  id?: string;
  name: string;
  avatarUrl?: string | null;
  work?: string | null;
  notes?: string;
}

export function useStoryMentionPicker({
  body, castList, bodyRef, updateBody,
}: {
  body: string;
  castList: CastMember[];
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  updateBody: (next: { body: string }) => void;
}) {
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionAnchor, setMentionAnchor] = useState<number | null>(null);

  const filteredCast = useMemo(() => {
    if (!mentionActive) return [];
    const query = mentionQuery.trim().toLowerCase();
    if (!query) return castList;
    return castList.filter((member) => member.name.toLowerCase().includes(query) || (member.work && member.work.toLowerCase().includes(query)));
  }, [castList, mentionActive, mentionQuery]);

  const closeMention = useCallback(() => {
    setMentionActive(false);
    setMentionAnchor(null);
  }, []);

  const completeCharacterDialogue = useCallback((name: string) => {
    const textarea = bodyRef.current;
    if (!textarea || mentionAnchor === null) return;
    const next = completeDialogue(body, mentionAnchor, textarea.selectionStart, name);
    updateBody({ body: next.body });
    setMentionActive(false);
    setMentionAnchor(null);
    setMentionQuery('');
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  }, [body, bodyRef, mentionAnchor, updateBody]);

  const handleBodyChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const caret = event.target.selectionStart;
    updateBody({ body: value });
    const trigger = findMentionTrigger(value, caret);
    if (trigger) {
      setMentionActive(true);
      setMentionAnchor(trigger.anchor);
      setMentionQuery(trigger.query);
      setMentionIndex(0);
      return;
    }
    if (mentionActive) closeMention();
  }, [closeMention, mentionActive, updateBody]);

  /** Returns true when the mention popover consumed the key. */
  const handleMentionKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionActive) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMention();
      return true;
    }
    if (!filteredCast.length) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIndex((previous) => (previous + 1) % filteredCast.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIndex((previous) => (previous - 1 + filteredCast.length) % filteredCast.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (event.nativeEvent?.isComposing || event.keyCode === 229) {
        return false;
      }
      event.preventDefault();
      const picked = filteredCast[mentionIndex];
      if (picked) completeCharacterDialogue(picked.name);
      return true;
    }
    return false;
  }, [closeMention, completeCharacterDialogue, filteredCast, mentionActive, mentionIndex]);

  return {
    filteredCast, mentionIndex, setMentionIndex, handleBodyChange, handleMentionKeyDown, completeCharacterDialogue,
  };
}
