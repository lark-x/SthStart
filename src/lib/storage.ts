// SERVER-ONLY. File storage for this app (MonstarX's object storage, backed by Cloudflare R2).
// Keys under `public/` are served to anyone at storage.publicUrl(key); every other key is private
// and only readable through this app (GET /api/files/<key> for signed-in users, or storage.get()).
// Works the same in previews and published apps; nothing to configure.
export interface StoredFile {
  key: string
  size: number
  contentType: string
  /** Permanent URL: direct for public/ keys, /api/files/<key> otherwise. */
  url: string
}

export type FileBody = ArrayBuffer | ArrayBufferView | Blob | string

function endpoint(): { base: string; token: string } {
  const base = process.env.MONSTARX_STORAGE_URL
  const token = process.env.MONSTARX_DATA_TOKEN
  if (!base || !token) {
    throw new Error('File storage is only available while this app runs inside MonstarX (previews and published apps); set MONSTARX_STORAGE_URL and MONSTARX_DATA_TOKEN elsewhere.')
  }
  return { base: base.replace(/\/+$/, ''), token }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { base, token } = endpoint()
  const response = await fetch(`${base}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (!response.ok && response.status !== 404) {
    const data = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `Storage request failed (${response.status})`)
  }
  return response
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

function urlFor(key: string): string {
  if (key.startsWith('public/')) {
    const base = process.env.MONSTARX_STORAGE_URL?.replace(/\/+$/, '')
    if (base) return `${base}/public/${encodeKey(key.slice('public/'.length))}`
  }
  return `/api/files/${encodeKey(key)}`
}

export const storage = {
  /** Store a file. Use `public/...` keys for anything that may be linked from pages (images, downloads). */
  async put(key: string, body: FileBody, options: { contentType?: string } = {}): Promise<StoredFile> {
    const response = await call(`objects/${encodeKey(key)}`, {
      method: 'PUT',
      body: body as BodyInit,
      headers: { 'content-type': options.contentType ?? (body instanceof Blob && body.type ? body.type : 'application/octet-stream') },
    })
    const data = (await response.json()) as { key: string; size: number; contentType: string }
    return { key: data.key, size: data.size, contentType: data.contentType, url: urlFor(data.key) }
  },

  /** Read a file (null when it does not exist). */
  async get(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number } | null> {
    const response = await call(`objects/${encodeKey(key)}`)
    if (response.status === 404 || !response.body) return null
    return { body: response.body, contentType: response.headers.get('content-type') ?? 'application/octet-stream', size: Number(response.headers.get('content-length') ?? 0) }
  },

  async delete(key: string): Promise<void> {
    await call(`objects/${encodeKey(key)}`, { method: 'DELETE' })
  },

  /** Files whose key starts with `prefix` (up to 1000). */
  async list(prefix = ''): Promise<StoredFile[]> {
    const response = await call(`list?prefix=${encodeURIComponent(prefix)}&limit=1000`)
    const data = (await response.json()) as { objects: Array<{ key: string; size: number; contentType: string }> }
    return data.objects.map((object) => ({ ...object, url: urlFor(object.key) }))
  },

  /** The URL a stored key is served from (see the note on public/ keys above). */
  publicUrl(key: string): string {
    return urlFor(key)
  },
}
