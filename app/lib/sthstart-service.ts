import type { AppDescriptor } from '@sthstart/contracts';

export const serviceUrl = (process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
export const fallbackLinsheUrl = (process.env.NEXT_PUBLIC_LINSHE_APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

export async function getLinshe(): Promise<AppDescriptor> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${serviceUrl}/api/v1/apps/linshe`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Service returned ${response.status}`);
    return await response.json() as AppDescriptor;
  } finally {
    window.clearTimeout(timeout);
  }
}
