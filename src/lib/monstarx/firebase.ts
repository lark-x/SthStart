// SERVER-ONLY. The owner's own Firebase project, over Firebase's REST APIs: Firestore documents, Firebase
// Authentication, Cloud Storage, Cloud Messaging and the Realtime Database. Nothing here needs the Firebase
// SDKs (they are not installed, and firebase-admin cannot run on Cloudflare Workers): every call is fetch plus
// WebCrypto, so the same code runs in the preview and in the published app.
//
// The keys come from the Firebase connector (Backend → Cloud): FIREBASE_SERVICE_ACCOUNT is the key file the
// owner pasted, FIREBASE_API_KEY their web API key, FIREBASE_STORAGE_BUCKET and FIREBASE_DATABASE_URL the
// buckets and databases that have them. Without a key file every call throws one readable error, so a page that
// uses Firebase says what is missing instead of breaking.

/** A Google service account: the `project_id`, `client_email` and `private_key` of a pasted key file. */
export interface FirebaseServiceAccount {
  projectId: string
  clientEmail: string
  /** PKCS#8 PEM, exactly as it appears in the key file (with real newlines or \n escapes). */
  privateKey: string
}

export interface FirebaseConfig extends FirebaseServiceAccount {
  /** The web API key, for signing people in and out (Firebase Authentication's client endpoints). */
  apiKey?: string
  /** Cloud Storage bucket; when it is empty the project's default bucket is looked up and kept. */
  storageBucket?: string
  /** Realtime Database URL, e.g. https://demo-default-rtdb.firebaseio.com. */
  databaseUrl?: string
  /** host:port of a local Firestore emulator (FIRESTORE_EMULATOR_HOST). */
  firestoreEmulator?: string
  /** host:port of a local Authentication emulator (FIREBASE_AUTH_EMULATOR_HOST). */
  authEmulator?: string
  /** Replaceable for tests. */
  fetch?: typeof globalThis.fetch
  now?: () => number
}

/** A document as the app sees it: its fields, with the document id under `id`. */
export type FirestoreDocument<T> = T & { id: string }

export type FirestoreOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any'

export type FirestoreWhere = [field: string, operator: FirestoreOperator, value: unknown]

export interface FirestoreQuery {
  /** Conditions, all of which must hold. */
  where?: FirestoreWhere[]
  orderBy?: string
  direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** A person in Firebase Authentication. */
export interface FirebaseUser {
  uid: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  photoUrl: string | null
  disabled: boolean
  createdAt: string | null
  lastSignInAt: string | null
  /** Custom claims set with `firebaseAuth.setClaims`. */
  claims: Record<string, unknown>
}

/** What a sign-in returns: the tokens the browser keeps and the person who signed in. */
export interface FirebaseSession {
  uid: string
  email: string | null
  idToken: string
  refreshToken: string
  /** When the id token stops being valid (milliseconds since 1970). */
  expiresAt: number
}

export interface FirebaseFile {
  path: string
  size: number
  contentType: string
  /** A URL that serves the file to anyone who has it (Firebase's download token). */
  url: string
  updatedAt: string | null
}

/** A message for Firebase Cloud Messaging: to one device token, or to everyone subscribed to a topic. */
export interface FirebasePushMessage {
  token?: string
  topic?: string
  title?: string
  body?: string
  imageUrl?: string
  /** Extra values the app reads when the notification is opened; every value must be a string. */
  data?: Record<string, string>
  /** Where a click on a web notification goes. */
  link?: string
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const FIRESTORE_HOST = 'https://firestore.googleapis.com'
const IDENTITY_HOST = 'https://identitytoolkit.googleapis.com'
const SECURE_TOKEN_HOST = 'https://securetoken.googleapis.com'
/** Firebase's own file host: where a download URL points, and where the project's bucket name comes from. */
const STORAGE_HOST = 'https://firebasestorage.googleapis.com'
/** Google Cloud Storage, which is the API a service account uploads and reads files with. */
const GCS_HOST = 'https://storage.googleapis.com'
const MESSAGING_HOST = 'https://fcm.googleapis.com'
/** Google's public keys for the id tokens Firebase Authentication issues, in JWK form (WebCrypto reads it directly). */
const ID_TOKEN_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

// cloud-platform alone would cover all of these; the rest are named so the token carries the least Google
// accepts for each API. The Realtime Database insists on userinfo.email beside firebase.database.
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

const NOT_CONNECTED =
  'Firebase is not connected yet. Add the Firebase connector in Backend → Cloud (paste the key file from Firebase: Project settings → Service accounts → Generate new private key).'

/** A stand-alone ArrayBuffer for WebCrypto, whatever view the bytes arrived in. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlText(text: string): string {
  return base64url(new TextEncoder().encode(text))
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The DER bytes of a PEM block, whatever line endings it was pasted with. */
function pemBody(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('The Firebase key file has no private key in it.')
  return fromBase64url(body.replace(/\+/g, '-').replace(/\//g, '_'))
}

/**
 * Read a pasted service-account key file. Throws a readable error for anything that is not one, so the owner
 * hears "this is the web config, not the key file" rather than a parse error from somewhere deep in a request.
 */
export function parseServiceAccount(raw: string): FirebaseServiceAccount {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(raw.trim()) as Record<string, unknown>
  } catch {
    throw new Error('That is not the Firebase key file. Paste the whole JSON file from Project settings → Service accounts → Generate new private key.')
  }
  const projectId = typeof data.project_id === 'string' ? data.project_id : ''
  const clientEmail = typeof data.client_email === 'string' ? data.client_email : ''
  const privateKey = typeof data.private_key === 'string' ? data.private_key : ''
  if (!projectId || !clientEmail || !privateKey) {
    const missing = [!projectId && 'project_id', !clientEmail && 'client_email', !privateKey && 'private_key'].filter(Boolean).join(', ')
    throw new Error(`That JSON is missing ${missing}. Paste the key file from Project settings → Service accounts → Generate new private key (not the web app config).`)
  }
  if (!privateKey.includes('PRIVATE KEY')) throw new Error('The private_key in that file does not look like a key. Paste the file exactly as Firebase downloaded it.')
  return { projectId, clientEmail, privateKey }
}

/** The Firebase configuration of this app, or null when the connector is not connected. */
export function firebaseConfigFrom(env: Record<string, string | undefined>): FirebaseConfig | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) return null
  const account = parseServiceAccount(raw)
  return {
    ...account,
    apiKey: env.FIREBASE_API_KEY || undefined,
    // Left empty on purpose: the bucket is asked for when it is first used, because its name depends on when
    // the Firebase project was made (<project>.appspot.com before September 2024, .firebasestorage.app after).
    storageBucket: env.FIREBASE_STORAGE_BUCKET || undefined,
    databaseUrl: env.FIREBASE_DATABASE_URL || undefined,
    firestoreEmulator: env.FIRESTORE_EMULATOR_HOST || undefined,
    authEmulator: env.FIREBASE_AUTH_EMULATOR_HOST || undefined,
  }
}

// ---------------------------------------------------------------------------------------------------------
// Firestore values
//
// Firestore's REST API does not take JSON: every field carries its type ({ stringValue }, { integerValue },
// { mapValue }…), whole numbers travel as strings, and dates are RFC 3339 timestamps. These two functions are
// the whole difference between the REST API and the SDK, and getting them wrong is silent (a number saved as a
// string sorts and filters wrongly), so app code never writes them by hand.
// ---------------------------------------------------------------------------------------------------------

type FirestoreValue = Record<string, unknown>

export function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (value instanceof Uint8Array) return { bytesValue: base64url(value).replace(/-/g, '+').replace(/_/g, '/') }
  switch (typeof value) {
    case 'string':
      return { stringValue: value }
    case 'boolean':
      return { booleanValue: value }
    case 'number':
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    case 'bigint':
      return { integerValue: String(value) }
    default:
      break
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue
      fields[key] = toFirestoreValue(entry)
    }
    return { mapValue: { fields } }
  }
  return { stringValue: String(value) }
}

export function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return new Date(String(value.timestampValue))
  if ('bytesValue' in value) return fromBase64url(String(value.bytesValue))
  if ('referenceValue' in value) return String(value.referenceValue)
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] } | undefined)?.values ?? []
    return values.map(fromFirestoreValue)
  }
  if ('mapValue' in value) {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> } | undefined)?.fields ?? {}
    return fromFirestoreFields(fields)
  }
  return null
}

export function toFirestoreFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || key === 'id') continue
    fields[key] = toFirestoreValue(value)
  }
  return fields
}

export function fromFirestoreFields(fields: Record<string, FirestoreValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) out[key] = fromFirestoreValue(value)
  return out
}

const OPERATORS: Record<FirestoreOperator, string> = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  in: 'IN',
  'not-in': 'NOT_IN',
  'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** The 20-character id Firestore gives a document when it chooses one itself. */
function randomDocumentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let id = ''
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length]
  return id
}

/** A collection path's last segment names the collection; anything before it addresses a parent document. */
function splitCollection(path: string): { parent: string; collection: string } {
  const clean = path.replace(/^\/+|\/+$/g, '')
  if (!clean) throw new Error('Name the collection to read, e.g. firestore.list("posts").')
  const segments = clean.split('/')
  if (segments.length % 2 === 0) {
    throw new Error(`"${path}" points at a document, not a collection. A collection path has an odd number of segments (posts, or users/abc123/orders).`)
  }
  return { collection: segments[segments.length - 1]!, parent: segments.slice(0, -1).join('/') }
}

// ---------------------------------------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------------------------------------

interface CachedToken {
  value: string
  expiresAt: number
}

const tokenCache = new Map<string, Promise<CachedToken>>()

export interface FirebaseClient {
  projectId: string
  firestore: FirestoreApi
  auth: FirebaseAuthApi
  storage: FirebaseStorageApi
  messaging: FirebaseMessagingApi
  realtime: FirebaseRealtimeApi
  /** An OAuth access token for the service account, cached until it expires. For Google APIs this file does not wrap. */
  accessToken(): Promise<string>
}

export interface FirestoreApi {
  add<T extends Record<string, unknown>>(collection: string, data: T): Promise<FirestoreDocument<T>>
  set<T extends Record<string, unknown>>(collection: string, id: string, data: T): Promise<FirestoreDocument<T>>
  update<T extends Record<string, unknown>>(collection: string, id: string, patch: Partial<T>): Promise<FirestoreDocument<T>>
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<FirestoreDocument<T> | null>
  list<T = Record<string, unknown>>(collection: string, options?: { limit?: number; orderBy?: string; direction?: 'asc' | 'desc' }): Promise<FirestoreDocument<T>[]>
  query<T = Record<string, unknown>>(collection: string, query: FirestoreQuery): Promise<FirestoreDocument<T>[]>
  remove(collection: string, id: string): Promise<void>
  /** Write many documents at once (seeding, importing): far fewer requests than one call each. */
  writeMany<T extends Record<string, unknown>>(collection: string, documents: Array<T & { id?: string }>): Promise<number>
  count(collection: string, where?: FirestoreWhere[]): Promise<number>
  increment(collection: string, id: string, field: string, by?: number): Promise<void>
  collections(parentDocument?: string): Promise<string[]>
}

export interface FirebaseAuthApi {
  verifyIdToken(idToken: string): Promise<FirebaseUser>
  signUp(input: { email: string; password: string; displayName?: string }): Promise<FirebaseSession>
  signIn(input: { email: string; password: string }): Promise<FirebaseSession>
  refresh(refreshToken: string): Promise<FirebaseSession>
  sendPasswordReset(email: string): Promise<void>
  getUser(uid: string): Promise<FirebaseUser | null>
  getUserByEmail(email: string): Promise<FirebaseUser | null>
  listUsers(options?: { limit?: number; pageToken?: string }): Promise<{ users: FirebaseUser[]; nextPageToken: string | null }>
  createUser(input: { email: string; password?: string; displayName?: string; emailVerified?: boolean }): Promise<FirebaseUser>
  updateUser(uid: string, changes: { email?: string; password?: string; displayName?: string; emailVerified?: boolean; disabled?: boolean }): Promise<FirebaseUser>
  deleteUser(uid: string): Promise<void>
  setClaims(uid: string, claims: Record<string, unknown>): Promise<void>
}

export interface FirebaseStorageApi {
  put(path: string, body: ArrayBuffer | ArrayBufferView | Blob | string, options?: { contentType?: string }): Promise<FirebaseFile>
  get(path: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string; size: number } | null>
  remove(path: string): Promise<void>
  list(prefix?: string): Promise<FirebaseFile[]>
  url(path: string): Promise<string>
}

export interface FirebaseMessagingApi {
  send(message: FirebasePushMessage): Promise<{ name: string }>
}

export interface FirebaseRealtimeApi {
  get<T = unknown>(path: string): Promise<T | null>
  set(path: string, value: unknown): Promise<void>
  update(path: string, patch: Record<string, unknown>): Promise<void>
  push(path: string, value: unknown): Promise<string>
  remove(path: string): Promise<void>
}

/**
 * A client for one Firebase project. `firestore`, `firebaseAuth`, `firebaseStorage`, `firebaseMessaging` and
 * `firebaseRealtime` below are this client bound to the app's own connected project; call this directly only to
 * reach a second project (a key file kept in another secret).
 */
export function firebaseClient(config: FirebaseConfig): FirebaseClient {
  const doFetch: typeof globalThis.fetch = config.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = config.now ?? Date.now
  const projectId = config.projectId

  async function signedAssertion(): Promise<string> {
    const issued = Math.floor(now() / 1000)
    const header = base64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claims = base64urlText(
      JSON.stringify({ iss: config.clientEmail, sub: config.clientEmail, aud: TOKEN_ENDPOINT, scope: SCOPES, iat: issued, exp: issued + 3600 }),
    )
    const key = await crypto.subtle.importKey('pkcs8', bufferOf(pemBody(config.privateKey)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
    return `${header}.${claims}.${base64url(new Uint8Array(signature))}`
  }

  async function mintToken(): Promise<CachedToken> {
    const response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signedAssertion() }),
    })
    const data = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string }
    if (!response.ok || !data.access_token) {
      const reason = data.error_description ?? data.error ?? `HTTP ${response.status}`
      throw new Error(`Firebase refused this app's key file (${reason}). Check that it belongs to project ${projectId} and has not been revoked.`)
    }
    return { value: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 }
  }

  async function accessToken(): Promise<string> {
    // The emulators take any token; minting one against Google would only fail (and cost a round trip).
    if (config.firestoreEmulator || config.authEmulator) return 'owner'
    const cacheKey = `${config.clientEmail}:${projectId}`
    const pending = tokenCache.get(cacheKey)
    if (pending) {
      const token = await pending.catch(() => null)
      // A minute of margin: a token that expires mid-request is worth replacing early.
      if (token && token.expiresAt - now() > 60_000) return token.value
    }
    const next = mintToken()
    tokenCache.set(cacheKey, next)
    try {
      return (await next).value
    } catch (error) {
      tokenCache.delete(cacheKey)
      throw error
    }
  }

  /**
   * Every call to a Google API: bearer token, JSON in, JSON out, and errors people can read. `missingIsNull`
   * marks the calls where "there is no such thing" is an answer rather than a failure (reading one document,
   * one file); everywhere else a 404 is reported like any other refusal.
   */
  async function call(url: string, init: RequestInit & { json?: unknown; missingIsNull?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${await accessToken()}`)
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json')
      init.body = JSON.stringify(init.json)
    }
    const response = await doFetch(url, { ...init, headers })
    if (!response.ok && !(init.missingIsNull && response.status === 404)) throw await googleError(response, url)
    return response
  }

  async function googleError(response: Response, url: string): Promise<Error> {
    const text = await response.text().catch(() => '')
    let message = text.slice(0, 300)
    let status = ''
    try {
      // runQuery and runAggregationQuery stream their answers, so even their errors arrive inside a JSON array.
      const body = JSON.parse(text) as unknown
      const parsed = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string; status?: string } | string }
      if (typeof parsed?.error === 'string') message = parsed.error
      else if (parsed?.error?.message) {
        message = parsed.error.message
        status = parsed.error.status ?? ''
      }
    } catch {
      // Not JSON; the first part of the body is the best description there is.
    }
    if (status === 'NOT_FOUND' && url.startsWith(FIRESTORE_HOST) && message.includes('database')) {
      return new Error(`This Firebase project has no Firestore database yet. Create one in the Firebase console (Build → Firestore Database → Create database), then try again.`)
    }
    if (status === 'PERMISSION_DENIED' || response.status === 403) {
      return new Error(`Firebase refused the request: ${message}. The service account may be missing a role, or the API may not be enabled for project ${projectId}.`)
    }
    if (status === 'FAILED_PRECONDITION' && /requires an index/i.test(message)) {
      return new Error(`Firestore needs an index for this query. Open the link Firebase gives here and create it, or query on fewer fields: ${message}`)
    }
    return new Error(`Firebase request failed (${response.status}${status ? ` ${status}` : ''}): ${message}`)
  }

  // --- Firestore -----------------------------------------------------------------------------------------

  const firestoreBase = config.firestoreEmulator ? `http://${config.firestoreEmulator}/v1` : `${FIRESTORE_HOST}/v1`
  const documentsRoot = `projects/${projectId}/databases/(default)/documents`

  /** Every segment of a Firestore path is escaped on its own: an id may hold spaces, '#' or '?' and still work. */
  function encodeSegments(path: string): string {
    return path
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/')
  }

  function documentPath(collection: string, id?: string): string {
    const { parent, collection: name } = splitCollection(collection)
    return [documentsRoot, parent, name, id].filter(Boolean).join('/')
  }

  /** The same path, ready to be put in a URL. */
  function documentUrl(collection: string, id?: string): string {
    const { parent, collection: name } = splitCollection(collection)
    return [documentsRoot, encodeSegments(parent), encodeURIComponent(name), id ? encodeURIComponent(id) : ''].filter(Boolean).join('/')
  }

  function readDocument<T>(document: { name?: string; fields?: Record<string, FirestoreValue> }): FirestoreDocument<T> {
    const name = document.name ?? ''
    const id = name.slice(name.lastIndexOf('/') + 1)
    return { ...(fromFirestoreFields(document.fields ?? {}) as T), id }
  }

  async function runQuery<T>(collection: string, query: FirestoreQuery): Promise<FirestoreDocument<T>[]> {
    const { parent, collection: name } = splitCollection(collection)
    const filters = (query.where ?? []).map(([field, operator, value]) => {
      const op = OPERATORS[operator]
      if (!op) throw new Error(`Firestore does not know the operator "${operator}". Use one of ${Object.keys(OPERATORS).join(', ')}.`)
      return { fieldFilter: { field: { fieldPath: field }, op, value: toFirestoreValue(value) } }
    })
    const structuredQuery: Record<string, unknown> = { from: [{ collectionId: name }] }
    if (filters.length === 1) structuredQuery.where = filters[0]
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } }
    if (query.orderBy) structuredQuery.orderBy = [{ field: { fieldPath: query.orderBy }, direction: query.direction === 'desc' ? 'DESCENDING' : 'ASCENDING' }]
    if (query.limit) structuredQuery.limit = query.limit
    if (query.offset) structuredQuery.offset = query.offset
    const parentPath = [documentsRoot, encodeSegments(parent)].filter(Boolean).join('/')
    const response = await call(`${firestoreBase}/${parentPath}:runQuery`, { method: 'POST', json: { structuredQuery } })
    const rows = (await response.json()) as Array<{ document?: { name?: string; fields?: Record<string, FirestoreValue> } }>
    return rows.filter((row) => row.document).map((row) => readDocument<T>(row.document!))
  }

  const firestoreApi: FirestoreApi = {
    async add(collection, data) {
      const { parent, collection: name } = splitCollection(collection)
      const parentPath = [documentsRoot, encodeSegments(parent)].filter(Boolean).join('/')
      const response = await call(`${firestoreBase}/${parentPath}/${encodeURIComponent(name)}`, { method: 'POST', json: { fields: toFirestoreFields(data) } })
      return readDocument(await response.json())
    },
    async set(collection, id, data) {
      const response = await call(`${firestoreBase}/${documentUrl(collection, id)}`, { method: 'PATCH', json: { fields: toFirestoreFields(data) } })
      return readDocument(await response.json())
    },
    async update(collection, id, patch) {
      // Without an updateMask a PATCH replaces the document, which quietly drops every field not in the patch.
      const fields = toFirestoreFields(patch as Record<string, unknown>)
      const mask = Object.keys(fields)
        .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
        .join('&')
      if (!mask) throw new Error('firestore.update needs at least one field to change.')
      const response = await call(`${firestoreBase}/${documentUrl(collection, id)}?${mask}&currentDocument.exists=true`, { method: 'PATCH', json: { fields } })
      return readDocument(await response.json())
    },
    async get(collection, id) {
      const response = await call(`${firestoreBase}/${documentUrl(collection, id)}`, { missingIsNull: true })
      if (response.status === 404) return null
      return readDocument(await response.json())
    },
    list(collection, options = {}) {
      // A collection can hold more documents than a page should ever render, so a read without a limit still has one.
      return runQuery(collection, { limit: options.limit ?? 200, orderBy: options.orderBy, direction: options.direction })
    },
    query(collection, query) {
      return runQuery(collection, query)
    },
    async remove(collection, id) {
      await call(`${firestoreBase}/${documentUrl(collection, id)}`, { method: 'DELETE' })
    },
    async writeMany(collection, documents) {
      let written = 0
      // One request carries at most 10 MiB, and a document at most 1 MiB; 200 at a time stays well inside both.
      for (let from = 0; from < documents.length; from += 200) {
        const chunk = documents.slice(from, from + 200)
        const writes = chunk.map((document) => {
          const { id, ...rest } = document
          return { update: { name: documentPath(collection, id ?? randomDocumentId()), fields: toFirestoreFields(rest) } }
        })
        // A commit applies all of its writes or none of them, so an answer means this whole chunk is in.
        await call(`${firestoreBase}/${documentsRoot}:commit`, { method: 'POST', json: { writes } })
        written += chunk.length
      }
      return written
    },
    async count(collection, where) {
      const { parent, collection: name } = splitCollection(collection)
      const filters = (where ?? []).map(([field, operator, value]) => ({ fieldFilter: { field: { fieldPath: field }, op: OPERATORS[operator], value: toFirestoreValue(value) } }))
      const structuredQuery: Record<string, unknown> = { from: [{ collectionId: name }] }
      if (filters.length === 1) structuredQuery.where = filters[0]
      else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } }
      const parentPath = [documentsRoot, encodeSegments(parent)].filter(Boolean).join('/')
      const response = await call(`${firestoreBase}/${parentPath}:runAggregationQuery`, {
        method: 'POST',
        json: { structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'count', count: {} }] } },
      })
      const rows = (await response.json()) as Array<{ result?: { aggregateFields?: { count?: FirestoreValue } } }>
      const value = rows.find((row) => row.result?.aggregateFields?.count)?.result?.aggregateFields?.count
      return Number(fromFirestoreValue(value) ?? 0)
    },
    async increment(collection, id, field, by = 1) {
      await call(`${firestoreBase}/${documentsRoot}:commit`, {
        method: 'POST',
        json: {
          writes: [
            {
              transform: {
                document: documentPath(collection, id),
                fieldTransforms: [{ fieldPath: field, increment: toFirestoreValue(by) }],
              },
            },
          ],
        },
      })
    },
    async collections(parentDocument) {
      const parentPath = [documentsRoot, parentDocument ? encodeSegments(parentDocument) : ''].filter(Boolean).join('/')
      const response = await call(`${firestoreBase}/${parentPath}:listCollectionIds`, { method: 'POST', json: { pageSize: 300 } })
      const data = (await response.json()) as { collectionIds?: string[] }
      return data.collectionIds ?? []
    },
  }

  // --- Authentication ------------------------------------------------------------------------------------

  const identityBase = config.authEmulator ? `http://${config.authEmulator}/identitytoolkit.googleapis.com/v1` : `${IDENTITY_HOST}/v1`
  const secureTokenBase = config.authEmulator ? `http://${config.authEmulator}/securetoken.googleapis.com/v1` : `${SECURE_TOKEN_HOST}/v1`

  function requireApiKey(): string {
    if (config.authEmulator) return config.apiKey ?? 'emulator-key'
    if (!config.apiKey) {
      throw new Error(
        'Signing people in with Firebase needs the web API key. Add it to the Firebase connector in Backend → Cloud (Firebase console → Project settings → General → Your apps → Web app → apiKey).',
      )
    }
    return config.apiKey
  }

  /** The client endpoints (sign-up, sign-in, password reset) authenticate with the web API key, not the key file. */
  async function identityCall(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await doFetch(`${identityBase}/${path}?key=${encodeURIComponent(requireApiKey())}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } }
    if (!response.ok) throw new Error(signInMessage(data.error?.message ?? `HTTP ${response.status}`))
    return data
  }

  function readUser(record: Record<string, unknown>): FirebaseUser {
    const claims = typeof record.customAttributes === 'string' ? (JSON.parse(record.customAttributes) as Record<string, unknown>) : {}
    const created = typeof record.createdAt === 'string' ? Number(record.createdAt) : NaN
    const lastSignIn = typeof record.lastLoginAt === 'string' ? Number(record.lastLoginAt) : NaN
    return {
      uid: String(record.localId ?? ''),
      email: typeof record.email === 'string' ? record.email : null,
      emailVerified: record.emailVerified === true,
      displayName: typeof record.displayName === 'string' ? record.displayName : null,
      photoUrl: typeof record.photoUrl === 'string' ? record.photoUrl : null,
      disabled: record.disabled === true,
      createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null,
      lastSignInAt: Number.isFinite(lastSignIn) ? new Date(lastSignIn).toISOString() : null,
      claims,
    }
  }

  function session(data: Record<string, unknown>): FirebaseSession {
    const expiresIn = Number(data.expiresIn ?? data.expires_in ?? 3600)
    return {
      uid: String(data.localId ?? data.user_id ?? ''),
      email: typeof data.email === 'string' ? data.email : null,
      idToken: String(data.idToken ?? data.id_token ?? ''),
      refreshToken: String(data.refreshToken ?? data.refresh_token ?? ''),
      expiresAt: now() + expiresIn * 1000,
    }
  }

  /** Google's sign-in codes are shouted constants; people need a sentence. */
  function signInMessage(code: string): string {
    const known: Record<string, string> = {
      EMAIL_EXISTS: 'There is already an account with that email address.',
      // Projects made since September 2023 answer every bad sign-in with INVALID_LOGIN_CREDENTIALS, on purpose:
      // saying which half was wrong would tell a stranger whether an address has an account. Older projects still
      // separate the two.
      INVALID_LOGIN_CREDENTIALS: 'That email address and password do not match an account.',
      EMAIL_NOT_FOUND: 'That email address and password do not match an account.',
      INVALID_PASSWORD: 'That email address and password do not match an account.',
      USER_DISABLED: 'That account has been disabled.',
      WEAK_PASSWORD: 'That password is too short: use at least six characters.',
      PASSWORD_DOES_NOT_MEET_REQUIREMENTS: 'That password does not meet this project’s password rules.',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a moment and try again.',
      OPERATION_NOT_ALLOWED: 'Email and password sign-in is switched off for this Firebase project (Authentication → Sign-in method).',
      ADMIN_ONLY_OPERATION: 'This Firebase project does not let apps create accounts (Authentication → Settings → User actions).',
      INVALID_EMAIL: 'That email address is not valid.',
      INVALID_REFRESH_TOKEN: 'That sign-in has expired. Sign in again.',
      TOKEN_EXPIRED: 'That sign-in has expired. Sign in again.',
    }
    // Google's codes sometimes carry an explanation after " : " (WEAK_PASSWORD : Password should be at least…).
    const [key, detail] = code.split(' : ')
    const sentence = known[key!.trim()]
    if (sentence) return sentence
    return `Firebase Authentication: ${detail ? `${key!.trim()} (${detail})` : code}`
  }

  let idTokenKeys: { fetchedAt: number; keys: Record<string, JsonWebKey> } | null = null

  async function verifyingKey(kid: string): Promise<CryptoKey> {
    if (!idTokenKeys || now() - idTokenKeys.fetchedAt > 3_600_000 || !idTokenKeys.keys[kid]) {
      const response = await doFetch(ID_TOKEN_KEYS)
      if (!response.ok) throw new Error("Could not read Google's public keys to check the sign-in token.")
      const data = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> }
      const keys: Record<string, JsonWebKey> = {}
      for (const key of data.keys ?? []) if (key.kid) keys[key.kid] = key
      idTokenKeys = { fetchedAt: now(), keys }
    }
    const jwk = idTokenKeys.keys[kid]
    if (!jwk) throw new Error('That sign-in token was signed with a key Google does not publish any more.')
    return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  }

  const authApi: FirebaseAuthApi = {
    /**
     * Check a Firebase id token the browser sent and answer with who it belongs to. The signature is verified
     * against Google's published keys and the claims against this project, so a token from another project — or
     * one somebody made up — is refused.
     */
    async verifyIdToken(idToken) {
      const parts = idToken.split('.')
      if (parts.length !== 3) throw new Error('That is not a Firebase sign-in token.')
      const header = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0]!))) as { alg?: string; kid?: string }
      const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]!))) as Record<string, unknown>
      if (!config.authEmulator) {
        if (header.alg !== 'RS256' || !header.kid) throw new Error('That sign-in token is not signed the way Firebase signs them.')
        const key = await verifyingKey(header.kid)
        const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bufferOf(fromBase64url(parts[2]!)), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
        if (!valid) throw new Error('That sign-in token has been tampered with.')
      }
      const seconds = Math.floor(now() / 1000)
      if (typeof claims.exp === 'number' && claims.exp < seconds) throw new Error('That sign-in has expired. Sign in again.')
      if (claims.aud !== projectId) throw new Error(`That sign-in token belongs to another Firebase project (${String(claims.aud)}).`)
      if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('That sign-in token was not issued by this Firebase project.')
      const uid = typeof claims.sub === 'string' ? claims.sub : ''
      if (!uid) throw new Error('That sign-in token names nobody.')
      const known = new Set(['iss', 'aud', 'auth_time', 'user_id', 'sub', 'iat', 'exp', 'email', 'email_verified', 'firebase', 'name', 'picture'])
      return {
        uid,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true,
        displayName: typeof claims.name === 'string' ? claims.name : null,
        photoUrl: typeof claims.picture === 'string' ? claims.picture : null,
        disabled: false,
        createdAt: null,
        lastSignInAt: typeof claims.auth_time === 'number' ? new Date(claims.auth_time * 1000).toISOString() : null,
        claims: Object.fromEntries(Object.entries(claims).filter(([key]) => !known.has(key))),
      }
    },
    async signUp({ email, password, displayName }) {
      const data = await identityCall('accounts:signUp', { email, password, displayName, returnSecureToken: true })
      return session(data)
    },
    async signIn({ email, password }) {
      const data = await identityCall('accounts:signInWithPassword', { email, password, returnSecureToken: true })
      return session(data)
    },
    async refresh(refreshToken) {
      const response = await doFetch(`${secureTokenBase}/token?key=${encodeURIComponent(requireApiKey())}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      })
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } }
      if (!response.ok) throw new Error(signInMessage(data.error?.message ?? `HTTP ${response.status}`))
      return session(data)
    },
    async sendPasswordReset(email) {
      await identityCall('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email })
    },
    async getUser(uid) {
      const response = await call(`${identityBase}/projects/${projectId}/accounts:lookup`, { method: 'POST', json: { localId: [uid] } })
      const data = (await response.json()) as { users?: Array<Record<string, unknown>> }
      return data.users?.[0] ? readUser(data.users[0]) : null
    },
    async getUserByEmail(email) {
      const response = await call(`${identityBase}/projects/${projectId}/accounts:lookup`, { method: 'POST', json: { email: [email] } })
      const data = (await response.json()) as { users?: Array<Record<string, unknown>> }
      return data.users?.[0] ? readUser(data.users[0]) : null
    },
    async listUsers(options = {}) {
      const params = new URLSearchParams({ maxResults: String(Math.min(options.limit ?? 200, 1000)) })
      if (options.pageToken) params.set('nextPageToken', options.pageToken)
      const response = await call(`${identityBase}/projects/${projectId}/accounts:batchGet?${params}`)
      const data = (await response.json()) as { users?: Array<Record<string, unknown>>; nextPageToken?: string }
      return { users: (data.users ?? []).map(readUser), nextPageToken: data.nextPageToken ?? null }
    },
    async createUser(input) {
      const response = await call(`${identityBase}/projects/${projectId}/accounts`, { method: 'POST', json: { ...input, emailVerified: input.emailVerified ?? false } })
      const data = (await response.json()) as Record<string, unknown>
      const uid = String(data.localId ?? '')
      return (await authApi.getUser(uid)) ?? { ...readUser(data), uid }
    },
    async updateUser(uid, changes) {
      await call(`${identityBase}/projects/${projectId}/accounts:update`, { method: 'POST', json: { localId: uid, ...changes } })
      const user = await authApi.getUser(uid)
      if (!user) throw new Error(`There is no Firebase account with the id ${uid}.`)
      return user
    },
    async deleteUser(uid) {
      await call(`${identityBase}/projects/${projectId}/accounts:delete`, { method: 'POST', json: { localId: uid } })
    },
    async setClaims(uid, claims) {
      await call(`${identityBase}/projects/${projectId}/accounts:update`, { method: 'POST', json: { localId: uid, customAttributes: JSON.stringify(claims) } })
    },
  }

  // --- Cloud Storage -------------------------------------------------------------------------------------
  //
  // Files go through Google Cloud Storage's own API, which is what a service account is allowed to use, and each
  // one is given the download token Firebase's own SDKs look for — so a file this app uploads has a URL that
  // works everywhere, and `getDownloadURL()` in the owner's other Firebase apps finds the same file.

  let bucketName: Promise<string> | null = null

  /**
   * The project's bucket. Projects made before September 2024 have `<project>.appspot.com` and newer ones
   * `<project>.firebasestorage.app`, so it is asked for rather than guessed (once per client).
   */
  function bucket(): Promise<string> {
    if (config.storageBucket) return Promise.resolve(config.storageBucket)
    bucketName ??= (async () => {
      const response = await call(`${STORAGE_HOST}/v1beta/projects/${projectId}/defaultBucket`)
      const data = (await response.json()) as { bucket?: { name?: string } }
      const name = data.bucket?.name?.split('/').pop()
      if (!name) {
        throw new Error(
          'This Firebase project has no Cloud Storage bucket yet. Create one in the Firebase console (Build → Storage → Get started); since February 2026 that needs the project to be on the pay-as-you-go Blaze plan.',
        )
      }
      return name
    })().catch((error: unknown) => {
      bucketName = null
      throw error
    })
    return bucketName
  }

  /**
   * Cloud Storage asks for more of an object's name to be escaped than encodeURIComponent does: a file called
   * `holiday (1)*.jpg` is not found unless the brackets and the star are escaped too.
   */
  function objectName(path: string): string {
    return encodeURIComponent(path.replace(/^\/+/, '')).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  }

  function objectUrl(name: string, path: string, suffix = ''): string {
    return `${GCS_HOST}/storage/v1/b/${encodeURIComponent(name)}/o/${objectName(path)}${suffix}`
  }

  /** The URL Firebase serves a file from, the same one getDownloadURL() gives the owner's other apps. */
  function downloadUrl(name: string, path: string, token: string): string {
    return `${STORAGE_HOST}/v0/b/${encodeURIComponent(name)}/o/${encodeURIComponent(path)}?alt=media${token ? `&token=${token}` : ''}`
  }

  function readFile(name: string, meta: Record<string, unknown>): FirebaseFile {
    const path = String(meta.name ?? '')
    const metadata = (meta.metadata ?? {}) as Record<string, string>
    const token = (metadata.firebaseStorageDownloadTokens ?? '').split(',')[0] ?? ''
    return {
      path,
      size: Number(meta.size ?? 0),
      contentType: String(meta.contentType ?? 'application/octet-stream'),
      url: downloadUrl(name, path, token),
      updatedAt: typeof meta.updated === 'string' ? meta.updated : null,
    }
  }

  async function bodyBytes(body: ArrayBuffer | ArrayBufferView | Blob | string): Promise<Uint8Array> {
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
    return new Uint8Array(body)
  }

  const storageApi: FirebaseStorageApi = {
    async put(path, body, options = {}) {
      const name = await bucket()
      const clean = path.replace(/^\/+/, '')
      const contentType = options.contentType ?? (body instanceof Blob && body.type ? body.type : 'application/octet-stream')
      // One request carries the file and its metadata, so the download token exists the moment the file does.
      const metadata = { name: clean, contentType, metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() } }
      const boundary = `monstarx-${crypto.randomUUID()}`
      const head = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
      )
      const bytes = await bodyBytes(body)
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
      const payload = new Uint8Array(head.length + bytes.length + tail.length)
      payload.set(head, 0)
      payload.set(bytes, head.length)
      payload.set(tail, head.length + bytes.length)
      const response = await call(`${GCS_HOST}/upload/storage/v1/b/${encodeURIComponent(name)}/o?uploadType=multipart`, {
        method: 'POST',
        body: bufferOf(payload),
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      })
      return readFile(name, (await response.json()) as Record<string, unknown>)
    },
    async get(path) {
      const name = await bucket()
      const response = await call(objectUrl(name, path, '?alt=media'), { missingIsNull: true })
      if (response.status === 404 || !response.body) return null
      return {
        body: response.body,
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        size: Number(response.headers.get('content-length') ?? 0),
      }
    },
    async remove(path) {
      const name = await bucket()
      await call(objectUrl(name, path), { method: 'DELETE' })
    },
    async list(prefix = '') {
      const name = await bucket()
      const params = new URLSearchParams({ maxResults: '1000' })
      if (prefix) params.set('prefix', prefix.replace(/^\/+/, ''))
      const response = await call(`${GCS_HOST}/storage/v1/b/${encodeURIComponent(name)}/o?${params}`)
      const data = (await response.json()) as { items?: Array<Record<string, unknown>> }
      return (data.items ?? []).map((item) => readFile(name, item))
    },
    async url(path) {
      const name = await bucket()
      const response = await call(objectUrl(name, path), { missingIsNull: true })
      if (response.status === 404) throw new Error(`There is no file at ${path} in the Firebase bucket ${name}.`)
      const meta = (await response.json()) as Record<string, unknown>
      const file = readFile(name, meta)
      const metadata = (meta.metadata ?? {}) as Record<string, string>
      if (metadata.firebaseStorageDownloadTokens) return file.url
      // A file put there by something else has no download token; give it one so the URL works for everyone.
      const token = crypto.randomUUID()
      await call(objectUrl(name, path), { method: 'PATCH', json: { metadata: { ...metadata, firebaseStorageDownloadTokens: token } } })
      return downloadUrl(name, String(meta.name ?? path), token)
    },
  }

  // --- Cloud Messaging -----------------------------------------------------------------------------------

  const messagingApi: FirebaseMessagingApi = {
    async send(message) {
      if (!message.token && !message.topic) throw new Error('A push message needs a device token or a topic.')
      const payload: Record<string, unknown> = {}
      if (message.token) payload.token = message.token
      if (message.topic) payload.topic = message.topic.replace(/^\/topics\//, '')
      if (message.title || message.body || message.imageUrl) {
        payload.notification = { title: message.title, body: message.body, image: message.imageUrl }
      }
      if (message.data) payload.data = message.data
      if (message.link) payload.webpush = { fcmOptions: { link: message.link } }
      const size = new TextEncoder().encode(JSON.stringify(payload)).length
      // Firebase refuses a message over 4 KB, and only half that when it goes to a topic.
      const cap = message.topic ? 2048 : 4096
      if (size > cap) throw new Error(`This push message is ${size} bytes; Firebase takes at most ${cap} for ${message.topic ? 'a topic' : 'one device'}. Send a short notification and keep the rest in the app.`)
      let response: Response
      try {
        response = await call(`${MESSAGING_HOST}/v1/projects/${projectId}/messages:send`, { method: 'POST', json: { message: payload } })
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (/UNREGISTERED|NOT_FOUND|not a valid FCM registration token/i.test(text)) {
          throw new Error('That device is not registered for notifications any more. Remove the token and ask the app for a new one.')
        }
        throw error
      }
      const data = (await response.json()) as { name?: string }
      return { name: data.name ?? '' }
    },
  }

  // --- Realtime Database ---------------------------------------------------------------------------------

  async function realtimeUrl(path: string): Promise<string> {
    if (!config.databaseUrl) {
      throw new Error('The Realtime Database URL is missing. Add it to the Firebase connector in Backend → Cloud (it looks like https://<project>-default-rtdb.firebaseio.com), or keep data in Firestore.')
    }
    // The database answers some requests with a redirect to another host, and a browser-style fetch drops the
    // Authorization header when it follows one. The token goes in the query string, which survives.
    return `${config.databaseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}.json?access_token=${encodeURIComponent(await accessToken())}`
  }

  const realtimeApi: FirebaseRealtimeApi = {
    async get(path) {
      const response = await call(await realtimeUrl(path), { missingIsNull: true })
      if (response.status === 404) return null
      return (await response.json()) as null
    },
    async set(path, value) {
      await call(await realtimeUrl(path), { method: 'PUT', json: value })
    },
    async update(path, patch) {
      await call(await realtimeUrl(path), { method: 'PATCH', json: patch })
    },
    async push(path, value) {
      const response = await call(await realtimeUrl(path), { method: 'POST', json: value })
      const data = (await response.json()) as { name?: string }
      return data.name ?? ''
    },
    async remove(path) {
      await call(await realtimeUrl(path), { method: 'DELETE' })
    },
  }

  return { projectId, firestore: firestoreApi, auth: authApi, storage: storageApi, messaging: messagingApi, realtime: realtimeApi, accessToken }
}

// ---------------------------------------------------------------------------------------------------------
// This app's own Firebase project
// ---------------------------------------------------------------------------------------------------------

let bound: FirebaseClient | null = null
let boundFrom: string | null = null

function client(): FirebaseClient {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!raw) throw new Error(NOT_CONNECTED)
  // Reconnecting with different keys replaces the client; the preview restarts with the new environment.
  if (!bound || boundFrom !== raw) {
    bound = firebaseClient(firebaseConfigFrom(process.env as Record<string, string | undefined>)!)
    boundFrom = raw
  }
  return bound
}

/** Whether this app has a Firebase project connected. False means every call below would throw. */
export function firebaseConnected(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT)
}

/** The connected Firebase project's id (empty when nothing is connected). */
export function firebaseProjectId(): string {
  try {
    return client().projectId
  } catch {
    return ''
  }
}

/**
 * The app's own client, resolved when it is first used. Everything below awaits it, so a missing connector is a
 * rejected promise like any other failure — never an exception thrown before the call returns.
 */
async function app(): Promise<FirebaseClient> {
  return client()
}

/** Documents in the app's Firestore database. Collection paths may name a subcollection: `users/abc/orders`. */
export const firestore: FirestoreApi = {
  add: async (collection, data) => (await app()).firestore.add(collection, data),
  set: async (collection, id, data) => (await app()).firestore.set(collection, id, data),
  update: async (collection, id, patch) => (await app()).firestore.update(collection, id, patch),
  get: async (collection, id) => (await app()).firestore.get(collection, id),
  list: async (collection, options) => (await app()).firestore.list(collection, options),
  query: async (collection, query) => (await app()).firestore.query(collection, query),
  remove: async (collection, id) => (await app()).firestore.remove(collection, id),
  writeMany: async (collection, documents) => (await app()).firestore.writeMany(collection, documents),
  count: async (collection, where) => (await app()).firestore.count(collection, where),
  increment: async (collection, id, field, by) => (await app()).firestore.increment(collection, id, field, by),
  collections: async (parentDocument) => (await app()).firestore.collections(parentDocument),
}

/** People in the app's Firebase Authentication: sign-in, sign-up, tokens and the user records behind them. */
export const firebaseAuth: FirebaseAuthApi = {
  verifyIdToken: async (idToken) => (await app()).auth.verifyIdToken(idToken),
  signUp: async (input) => (await app()).auth.signUp(input),
  signIn: async (input) => (await app()).auth.signIn(input),
  refresh: async (refreshToken) => (await app()).auth.refresh(refreshToken),
  sendPasswordReset: async (email) => (await app()).auth.sendPasswordReset(email),
  getUser: async (uid) => (await app()).auth.getUser(uid),
  getUserByEmail: async (email) => (await app()).auth.getUserByEmail(email),
  listUsers: async (options) => (await app()).auth.listUsers(options),
  createUser: async (input) => (await app()).auth.createUser(input),
  updateUser: async (uid, changes) => (await app()).auth.updateUser(uid, changes),
  deleteUser: async (uid) => (await app()).auth.deleteUser(uid),
  setClaims: async (uid, claims) => (await app()).auth.setClaims(uid, claims),
}

/** Files in the app's Firebase Cloud Storage bucket. */
export const firebaseStorage: FirebaseStorageApi = {
  put: async (path, body, options) => (await app()).storage.put(path, body, options),
  get: async (path) => (await app()).storage.get(path),
  remove: async (path) => (await app()).storage.remove(path),
  list: async (prefix) => (await app()).storage.list(prefix),
  url: async (path) => (await app()).storage.url(path),
}

/** Push notifications through Firebase Cloud Messaging. */
export const firebaseMessaging: FirebaseMessagingApi = {
  send: async (message) => (await app()).messaging.send(message),
}

/** The app's Firebase Realtime Database (only when its URL is configured; Firestore is the usual choice). */
export const firebaseRealtime: FirebaseRealtimeApi = {
  get: async (path) => (await app()).realtime.get(path),
  set: async (path, value) => (await app()).realtime.set(path, value),
  update: async (path, patch) => (await app()).realtime.update(path, patch),
  push: async (path, value) => (await app()).realtime.push(path, value),
  remove: async (path) => (await app()).realtime.remove(path),
}
