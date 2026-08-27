'use client';

import { useEffect, useRef } from 'react';
import { adminFetch } from '@/app/lib/api-client';

type CreativeGenerationEvent = {
  id: number;
  taskId?: string;
  appId?: string;
  eventType?: string;
  payload: Record<string, unknown>;
};

function parseEvent(block: string, fallbackId: number): CreativeGenerationEvent | null {
  let id = fallbackId;
  let eventType = '';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('id:')) {
      const parsed = Number.parseInt(line.slice(3).trim(), 10);
      if (Number.isFinite(parsed)) id = parsed;
    } else if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (!data.length) return null;
  try {
    const payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
    return {
      id,
      taskId: typeof payload.taskId === 'string' ? payload.taskId : undefined,
      appId: typeof payload.appId === 'string' ? payload.appId : undefined,
      eventType: eventType || (typeof payload.eventType === 'string' ? payload.eventType : undefined),
      payload,
    };
  } catch {
    return null;
  }
}

export function useGenerationEvents(onEvent: (event: CreativeGenerationEvent) => void) {
  const callbackRef = useRef(onEvent);
  const lastEventId = useRef(0);

  useEffect(() => {
    callbackRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        const suffix = lastEventId.current ? `&after=${lastEventId.current}` : '';
        const response = await adminFetch(`generation/events?appId=creative-center${suffix}`, {
          headers: { accept: 'text/event-stream' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok || !response.body) throw new Error('generation_event_stream_unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const event = parseEvent(block, lastEventId.current);
            if (!event) continue;
            lastEventId.current = Math.max(lastEventId.current, event.id);
            callbackRef.current(event);
          }
        }
      } catch {
        if (active && !controller.signal.aborted) {
          reconnectTimer = setTimeout(() => { void connect(); }, 3000);
        }
      }
    };

    void connect();
    return () => {
      active = false;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);
}
