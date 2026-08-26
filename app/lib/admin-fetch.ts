'use client';

let csrfToken = '';
let sessionPromise: Promise<void> | null = null;

export async function ensureAdminSession() {
  if (csrfToken) return;
  sessionPromise ??= (async () => {
    let response = await fetch('/api/auth/admin-session', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) response = await fetch('/api/auth/admin-session', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('管理会话不可用');
    const verified = await fetch('/api/auth/admin-session', { cache: 'no-store', credentials: 'same-origin' });
    const payload = await verified.json() as { csrfToken?: string };
    if (!verified.ok || !payload.csrfToken) throw new Error('管理会话验证失败');
    csrfToken = payload.csrfToken;
  })().finally(() => { sessionPromise = null; });
  await sessionPromise;
}

export async function adminFetch(path: string, init: RequestInit = {}) {
  await ensureAdminSession();
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-sthstart-csrf', csrfToken);
  const url = path.startsWith('/api/admin/') ? path : `/api/admin/${path.replace(/^\//, '')}`;
  let response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    csrfToken = '';
    await ensureAdminSession();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('x-sthstart-csrf', csrfToken);
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  }
  return response;
}
