'use client';
import { useState } from 'react';
import type { Topic } from '@sthstart/contracts';

/** Store summaries with the selection so changing pages never hides selected items. */
export function useTopicSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const [cache, setCache] = useState<Record<string, Topic>>({});
  const toggleSelected = (topic: Topic) => {
    setCache(current => ({ ...current, [topic.id]: topic }));
    setSelected(current => current.includes(topic.id) ? current.filter(id => id !== topic.id) : current.length < 5 ? [...current, topic.id] : current);
  };
  return { selected, setSelected, selectedTopics: selected.flatMap(id => cache[id] ? [cache[id]] : []), toggleSelected };
}
