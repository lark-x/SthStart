import { AppDescriptorSchema } from '@sthstart/contracts';
import type { AppDescriptor } from '@sthstart/contracts';
import { validateResponse } from './api-client';

export const fallbackLinsheUrl = (process.env.NEXT_PUBLIC_LINSHE_APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

export async function getLinshe(): Promise<AppDescriptor> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch('/api/apps/linshe', {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Service returned ${response.status}`);
    return validateResponse<AppDescriptor>(await response.json(), AppDescriptorSchema, '/api/apps/linshe');
  } finally {
    window.clearTimeout(timeout);
  }
}
