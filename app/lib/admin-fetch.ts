'use client';

let csrfToken = '';
let sessionPromise: Promise<void> | null = null;

async function fetchAdminSession() {
  let response = await fetch('/api/auth/admin-session', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) response = await fetch('/api/auth/admin-session', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('管理会话不可用');
  const payload = await response.json() as { csrfToken?: string };
  if (!payload.csrfToken) throw new Error('管理会话验证失败');
  csrfToken = payload.csrfToken;
}

export async function ensureAdminSession() {
  if (csrfToken) return;
  sessionPromise ??= fetchAdminSession().finally(() => { sessionPromise = null; });
  await sessionPromise;
}

async function refreshAdminSession(usedToken: string) {
  if (csrfToken && csrfToken !== usedToken) return csrfToken;
  if (!sessionPromise) {
    csrfToken = '';
    sessionPromise = fetchAdminSession().finally(() => { sessionPromise = null; });
  }
  await sessionPromise;
  return csrfToken;
}

async function hasInvalidCsrf(response: Response) {
  if (response.status !== 403) return false;
  try {
    const payload = await response.clone().json() as { error?: unknown };
    return payload?.error === 'invalid_csrf';
  } catch {
    return false;
  }
}

function canReplayBody(body: RequestInit['body']) {
  if (body === null || body === undefined) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
  if (typeof body === 'object') {
    if (typeof (body as { getReader?: unknown }).getReader === 'function') return false;
    if (Symbol.asyncIterator in body) return false;
  }
  return true;
}

export async function adminFetch(path: string, init: RequestInit = {}) {
  await ensureAdminSession();
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const usedToken = csrfToken;
  if (mutation) headers.set('x-sthstart-csrf', usedToken);
  const url = path.startsWith('/api/admin/') ? path : `/api/admin/${path.replace(/^\//, '')}`;
  let response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  if (response.status !== 401 && !(await hasInvalidCsrf(response))) return response;
  if (!canReplayBody(init.body)) return response;
  const retryToken = await refreshAdminSession(usedToken);
  const retryHeaders = new Headers(init.headers);
  if (mutation) retryHeaders.set('x-sthstart-csrf', retryToken);
  response = await fetch(url, { ...init, headers: retryHeaders, credentials: 'same-origin' });
  return response;
}
