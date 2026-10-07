// SERVER-ONLY. The app's database via Drizzle ORM. Call getDb() inside server function handlers.
// - In MonstarX previews the queries go to MonstarX's data proxy (this project's own database).
// - On Cloudflare Workers the D1 binding named DB is used directly.
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy'
import * as schema from '../db/schema'

export type AppDb = BaseSQLiteDatabase<'async', unknown, typeof schema>

let cached: Promise<AppDb> | null = null

async function workersBinding(): Promise<unknown> {
  try {
    const specifier = 'cloudflare:workers'
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: Record<string, unknown> }
    return mod.env?.DB ?? null
  } catch {
    return null
  }
}

async function create(): Promise<AppDb> {
  const binding = await workersBinding()
  if (binding) {
    const { drizzle } = await import('drizzle-orm/d1')
    return drizzle(binding as never, { schema }) as unknown as AppDb
  }
  const url = process.env.MONSTARX_DATA_URL
  const token = process.env.MONSTARX_DATA_TOKEN
  if (!url || !token) {
    throw new Error(
      process.env.MONSTARX_DATA_UNAVAILABLE ??
        'The database is not configured. MonstarX previews set MONSTARX_DATA_URL and MONSTARX_DATA_TOKEN automatically; on Cloudflare add a D1 binding named DB.',
    )
  }
  return drizzleProxy(
    async (sql, params, method) => {
      const response = await fetch(`${url}/query`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql, params, method }),
      })
      const data = (await response.json().catch(() => ({}))) as { rows?: unknown; error?: string }
      if (!response.ok) throw new Error(data.error ?? `Database request failed (${response.status})`)
      return { rows: data.rows as never }
    },
    { schema },
  ) as unknown as AppDb
}

/** The app's database. Server functions only. */
export function getDb(): Promise<AppDb> {
  cached ??= create().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}
