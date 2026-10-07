// SERVER-ONLY. This app's own Cloudflare account: KV, R2, Queues, Vectorize, Workers AI, Browser
// Rendering, Images and Analytics Engine, plus `cloudflare.api()` for anything else Cloudflare
// offers. Available once the owner connects Cloudflare in Backend → Cloud; each service is added
// from the chat ("use a KV store called sessions") and is then ready in previews and published apps
// alike. Call these inside server function handlers or server routes — never in a component.
//
// Published on the owner's Cloudflare account, every call goes through the real Worker binding.
// In a preview there are no bindings, so the same calls go to Cloudflare's REST API with the
// owner's token. The code you write is the same either way.

export interface CloudflareResourceRef {
  id: string | null
  account: string
  binding: string
}

type ResourceMap = Partial<Record<string, Record<string, CloudflareResourceRef>>>

const API = 'https://api.cloudflare.com/client/v4'

function config(): { accountId: string; token: string; resources: ResourceMap } {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountId || !token) {
    throw new Error('Cloudflare is not connected yet. Open Backend → Cloud and connect a Cloudflare account; everything that uses it starts working straight away.')
  }
  let resources: ResourceMap = {}
  try {
    resources = JSON.parse(process.env.MONSTARX_CF_RESOURCES ?? '{}') as ResourceMap
  } catch {
    resources = {}
  }
  return { accountId, token, resources }
}

function resource(kind: string, name: string | null, label: string): CloudflareResourceRef {
  const { resources } = config()
  const found = resources[kind]?.[name ?? '']
  if (!found) {
    throw new Error(`${label} is not set up for this app yet. Ask MonstarX in the chat to add it — it creates it on the connected Cloudflare account and it works here immediately.`)
  }
  return found
}

/** The Worker binding of a service, when this code runs on Cloudflare. Null in a preview. */
async function binding<T>(name: string): Promise<T | null> {
  try {
    const specifier = 'cloudflare:workers'
    const mod = (await import(/* @vite-ignore */ specifier)) as { env?: Record<string, unknown> }
    return (mod.env?.[name] as T) ?? null
  } catch {
    return null
  }
}

interface Envelope<T> {
  success?: boolean
  result?: T
  errors?: Array<{ code?: number; message?: string }>
}

async function request(method: string, path: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const { token } = config()
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...(init.headers ?? {}) }
  let body = init.body
  if (init.json !== undefined) {
    body = JSON.stringify(init.json)
    headers['content-type'] = 'application/json'
  }
  return fetch(`${API}${path}`, { method, headers, body })
}

/** Unwrap Cloudflare's `{ success, result, errors }` envelope, turning a refusal into a real error. */
async function unwrap<T>(response: Response, what: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as Envelope<T> | null
  if (!response.ok || data?.success === false) {
    const message = data?.errors?.map((entry) => entry.message).filter(Boolean).join('; ') || `HTTP ${response.status}`
    throw new Error(`Cloudflare ${what} failed: ${message}`)
  }
  return data?.result as T
}

async function call<T>(method: string, path: string, init: Parameters<typeof request>[2] = {}, what = 'request'): Promise<T> {
  return unwrap<T>(await request(method, path, init), what)
}

const encodePathKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/')

function toBytes(body: unknown): BodyInit {
  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof Blob) return body as BodyInit
  return JSON.stringify(body)
}

// ───────────────────────────── KV ─────────────────────────────

export interface KvListed {
  name: string
  expiration?: number
  metadata?: unknown
}

export interface KvNamespace {
  /** The stored text, or null when the key is not there. */
  get(key: string): Promise<string | null>
  /** The stored value parsed as JSON, or null. */
  getJson<T>(key: string): Promise<T | null>
  put(key: string, value: unknown, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ keys: KvListed[]; cursor: string | null }>
}

function kv(name: string): KvNamespace {
  const ref = () => resource('kv', name, `The KV store "${name}"`)
  const base = () => `/accounts/${config().accountId}/storage/kv/namespaces/${ref().id}`
  return {
    async get(key) {
      const live = await binding<{ get(key: string, type?: 'text'): Promise<string | null> }>(ref().binding)
      if (live) return live.get(key)
      const response = await request('GET', `${base()}/values/${encodePathKey(key)}`)
      if (response.status === 404) return null
      if (!response.ok) return unwrap<string>(response, 'KV read')
      return response.text()
    },
    async getJson<T>(key: string) {
      const text = await this.get(key)
      if (text === null) return null
      try {
        return JSON.parse(text) as T
      } catch {
        return null
      }
    },
    async put(key, value, options = {}) {
      const body = toBytes(value)
      const live = await binding<{ put(key: string, value: unknown, options?: Record<string, unknown>): Promise<void> }>(ref().binding)
      if (live) {
        await live.put(key, body, { ...(options.expirationTtl ? { expirationTtl: options.expirationTtl } : {}), ...(options.metadata ? { metadata: options.metadata } : {}) })
        return
      }
      // Over REST, expiry is a query parameter and metadata turns the body into a multipart form.
      const query = options.expirationTtl ? `?expiration_ttl=${Math.max(60, Math.floor(options.expirationTtl))}` : ''
      if (options.metadata) {
        const form = new FormData()
        form.set('value', new Blob([body as BlobPart]))
        form.set('metadata', JSON.stringify(options.metadata))
        await call('PUT', `${base()}/values/${encodePathKey(key)}${query}`, { body: form }, 'KV write')
        return
      }
      await call('PUT', `${base()}/values/${encodePathKey(key)}${query}`, { body, headers: { 'content-type': 'application/octet-stream' } }, 'KV write')
    },
    async delete(key) {
      const live = await binding<{ delete(key: string): Promise<void> }>(ref().binding)
      if (live) return live.delete(key)
      await call('DELETE', `${base()}/values/${encodePathKey(key)}`, {}, 'KV delete')
    },
    async list(options = {}) {
      const live = await binding<{ list(options: Record<string, unknown>): Promise<{ keys: KvListed[]; cursor?: string }> }>(ref().binding)
      if (live) {
        const result = await live.list({ prefix: options.prefix, limit: options.limit, cursor: options.cursor })
        return { keys: result.keys, cursor: result.cursor ?? null }
      }
      const query = new URLSearchParams()
      if (options.prefix) query.set('prefix', options.prefix)
      if (options.limit) query.set('limit', String(Math.min(1000, Math.max(10, options.limit))))
      if (options.cursor) query.set('cursor', options.cursor)
      const search = query.toString()
      const response = await request('GET', `${base()}/keys${search ? `?${search}` : ''}`)
      const data = (await response.json().catch(() => null)) as (Envelope<KvListed[]> & { result_info?: { cursor?: string } }) | null
      if (!response.ok || data?.success === false) throw new Error(`Cloudflare KV list failed: ${data?.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`}`)
      return { keys: data?.result ?? [], cursor: data?.result_info?.cursor || null }
    },
  }
}

// ───────────────────────────── R2 ─────────────────────────────

export interface R2Object {
  key: string
  size: number
  uploaded?: string
}

export interface R2Bucket {
  put(key: string, body: unknown, options?: { contentType?: string }): Promise<void>
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number } | null>
  /** The object as text, or null when it is not there. */
  text(key: string): Promise<string | null>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{ objects: R2Object[]; cursor: string | null }>
}

function r2(name: string): R2Bucket {
  const ref = () => resource('r2', name, `The R2 bucket "${name}"`)
  // Object keys keep their slashes: Cloudflare takes the key as a path, not as one escaped segment.
  const objectPath = (key: string) => `/accounts/${config().accountId}/r2/buckets/${encodeURIComponent(ref().account)}/objects/${encodePathKey(key)}`
  return {
    async put(key, body, options = {}) {
      const bytes = toBytes(body)
      const live = await binding<{ put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown> }>(ref().binding)
      if (live) {
        await live.put(key, bytes, options.contentType ? { httpMetadata: { contentType: options.contentType } } : undefined)
        return
      }
      await call('PUT', objectPath(key), { body: bytes, headers: { 'content-type': options.contentType ?? 'application/octet-stream' } }, 'R2 upload')
    },
    async get(key) {
      const live = await binding<{ get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number; httpMetadata?: { contentType?: string } } | null> }>(ref().binding)
      if (live) {
        const object = await live.get(key)
        return object ? { body: object.body, contentType: object.httpMetadata?.contentType ?? 'application/octet-stream', size: object.size } : null
      }
      const response = await request('GET', objectPath(key))
      if (response.status === 404) return null
      if (!response.ok || !response.body) return unwrap(response, 'R2 read')
      return { body: response.body, contentType: response.headers.get('content-type') ?? 'application/octet-stream', size: Number(response.headers.get('content-length') ?? 0) }
    },
    async text(key) {
      const object = await this.get(key)
      return object ? new Response(object.body).text() : null
    },
    async delete(key) {
      const live = await binding<{ delete(key: string): Promise<void> }>(ref().binding)
      if (live) return live.delete(key)
      await call('DELETE', objectPath(key), {}, 'R2 delete')
    },
    async list(options = {}) {
      const live = await binding<{ list(options: Record<string, unknown>): Promise<{ objects: Array<{ key: string; size: number; uploaded?: Date }>; truncated: boolean; cursor?: string }> }>(ref().binding)
      if (live) {
        const result = await live.list({ prefix: options.prefix, limit: options.limit, cursor: options.cursor })
        return { objects: result.objects.map((object) => ({ key: object.key, size: object.size, uploaded: object.uploaded?.toISOString() })), cursor: result.truncated ? (result.cursor ?? null) : null }
      }
      const query = new URLSearchParams()
      if (options.prefix) query.set('prefix', options.prefix)
      if (options.limit) query.set('per_page', String(Math.min(1000, Math.max(1, options.limit))))
      if (options.cursor) query.set('cursor', options.cursor)
      const search = query.toString()
      const response = await request('GET', `/accounts/${config().accountId}/r2/buckets/${encodeURIComponent(ref().account)}/objects${search ? `?${search}` : ''}`)
      const data = (await response.json().catch(() => null)) as (Envelope<R2Object[]> & { result_info?: { cursor?: string; is_truncated?: boolean } }) | null
      if (!response.ok || data?.success === false) throw new Error(`Cloudflare R2 list failed: ${data?.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`}`)
      return { objects: data?.result ?? [], cursor: data?.result_info?.is_truncated ? (data.result_info.cursor ?? null) : null }
    },
  }
}

// ──────────────────────────── Queues ────────────────────────────

export interface Queue {
  send(body: unknown, options?: { delaySeconds?: number }): Promise<void>
  sendBatch(bodies: unknown[], options?: { delaySeconds?: number }): Promise<void>
}

function queue(name: string): Queue {
  const ref = () => resource('queue', name, `The queue "${name}"`)
  const messages = () => `/accounts/${config().accountId}/queues/${ref().id}/messages`
  const shape = (body: unknown) => (typeof body === 'string' ? { body, content_type: 'text' } : { body, content_type: 'json' })
  return {
    async send(body, options = {}) {
      const live = await binding<{ send(body: unknown, options?: Record<string, unknown>): Promise<void> }>(ref().binding)
      if (live) return live.send(body, options.delaySeconds ? { delaySeconds: options.delaySeconds } : undefined)
      await call('POST', messages(), { json: { ...shape(body), ...(options.delaySeconds ? { delay_seconds: options.delaySeconds } : {}) } }, 'queue send')
    },
    async sendBatch(bodies, options = {}) {
      if (!bodies.length) return
      const live = await binding<{ sendBatch(messages: Array<{ body: unknown }>, options?: Record<string, unknown>): Promise<void> }>(ref().binding)
      if (live) return live.sendBatch(bodies.map((body) => ({ body })), options.delaySeconds ? { delaySeconds: options.delaySeconds } : undefined)
      await call('POST', `${messages()}/batch`, { json: { messages: bodies.map(shape), ...(options.delaySeconds ? { delay_seconds: options.delaySeconds } : {}) } }, 'queue send')
    },
  }
}

// ─────────────────────────── Vectorize ───────────────────────────

export interface VectorRecord {
  id: string
  values: number[]
  metadata?: Record<string, unknown>
  namespace?: string
}

export interface VectorMatch {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, unknown>
}

export interface VectorIndex {
  /** Add or replace vectors. Vectorize applies writes a moment later, so do not read straight back. */
  upsert(vectors: VectorRecord[]): Promise<void>
  query(values: number[], options?: { topK?: number; filter?: Record<string, unknown>; namespace?: string; returnMetadata?: boolean; returnValues?: boolean }): Promise<{ matches: VectorMatch[] }>
  getByIds(ids: string[]): Promise<VectorRecord[]>
  deleteByIds(ids: string[]): Promise<void>
}

function vectorize(name: string): VectorIndex {
  const ref = () => resource('vectorize', name, `The Vectorize index "${name}"`)
  const base = () => `/accounts/${config().accountId}/vectorize/v2/indexes/${encodeURIComponent(ref().account)}`
  return {
    async upsert(vectors) {
      if (!vectors.length) return
      const live = await binding<{ upsert(vectors: VectorRecord[]): Promise<unknown> }>(ref().binding)
      if (live) {
        await live.upsert(vectors)
        return
      }
      // Over REST a batch of vectors is newline-delimited JSON, one record per line.
      await call('POST', `${base()}/upsert`, { body: vectors.map((vector) => JSON.stringify(vector)).join('\n'), headers: { 'content-type': 'application/x-ndjson' } }, 'Vectorize upsert')
    },
    async query(values, options = {}) {
      const body = {
        vector: values,
        topK: options.topK ?? 5,
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.namespace ? { namespace: options.namespace } : {}),
        returnValues: options.returnValues ?? false,
        returnMetadata: options.returnMetadata === false ? 'none' : 'all',
      }
      const live = await binding<{ query(values: number[], options: Record<string, unknown>): Promise<{ matches: VectorMatch[] }> }>(ref().binding)
      if (live) return live.query(values, body)
      return call<{ matches: VectorMatch[] }>('POST', `${base()}/query`, { json: body }, 'Vectorize query')
    },
    async getByIds(ids) {
      if (!ids.length) return []
      const live = await binding<{ getByIds(ids: string[]): Promise<VectorRecord[]> }>(ref().binding)
      if (live) return live.getByIds(ids)
      return (await call<VectorRecord[]>('POST', `${base()}/get_by_ids`, { json: { ids } }, 'Vectorize read')) ?? []
    },
    async deleteByIds(ids) {
      if (!ids.length) return
      const live = await binding<{ deleteByIds(ids: string[]): Promise<unknown> }>(ref().binding)
      if (live) {
        await live.deleteByIds(ids)
        return
      }
      await call('POST', `${base()}/delete_by_ids`, { json: { ids } }, 'Vectorize delete')
    },
  }
}

// ─────────────────────────── Workers AI ───────────────────────────

export interface AiTextOptions {
  prompt?: string
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  system?: string
  maxTokens?: number
  temperature?: number
}

const ai = {
  /** Run any Workers AI model with its own input, and get its own output back. */
  async run<T = unknown>(model: string, input: Record<string, unknown>): Promise<T> {
    resource('ai', null, 'Workers AI')
    const live = await binding<{ run(model: string, input: Record<string, unknown>): Promise<T> }>('AI')
    if (live) return live.run(model, input)
    // Model names keep their @ and slashes: Cloudflare takes them as a path.
    return call<T>('POST', `/accounts/${config().accountId}/ai/run/${model}`, { json: input }, `Workers AI (${model})`)
  },

  /** Text generation as a plain string. */
  async text(model: string, options: AiTextOptions): Promise<string> {
    const messages = options.messages ?? (options.system ? [{ role: 'system' as const, content: options.system }, { role: 'user' as const, content: options.prompt ?? '' }] : undefined)
    const input: Record<string, unknown> = messages ? { messages } : { prompt: options.prompt ?? '' }
    if (options.maxTokens) input.max_tokens = options.maxTokens
    if (options.temperature !== undefined) input.temperature = options.temperature
    const result = await ai.run<{ response?: string }>(model, input)
    return result?.response ?? ''
  },

  /** Embeddings for one or more pieces of text, in the same order. */
  async embed(model: string, text: string[]): Promise<number[][]> {
    const result = await ai.run<{ data?: number[][] }>(model, { text })
    return result?.data ?? []
  },

  /**
   * Generate an image. Some models answer with base64 inside JSON and others with raw image bytes,
   * so both are handled and you always get bytes back.
   */
  async image(model: string, input: Record<string, unknown>): Promise<Uint8Array> {
    resource('ai', null, 'Workers AI')
    const live = await binding<{ run(model: string, input: Record<string, unknown>): Promise<unknown> }>('AI')
    if (live) {
      const result = (await live.run(model, input)) as { image?: string } | ReadableStream<Uint8Array>
      if (result && typeof result === 'object' && 'image' in result && typeof result.image === 'string') return decodeBase64(result.image)
      return new Uint8Array(await new Response(result as ReadableStream<Uint8Array>).arrayBuffer())
    }
    const response = await request('POST', `/accounts/${config().accountId}/ai/run/${model}`, { json: input })
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      const result = await unwrap<{ image?: string }>(response, `Workers AI (${model})`)
      if (!result?.image) throw new Error(`Cloudflare Workers AI (${model}) returned no image`)
      return decodeBase64(result.image)
    }
    if (!response.ok) throw new Error(`Cloudflare Workers AI (${model}) failed: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  },
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ────────────────────── Browser Rendering ──────────────────────

type BrowserOptions = Record<string, unknown>

async function browserAction<T>(action: string, body: Record<string, unknown>, raw: boolean): Promise<T> {
  resource('browser', null, 'Browser Rendering')
  const response = await request('POST', `/accounts/${config().accountId}/browser-rendering/${action}`, { json: body })
  // /screenshot and /pdf answer with the file itself, and with JSON only when something went wrong.
  if (raw && !(response.headers.get('content-type') ?? '').includes('application/json')) {
    if (!response.ok) throw new Error(`Cloudflare Browser Rendering (${action}) failed: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer()) as T
  }
  return unwrap<T>(response, `Browser Rendering (${action})`)
}

const browser = {
  /** A PNG of the page. */
  screenshot: (url: string, options: BrowserOptions = {}) => browserAction<Uint8Array>('screenshot', { url, ...options }, true),
  /** The page as a PDF. */
  pdf: (url: string, options: BrowserOptions = {}) => browserAction<Uint8Array>('pdf', { url, ...options }, true),
  /** The page's readable text as markdown — the friendliest input for a model. */
  markdown: (url: string, options: BrowserOptions = {}) => browserAction<string>('markdown', { url, ...options }, false),
  /** The rendered HTML, after the page's own JavaScript has run. */
  content: (url: string, options: BrowserOptions = {}) => browserAction<string>('content', { url, ...options }, false),
  /** Every link on the page. */
  links: (url: string, options: BrowserOptions = {}) => browserAction<string[]>('links', { url, ...options }, false),
  /** The elements matching each CSS selector, with their text, html and attributes. */
  scrape: (url: string, selectors: string[], options: BrowserOptions = {}) =>
    browserAction<Array<{ selector: string; results: Array<{ text: string; html: string; attributes: Array<{ name: string; value: string }> }> }>>(
      'scrape',
      { url, elements: selectors.map((selector) => ({ selector })), ...options },
      false,
    ),
  /** Structured data pulled out of the page by a model, to your prompt or JSON schema. */
  json: <T = Record<string, unknown>>(url: string, options: { prompt?: string; response_format?: Record<string, unknown> } & BrowserOptions) => browserAction<T>('json', { url, ...options }, false),
}

// ──────────────────────────── Images ────────────────────────────

export interface UploadedImage {
  id: string
  /** Ready-to-use delivery URLs, one per variant configured on the account. */
  variants: string[]
}

let accountHash: string | null = null

const images = {
  /** Store an image. `variants` comes back with the URLs to serve it from. */
  async upload(body: Blob | Uint8Array | ArrayBuffer, options: { fileName?: string; metadata?: Record<string, unknown>; requireSignedURLs?: boolean } = {}): Promise<UploadedImage> {
    resource('images', null, 'Cloudflare Images')
    const form = new FormData()
    form.set('file', body instanceof Blob ? body : new Blob([body as BlobPart]), options.fileName ?? 'upload')
    if (options.metadata) form.set('metadata', JSON.stringify(options.metadata))
    if (options.requireSignedURLs) form.set('requireSignedURLs', 'true')
    const result = await call<{ id: string; variants?: string[] }>('POST', `/accounts/${config().accountId}/images/v1`, { body: form }, 'Images upload')
    const variants = result.variants ?? []
    rememberHash(variants[0])
    return { id: result.id, variants }
  },

  async get(id: string): Promise<UploadedImage | null> {
    resource('images', null, 'Cloudflare Images')
    const response = await request('GET', `/accounts/${config().accountId}/images/v1/${encodeURIComponent(id)}`)
    if (response.status === 404) return null
    const result = await unwrap<{ id: string; variants?: string[] }>(response, 'Images read')
    rememberHash(result.variants?.[0])
    return { id: result.id, variants: result.variants ?? [] }
  },

  async delete(id: string): Promise<void> {
    resource('images', null, 'Cloudflare Images')
    await call('DELETE', `/accounts/${config().accountId}/images/v1/${encodeURIComponent(id)}`, {}, 'Images delete')
  },

  /**
   * The delivery URL of a variant. Cloudflare has no API for the account's delivery hash, so this
   * works once an image has been uploaded or read in this process; otherwise use `variants`.
   */
  url(id: string, variant = 'public'): string {
    if (!accountHash) throw new Error('The image delivery URL is not known yet. Use the `variants` an upload returns, or call images.get(id) first.')
    return `https://imagedelivery.net/${accountHash}/${id}/${variant}`
  },
}

function rememberHash(variantUrl?: string): void {
  if (!variantUrl || accountHash) return
  const match = /^https:\/\/imagedelivery\.net\/([^/]+)\//.exec(variantUrl)
  if (match) accountHash = match[1]!
}

// ───────────────────── Analytics Engine ─────────────────────

export interface AnalyticsPoint {
  /** Strings: what happened, and about what. */
  blobs?: string[]
  /** Numbers: amounts, durations, counts. */
  doubles?: number[]
  /** Exactly one value to group by (a user id, a tenant). */
  indexes?: string[]
}

export interface AnalyticsDataset {
  /** Record one event. Only the published app writes; in a preview this is a no-op. */
  write(point: AnalyticsPoint): Promise<void>
  /** Run SQL over the recorded events (works in previews and published apps alike). */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>
  /** The table name to use in SQL. */
  readonly table: string
}

function analytics(name: string): AnalyticsDataset {
  const ref = () => resource('analytics', name, `The analytics dataset "${name}"`)
  return {
    get table() {
      return ref().account
    },
    async write(point) {
      const live = await binding<{ writeDataPoint(point: AnalyticsPoint): void }>(ref().binding)
      if (!live) {
        // Analytics Engine is written through a Worker binding and has no REST way in; a preview
        // simply has nothing to write to. Saying so beats failing the request the event came from.
        console.info(`[cloudflare] analytics "${name}": events are recorded once the app is published; skipped in the preview.`)
        return
      }
      live.writeDataPoint({ blobs: point.blobs ?? [], doubles: point.doubles ?? [], indexes: point.indexes ?? [] })
    },
    async query<T>(sql: string) {
      // The SQL API takes the query as the body and answers ClickHouse-shaped, not Cloudflare's envelope.
      const response = await request('POST', `/accounts/${config().accountId}/analytics_engine/sql`, { body: sql, headers: { 'content-type': 'text/plain' } })
      const text = await response.text()
      if (!response.ok) throw new Error(`Cloudflare analytics query failed: ${text.slice(0, 300) || `HTTP ${response.status}`}`)
      return (JSON.parse(text) as { data?: T[] }).data ?? []
    },
  }
}

// ──────────────────────────── Public API ────────────────────────────

export const cloudflare = {
  /** The Cloudflare account this app runs on. */
  get accountId(): string {
    return config().accountId
  },
  kv,
  r2,
  queue,
  vectorize,
  ai,
  browser,
  images,
  analytics,

  /**
   * Any other Cloudflare API, with this app's token. The path is everything after
   * `https://api.cloudflare.com/client/v4`, and `cloudflare.accountId` fills in the account:
   * `cloudflare.api('GET', `/accounts/${cloudflare.accountId}/workers/scripts`)`.
   */
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return call<T>(method.toUpperCase(), path, body === undefined ? {} : { json: body }, `${method.toUpperCase()} ${path}`)
  },

  /** Whether the owner has connected a Cloudflare account (nothing here works until they have). */
  get connected(): boolean {
    return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)
  },
}
