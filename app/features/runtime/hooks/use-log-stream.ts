'use client';

import { useEffect, useRef, useState } from 'react';
import type { LogEvent } from '@sthstart/contracts';
import { ensureAdminSession } from '@/app/lib/admin-fetch';
import { fetchLogs } from '../api';

const MAX_LOGS = 2000;

export function useLogStream(initialLimit = 500) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const bufferRef = useRef<LogEvent[]>([]);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let active = true;

    // Load initial logs
    fetchLogs(initialLimit)
      .then((res) => {
        if (active) {
          bufferRef.current = res.items.slice(-MAX_LOGS);
          setLogs([...bufferRef.current]);
        }
      })
      .catch(() => undefined);

    let source: EventSource | null = null;

    void ensureAdminSession().then(() => {
      if (!active) return;
      source = new EventSource('/api/admin/logs/stream');
      source.onopen = () => setConnected(true);
      source.onerror = () => setConnected(false);
      source.onmessage = (message) => {
        try {
          const item = JSON.parse(message.data) as LogEvent;
          bufferRef.current.push(item);
          if (bufferRef.current.length > MAX_LOGS) {
            bufferRef.current = bufferRef.current.slice(-MAX_LOGS);
          }
          if (!pausedRef.current) {
            setLogs([...bufferRef.current]);
          }
        } catch {
          // ignore malformed SSE line
        }
      };
    });

    return () => {
      active = false;
      source?.close();
    };
  }, [initialLimit]);

  const togglePause = () => {
    setPaused((prev) => {
      const next = !prev;
      if (!next) {
        // Unpaused: flush accumulated logs
        setLogs([...bufferRef.current]);
      }
      return next;
    });
  };

  const clearLogs = () => {
    bufferRef.current = [];
    setLogs([]);
  };

  return {
    logs,
    paused,
    connected,
    togglePause,
    clearLogs,
  };
}
