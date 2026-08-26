import { adminFetch, ensureAdminSession } from './admin-fetch';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: string[];
  readonly requestId?: string | null;

  constructor(message: string, options: { status: number; code?: string; details?: string[]; requestId?: string | null }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export function validateResponse<T>(value: unknown, schema: TSchema, path: string): T {
  if (!Value.Check(schema, value)) {
    throw new ApiClientError(`服务端响应格式无效：${path}`, {
      status: 502,
      code: 'invalid_response_schema',
    });
  }
  return value as T;
}

async function parseResponse<T>(response: Response, schema?: TSchema): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const requestId = response.headers.get('x-request-id');
  let data: unknown = null;

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }
  }

  if (!response.ok) {
    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const message =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      `HTTP ${response.status}`;
    const details = Array.isArray(payload.details) ? (payload.details as string[]) : undefined;
    const code = typeof payload.code === 'string' ? payload.code : (typeof payload.error === 'string' ? payload.error : undefined);

    throw new ApiClientError(message, {
      status: response.status,
      code,
      details,
      requestId,
    });
  }

  return schema ? validateResponse<T>(data, schema, response.url) : (data as T);
}

export async function getJson<T>(path: string, init?: RequestInit, schema?: TSchema): Promise<T> {
  const response = await adminFetch(path, {
    method: 'GET',
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.headers,
    },
    cache: init?.cache ?? 'no-store',
  });
  return parseResponse<T>(response, schema);
}

export async function postJson<T, B = unknown>(
  path: string,
  body?: B,
  init?: RequestInit,
  schema?: TSchema
): Promise<T> {
  const response = await adminFetch(path, {
    method: 'POST',
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...init?.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  return parseResponse<T>(response, schema);
}

export async function putJson<T, B = unknown>(
  path: string,
  body?: B,
  init?: RequestInit,
  schema?: TSchema
): Promise<T> {
  const response = await adminFetch(path, {
    method: 'PUT',
    ...init,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...init?.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  return parseResponse<T>(response, schema);
}

export async function deleteJson<T>(path: string, init?: RequestInit, schema?: TSchema): Promise<T> {
  const response = await adminFetch(path, {
    method: 'DELETE',
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.headers,
    },
    cache: 'no-store',
  });
  return parseResponse<T>(response, schema);
}

export { adminFetch, ensureAdminSession };
