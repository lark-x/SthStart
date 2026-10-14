import type { GenerationProgress } from '@sthstart/contracts';
import WebSocket from 'ws';

export interface ProgressSocket {
  addEventListener(event: 'message' | 'error' | 'close', listener: (event: { data?: unknown; type?: string }) => void): unknown;
  close(): unknown;
}

/** One client per local task. Events only observe; history remains authoritative. */
export function watchComfyProgress(input: {
  baseUrl: string; clientId: string; promptId: string; headers?: Record<string, string>;
  onProgress(progress: GenerationProgress): void;
  active(): boolean;
  connect?: (url: string, headers?: Record<string, string>) => ProgressSocket;
}) {
  let socket: ProgressSocket | undefined;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnects = 0;
  let currentPrompt: string | null = null;
  let last = '';
  const publish = (progress: GenerationProgress) => {
    if (closed || !input.active()) return;
    const next = JSON.stringify(progress);
    if (next !== last) { last = next; input.onProgress(progress); }
  };
  const open = () => {
    if (closed || !input.active()) return;
    try {
      const url = new URL('/ws', `${input.baseUrl.replace(/\/+$/, '')}/`);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('clientId', input.clientId);
      const connection = input.connect ? input.connect(url.href, input.headers) : new WebSocket(url.href, { headers: input.headers });
      socket = connection;
      connection.addEventListener('message', (event: { data?: unknown }) => {
        try {
          const message = JSON.parse(String(event.data));
          const data = message.data ?? {};
          if (data.prompt_id) {
            currentPrompt = String(data.prompt_id);
            if (currentPrompt !== input.promptId) return;
          } else if (currentPrompt !== input.promptId) return;
          const source = 'comfyui-ws';
          if (message.type === 'progress') {
            const current = Number(data.value), total = Number(data.max);
            if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
            publish({ value: Math.min(1, Math.max(0, current / total)), current, total, stage: 'sampling', source });
          } else if (message.type === 'execution_start') publish({ value: null, stage: 'running', source });
          else if (message.type === 'execution_cached') publish({ value: null, stage: 'cached', source });
          else if (message.type === 'executing') publish({ value: null, stage: data.node == null ? 'collecting' : `node:${String(data.node).slice(0, 80)}`, source });
          else if (message.type === 'execution_success') publish({ value: null, stage: 'collecting', source });
          else if (message.type === 'execution_error' || message.type === 'execution_interrupted') publish({ value: null, stage: 'error', source });
        } catch { /* Malformed events never interrupt history polling. */ }
      });
      connection.addEventListener('error', () => {});
      connection.addEventListener('close', () => {
        currentPrompt = null;
        if (!closed && input.active() && reconnects++ < 3) {
          reconnectTimer = setTimeout(open, Math.min(5000, 500 * 2 ** reconnects));
          reconnectTimer.unref();
        }
      });
    } catch { /* HTTP polling still runs when WebSocket is unavailable. */ }
  };
  open();
  return () => { closed = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); };
}
