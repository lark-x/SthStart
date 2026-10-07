# The built-in services of this app

MonstarX maintains this file, like every file listed below: it is read-only, the same in every MonstarX app, and
replaced with MonstarX's current version whenever the app is previewed, published or exported. It describes code
that exists in this app right now. If something is not described here, do not assume it exists: read the file.

## Files managed by MonstarX

These files are always present and cannot be edited. Read them with `read_file`. `@/` means `src/`.

| File | What it gives the app | Where it may be imported |
| --- | --- | --- |
| `src/lib/monstarx/clipboard.ts` | `copyText(text)` with an iframe-safe fallback | Routes and components |
| `src/lib/monstarx/cloudflare.ts` | `cloudflare`: the owner's own Cloudflare account — KV, R2, Queues, Vectorize, Workers AI, Browser Rendering, Images, Analytics Engine | Server code only |
| `src/lib/monstarx/map.tsx` | `<Map>`: a pannable, zoomable map with no API key | Routes and components |
| `src/lib/monstarx/world.tsx` | `<WorldMap>`: a clickable map of the world, no key and no network | Routes and components |
| `src/lib/monstarx/countries.ts` | `COUNTRIES`, `countryByCode()`, `countryName()`, `findCountry()`, `searchCountries()`, `countriesIn()`, `distanceKm()` | Anywhere |
| `src/lib/monstarx/world-shapes.ts` | The country outlines `<WorldMap>` draws (loaded by it, never imported by the app) | Nothing imports it |
| `src/lib/monstarx/firebase.ts` | `firestore`, `firebaseAuth`, `firebaseStorage`, `firebaseMessaging`, `firebaseRealtime`: the owner's own Firebase project, when its connector is connected | Server code only |
| `src/lib/monstarx/country-data.ts` | `countryData`: live public data of Singapore, Japan, Malaysia, India, Indonesia, the UAE and the Philippines, when the owner switched the country on | Server code only |
| `src/lib/actions.ts` | `useAction()` and `useOptimisticAction()`: buttons that answer at once; `messageOf()` turns action errors into the app's language | Routes and components |
| `src/lib/auth.ts` | Better Auth on the server: email and password accounts, Google sign-in when the owner turns it on, the admin plugin, password reset emails. `getAuth()` | Server code only (`src/server/*.ts`, server routes) |
| `src/lib/auth-client.ts` | `authClient`, Better Auth in the browser | Routes and components |
| `src/lib/auth-popup.ts` | `framedSignIn()`: Google sign-in in a pop-up when the app runs in a frame (the MonstarX preview); used by `auth.ts` | Nothing imports it but `auth.ts` |
| `src/lib/session.ts` | `getSessionUser()` and `getSignInOptions()`, server functions | Routes and components |
| `src/lib/session.server.ts` | `currentUser()`, `requireUser()` and the `SessionUser` type | Server code only |
| `src/routes/api/auth.$.ts` | Better Auth's endpoints at `/api/auth/*` | Nothing imports it |
| `src/db/auth-schema.ts` | The Drizzle tables `user`, `session`, `account` and `verification` | Through `@/db/schema` |
| `src/lib/db.ts` | `getDb()`, the app's database through Drizzle | Server code only |
| `src/lib/email.ts` | `sendEmail()` | Server code only |
| `src/lib/storage.ts` | `storage`, file storage | Server code only |
| `src/routes/api/files.$.ts` | Serves stored files at `/api/files/<key>` | Nothing imports it |
| `src/lib/ai.ts` | `ai`: text, JSON, streaming, web search and images | Server code only |
| `src/lib/config.ts` | `getPublicEnv()`, the `PUBLIC_*` values the browser may see | Route loaders |
| `src/lib/monstarx/seo.ts` | `seoHead()`, `pageSeo()`, `structuredData()`, `robotsTxt()`, `sitemapXml()`, `llmsTxt()`, `appPagePaths()`, `absoluteUrl()`, `seoConfig`, `DEFAULT_SEO`, `GEO_CRAWLERS` | The root route; anywhere that needs the app's own address |
| `src/routes/robots[.]txt.ts` | Serves `/robots.txt` from the SEO settings | Nothing imports it |
| `src/routes/sitemap[.]xml.ts` | Serves `/sitemap.xml` from the SEO settings | Nothing imports it |
| `src/routes/llms[.]txt.ts` | Serves `/llms.txt`, the app explained to AI answer engines | Nothing imports it |

`src/db/schema.ts` and `src/lib/utils.ts` belong to the app and can be edited. `src/routeTree.gen.ts` is generated
by the preview's dev server from the files in `src/routes`; it is not stored in the project, and routes change by
editing `src/routes`.

`src/seo.config.ts` is written by the app owner's SEO/GEO tab. It is part of the project — you may read it — but you
must never edit it: the next save from the tab replaces it whole.

## Search engines and AI answers

Every title, description, canonical link, Open Graph tag, JSON-LD block, `/robots.txt`, `/sitemap.xml` and
`/llms.txt` in an app comes from one place: the owner's SEO/GEO settings, stored as `src/seo.config.ts` and turned
into tags by `src/lib/monstarx/seo.ts`. The root route already calls it:

```tsx
import { seoHead } from '@/lib/monstarx/seo'

export const Route = createRootRoute({
  head: (ctx) => {
    const seo = seoHead(ctx)
    return { ...seo, links: [...seo.links, { rel: 'stylesheet', href: appCss }] }
  },
  …
})
```

**Never write meta tags into a route's `head()`** to give a page a title or a description, and never add your own
`/robots.txt` or `/sitemap.xml` route: the owner's settings would stop reaching that page and the two would drift
apart. If a page is missing a title, that is for the owner's tab, not for you.

The one case where a page sets its own `head()` is a title built from data it loads (`"{post.title} — Blog"`). Then
build the title from that data and leave everything else — description, canonical, Open Graph, structured data — to
`seoHead`, which the root route already supplies.

What you *can* do for search and AI answers, and what a SEO check-up will ask you for: one `<h1>` per page saying
what the page is, headings that step one level at a time, `alt` on every picture, an opening paragraph of plain
prose that states what the page is (answer engines quote sentences, not layouts), links between pages, and — most
important — content rendered on the server. Data fetched in the browser after the page loads is invisible to AI
answer engines, so load it in the route's loader.

`seoConfig` also exposes the app's own address (`seoConfig.siteUrl`) and language (`seoConfig.locale`); `absoluteUrl(path)`
turns a path into a full URL against it, and `appPagePaths()` lists the app's pages. `pageSeo(path)` gives one page's
resolved title, description and questions; `structuredData(path)` the JSON-LD it publishes; `robotsTxt()`,
`sitemapXml(paths)` and `llmsTxt(paths)` the three files, already served for you. `DEFAULT_SEO` is what an app falls
back to before its owner has filled anything in, and `GEO_CRAWLERS` is the list of AI answer-engine crawlers
`robots.txt` names one by one.

## Buttons and actions

Give every filled button (and link styled as a button) a foreground colour paired with its background: for example,
`bg-white text-neutral-900` or `bg-neutral-900 text-white`. Include hover, active and disabled states. Do not let a
button inherit text colour from a surrounding section: white text on a white button disappears. The starter gives
unadorned buttons dark text as a fallback, but a styled button needs its own contrasting label and icon colour.

Every button, form and toggle that calls a server function goes through `@/lib/actions`. Writing the call by hand is
the single most common way a generated app feels broken:

```tsx
// Wrong. Nothing changes until the server answers and every loader refetches, so the button feels dead — and
// `disabled` swallows the clicks people make while they wait.
<button disabled={busy} onClick={async () => { await toggleUpvote({ data: { id } }); await router.invalidate() }}>
```

### `useAction(action, options?)` — for an action with no value of its own on screen

Sign out, send, submit, delete-and-navigate.

```tsx
import { useAction } from '@/lib/actions'

const save = useAction(addTask, { onSuccess: () => setTitle('') })

<button onClick={() => save.run({ data: { title } })}>{save.pending ? 'Adding…' : 'Add task'}</button>
{save.error ? <p className="text-sm text-red-600">{save.error}</p> : null}
```

`run(...)` takes the arguments of the server function and returns nothing — never `await` it. It is ignored while
the action is still running, so a form cannot be submitted twice, and `pending` is already on screen by then.

`onSuccess` receives what the action returned, so a form can open the record it just created — no `useState` plus
`useEffect` to carry an id across:

```tsx
const navigate = useNavigate()
const book = useAction(createBooking, {
  refresh: false,
  onSuccess: (booking) => navigate({ to: '/book/confirmed/$id', params: { id: booking.id } }),
})

<button onClick={() => book.run({ data: { slot, name, email } })}>{book.pending ? 'Booking…' : 'Confirm booking'}</button>
{book.error ? <p className="text-sm text-red-600">{book.error}</p> : null}
```

`error` is a string (the message), never an `Error` object: render `{book.error}`, not `book.error.message`.

### `useOptimisticAction({ value, update, action })` — when the click changes something visible here

A vote, a like, a checkbox, a status, a quantity. The new value is on screen before the request leaves the browser.

```tsx
import { useOptimisticAction } from '@/lib/actions'

const vote = useOptimisticAction({
  value: { count: post.votes, voted: post.voted },      // what the loader says
  update: (current) => ({ count: current.count + (current.voted ? -1 : 1), voted: !current.voted }),
  action: () => toggleUpvote({ data: { postId: post.id } }),
})

<button onClick={() => vote.run()} aria-pressed={vote.value.voted}>▲ {vote.value.count}</button>
```

Render `vote.value`, not `post.votes`. If the call fails the old value comes back by itself and `vote.error` says
why. Clicks are never ignored, and the calls reach the server in the order they were made.

### The rules

- Both hooks refetch the route's loaders when the action succeeds. Nothing else should call `router.invalidate()`
  after a mutation — pass `{ refresh: false }` when the page really has nothing to refetch.
- `pending` is for the label ("Saving…", a spinner, a dimmed row), not for `disabled`. A button that looks the same
  but ignores clicks is what people report as "I have to press it twice".
- One hook per item, inside that item's own component (`<PostCard>`, `<TodoItem>`). A single `busy` flag shared by a
  whole list freezes every other row while one of them saves.
- Options: `refresh` (default true), `onSuccess(result)` (runs after the loaders refetched, with what the action
  returned), `onError(message)` (handle it yourself instead of reading `error`).
- A thrown error is a failure, and so is a returned object whose `error` is set (`{ error: { message } }` or
  `{ error: 'That time was just taken' }`): `onSuccess` does not run and `error` holds the message.
- Sign-in and sign-up pages use them too. `authClient` calls return `{ data, error }` instead of throwing, which
  counts as a failure as described above:
  `const login = useAction(() => authClient.signIn.email({ email, password }), { onSuccess: () => navigate({ to: '/dashboard' }) })`
  then show `{login.error}`.

## Accounts and sign-in

### How it works

- Better Auth runs inside this app (`src/lib/auth.ts`) and keeps its users in the app's own database (the built-in
  tables below). Its endpoints are at `/api/auth/*`: sign-up, sign-in, sign-out, the session and password reset.
- Accounts are email and password; a password needs at least 8 characters. Email verification is not required.
- Google sign-in is on only when the owner turns it on in MonstarX (Backend → Cloud → Auth → Sign-in methods); the
  app cannot turn it on itself. `await getSignInOptions()` from `@/lib/session` returns `{ google }`: show a
  "Continue with Google" button only when `google` is true. Someone who signed up with email and then continues with
  Google under the same address stays the same user. There is no other social sign-in.
- Inside the MonstarX preview the app runs in a frame, where Google refuses to open: there `signIn.social` opens
  Google in a pop-up and the frame continues to `callbackURL` once it is done. The app's code is the same either way.
- A successful sign-up or sign-in adds a row to `session` and sets the session cookie on its response. Every later
  request (a page load, a server function) is signed in only when the browser sends that cookie back. A session
  lasts 7 days.
- The admin plugin is on, which adds `role`, `banned`, `ban_reason` and `ban_expires` to `user`. The app's owner
  manages users in MonstarX under Backend → Users. The browser client has no admin plugin; server code reaches
  Better Auth's own API through `(await getAuth()).api`.
- MonstarX generates `BETTER_AUTH_SECRET` for each app, and the app's address is taken from each request, so custom
  domains need no configuration.

### In the browser: `authClient` from `@/lib/auth-client`

- `await authClient.signUp.email({ name, email, password })`
- `await authClient.signIn.email({ email, password })`
- `await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })` leaves for Google's sign-in page
  and comes back signed in to `callbackURL`; only when `getSignInOptions()` says `google` is on.
- `await authClient.signOut()`
- `const { data: session, isPending } = authClient.useSession()`
- `await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })` emails a link that works for one
  hour. The page at `redirectTo` reads `token` from its search params and calls
  `await authClient.resetPassword({ newPassword, token })`.
- These calls resolve to `{ data, error }` rather than throwing for a wrong password or a taken email. Run them
  through `useAction` (see "Buttons and actions"): a set `error` becomes the action's `error` message, and on success
  the loaders run again with the new session before `onSuccess` navigates. Called by hand, check `error` yourself
  and `await router.invalidate()` before navigating.

### On the server

- In routes: `import { getSessionUser } from '@/lib/session'`, then `const user = await getSessionUser()`, which is
  `null` for a signed-out visitor. Protect a page in its `beforeLoad`:
  `const user = await getSessionUser(); if (!user) throw redirect({ to: '/login' })`.
- If a parent route needs a profile or role, use one server function that returns the profile (or `null` when signed
  out) in `beforeLoad`. Do not call `getSessionUser()` first and then a profile function that calls `currentUser()`:
  those are separate browser requests and repeat the session database lookup on every child navigation. Keep the
  profile function's session check on the server, and authorize each data server function independently.
- In server functions (`src/server/*.ts`): `import { currentUser, requireUser } from '@/lib/session.server'`.
  `requireUser()` throws `Please sign in to continue` when the request has no session; `currentUser()` returns
  `null` instead. A user is `{ id, email, name, image }` (`SessionUser`).
- Keep the app's own rows per user with a `user_id` column holding `user.id`.
- Never import `@/lib/auth`, `@/lib/session.server` or `@/lib/db` into a route or component module, only into
  `src/server/*.ts` files whose exports are server functions.

### Where the app runs, and what that means for the session cookie

- **In the preview** the app runs on its own address inside the MonstarX workspace, in a frame of a page on another
  site. Browsers drop ordinary `SameSite=Lax` cookies there, so a preview sets the session cookie with
  `SameSite=None; Secure; Partitioned` (`MONSTARX_PREVIEW=1`). A preview opened in its own browser tab has a
  separate cookie jar, so people sign in there again.
- **A published app** is opened directly at its own address and keeps Better Auth's default first-party cookies.
- The app's own code cannot change either; `src/lib/auth.ts` decides.

### When sign-in does not work

Look before you change anything, and tell the user what you found.

1. Check the database with `query_database`:
   `SELECT id, email, created_at FROM user ORDER BY created_at DESC LIMIT 5` and
   `SELECT user_id, created_at, expires_at FROM session ORDER BY created_at DESC LIMIT 5`.
   - No new user after a sign-up: the sign-up failed. Read how the form handles `error` and check `read_logs`.
   - A new session for every attempt while the app still acts signed out: sign-in works and the session cookie is
     not coming back. Changing how the page navigates does not fix that. Look for code that signs out or clears
     cookies, then ask which browser the user has and whether it blocks third-party cookies; signing in with the
     preview open in its own tab tells the two cases apart.
   - No session at all: the sign-in request failed. Show `error.message` in the form and check `read_logs`.
2. `Please sign in to continue` is `requireUser()`: a server function ran without a session. On a page that
   signed-out visitors may see, use `currentUser()` and handle `null`.
3. `view_page` and `check_project` load pages as a signed-out visitor. A protected page answering `HTTP 307` to
   `/login` there is expected.
4. You cannot sign in yourself. When a fix needs a signed-in browser to confirm, say what you changed and ask the
   user to try again; do not call it fixed.

## Database

### Using it

- Every app has one SQLite database: managed by MonstarX in the preview, Cloudflare D1 (bound as `DB`) when
  published. `getDb()` from `@/lib/db` returns Drizzle; call it inside server function handlers only.
- The driver is asynchronous: **await every query**, `.all()`, `.get()` and `.run()` included —
  `const rows = await db.select().from(classes).all()`. Without `await` the value is a promise, and the page crashes
  with "rows.map is not a function".
- A table exists twice and both must match: the Drizzle table in `src/db/schema.ts`, and the SQL that creates it,
  applied with `add_migration` and saved as `migrations/NNNN_<name>.sql`. `src/db/schema.ts` re-exports the built-in
  tables, so `import { user, session } from '@/db/schema'` works.
- The ids of applied migrations are kept in the table `_monstarx_migrations`. Never write to it.

### Column names

Drizzle's property names are not the column names. `createdAt: integer('created_at')` is the property `createdAt` in
TypeScript and the column `created_at` in SQL. Drizzle queries use properties (`user.createdAt`); SQL written by hand
(`query_database`, `sql` templates, migrations) uses columns (`created_at`).

### Built-in tables

MonstarX's first migration, `0000_monstarx_auth`, creates these tables in every app; it is not in `migrations/`.
Their timestamps are integers counting milliseconds since 1970, and their booleans are the integers 0 and 1.

| Table | Columns (SQL names) |
| --- | --- |
| `user` | `id`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`, `role`, `banned`, `ban_reason`, `ban_expires` |
| `session` | `id`, `expires_at`, `token`, `created_at`, `updated_at`, `ip_address`, `user_agent`, `user_id`, `impersonated_by` |
| `account` | `id`, `account_id`, `provider_id`, `user_id`, `access_token`, `refresh_token`, `id_token`, `access_token_expires_at`, `refresh_token_expires_at`, `scope`, `password`, `created_at`, `updated_at` |
| `verification` | `id`, `identifier`, `value`, `expires_at`, `created_at`, `updated_at` |

An email account's password hash is in `account.password`, on the row whose `provider_id` is `credential`. Never
alter these tables. Keep what the app knows about a user in its own table keyed by `user_id` (a `profiles` table,
for example).

### `query_database`

- One read-only statement per call (`SELECT`, `WITH`, `PRAGMA` or `EXPLAIN`); at most 100 rows come back.
- `PRAGMA table_info(<table>)` lists a table's columns. When a query names a table or column that does not exist,
  the error lists every table with its columns.
- The app's own tables are defined in `migrations/`; the built-in ones are listed above.


## Email

Only while Email is on for this app in MonstarX Cloud.

- `import { sendEmail } from '@/lib/email'` in server code:
  `await sendEmail({ to, subject, text, html, replyTo, fromName })` returns `{ id, from }`. `to` is one address or a
  list; give `text`, `html` or both.
- Messages leave from this app's own address on MonstarX's mail domain. Each app may send 50 an hour and 300 a day;
  a refused message throws with the reason.
- Addresses on test domains that can never receive mail (`example.com`, `example.org`, `example.net`, and names ending
  in `.test`, `.example`, `.invalid` or `.localhost`) are not sent and never throw: the result lists them in `skipped`
  and Backend → Emails shows them as not delivered.
- Automated QA signs up with addresses at `qa.monstarx.com` (`qa-…@qa.monstarx.com`). They are real inboxes: QA opens
  the emails your code sends, checks what they say and follows their links, so an email that never arrives, has the
  wrong details or links to a page that does not work is reported as a bug. Mail to them counts toward none of the
  app's limits; Backend → Emails shows it as "Sent · QA test inbox".
- Send email after the change it reports is saved, and never let a failed send undo or hide that change: a booking
  that was saved is still booked when its confirmation email is refused.
- `src/lib/auth.ts` already sends the password reset emails.
- Your tools cannot see a delivered email. The owner finds sent messages under Backend → Emails.

## File storage

Only while Storage is on for this app in MonstarX Cloud.

- `import { storage } from '@/lib/storage'` in server code.
- `await storage.put(key, body, { contentType })` returns `{ key, size, contentType, url }`; the body is an
  `ArrayBuffer`, a typed array, a `Blob` or a string.
- `await storage.get(key)` returns `{ body, contentType, size }`, or `null` when there is no such file.
  `await storage.delete(key)` removes one. `await storage.list(prefix)` returns up to 1000 files.
  `storage.publicUrl(key)` is the URL a key is served from.
- Keys under `public/` get a permanent public URL for `<img src>` and downloads. Every other key is private:
  `/api/files/<key>` serves it to signed-in users and answers 401 to everyone else.
- A file may be up to 50 MB. Save the key or URL in the database next to the record it belongs to.

## AI and web search

Only while AI (and, for `ai.search`, Web Search) is on for this app in MonstarX Cloud.

**Fair use.** The AI is for this app's own features, used by the people using the app through its own pages. An app
must never pass it on to other programs: no OpenAI-, Anthropic- or Gemini-compatible endpoint (`/v1/chat/completions`,
`/v1/models`…), proxy, gateway or relay that forwards a caller's prompts or conversations, and never expose
`MONSTARX_DATA_TOKEN` or `MONSTARX_AI_URL`. MonstarX scans apps for this: such an app cannot be published and its AI
answers 403. The AI also answers 429 past 30 text requests a minute or the app's daily limits; call it on explicit user
actions.

- `import { ai } from '@/lib/ai'` in server functions and server routes.
- `await ai.generateText({ prompt })`, or `({ messages, system, temperature, maxTokens })`, returns
  `{ text, model, usage }`. Message content may include `{ type: 'image_url', image_url: { url } }` parts.
- `await ai.generateJson({ prompt, schema: z.object({ ... }) })` sends a JSON Schema to the model and checks the
  response against the Zod schema locally. The schema must describe an object; wrap a list in an object field.
  `validate` can add checks across fields. Calls without `schema` still parse JSON and may use `validate`.
- `await ai.streamText({ messages })` returns a stream of text chunks: return `new Response(await ai.streamText(...))`
  from a server route and read `response.body` in the browser.
- `await ai.search({ query, maxResults })` returns `{ answer, sources: [{ title, url, snippet }], model }`.
- `await ai.generateImage({ prompt, size })` returns `{ url, key, model }`; the image is stored with the app's files.
- `await ai.generateSpeech({ text, language?, model?, voice? })` returns an MP3 **Response**, ready to return
  from a server route. `text` is plain text, 1–4000 characters; `language` defaults to `en`.
- `await ai.transcribe({ audio: file, language?, model? })` returns `{ text, model, usage: { seconds, costUsd,
  costEstimated } }`. `audio` is a Blob/File, 1 byte–10 MiB; preserve its MIME type or filename. An omitted
  two-letter `language` means auto-detect. `costUsd` is provider cost before MonstarX credit markup.
- MonstarX picks the models and holds the keys. Each app may make 300 AI requests and 30 images a day, so call the AI
  when someone asks for it, never on a page load. Text, search, speech and transcription share the request limit;
  these defaults are host-configurable. A complete spoken AI turn normally uses three requests.

### Voice apps: ordinary HTTP, no extra infrastructure

Use the helpers above **only on the server**. The existing AI Cloud switch enables voice too; no connector, extra
key, WebSocket server, GPU or audio conversion service is needed. Keep project tokens out of the browser.

| Task | Automatic model selection |
| --- | --- |
| English speech (`language: 'en'`, or omitted) | `deepgram/flux-tts:free` → `fish-audio/s2.1-pro-free:free` on availability failure |
| Other spoken languages (e.g. `language: 'ja'`) | `fish-audio/s2.1-pro-free:free` |
| Mono, 16 kHz, 16-bit PCM WAV transcription | `meta/muse-voice-transcribe-1.0` → Fish → Whisper |
| Other WAV, MP3, MP4/M4A, FLAC, Ogg transcription | `fish-audio/transcribe-1` → `openai/whisper-1` |
| WebM browser recordings | `openai/whisper-1` (Fish rejects WebM) |
| AAC transcription | `fish-audio/transcribe-1` |

An explicit `model` disables fallback and must accept the supplied format. TTS `voice` also pins Flux; examples
are `flux-paige-en` (default), `flux-alexis-en`, `flux-kai-en`, `flux-marcus-en`, `flux-meena-en`, `flux-wade-en`.
Omit `voice` for Fish; it selects its own default. Set `language` explicitly for non-English speech; it selects a
multilingual model but does not translate text. Supply text in the language you want spoken. Voice cloning and
provider-specific options are not part of this helper. Free speech models have provider limits and no guaranteed
availability; there is no automatic upgrade to paid speech. Transcription uses the owner's AI allowance.

**Transcription route**, for example `src/routes/api/voice/transcribe.ts`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { ai } from '@/lib/ai'
import { currentUser } from '@/lib/session.server'

export const Route = createFileRoute('/api/voice/transcribe')({
  server: { handlers: { POST: async ({ request }) => {
    if (!await currentUser()) return Response.json({ error: 'Please sign in' }, { status: 401 })
    try {
      const form = await request.formData()
      const audio = form.get('file')
      if (!(audio instanceof Blob)) return Response.json({ error: 'Select an audio file' }, { status: 400 })
      return Response.json(await ai.transcribe({ audio }, request.signal), { headers: { 'cache-control': 'no-store' } })
    } catch {
      return Response.json({ error: 'Could not transcribe this recording. Try a shorter clip or another format.' }, { status: 502 })
    }
  } } },
})
```

**Speech route**, `src/routes/api/voice/speech.ts`, follows the same authorization pattern. Its POST handler reads
`{ text, language }` from JSON and returns `await ai.generateSpeech({ text, language }, request.signal)` directly.
Do not JSON-serialize that Response, use a server function to return it, or put its bytes into a database text field.
For public apps, apply the app's own guest rate limits instead of removing authorization without a replacement.

**Browser recording and upload:** use `navigator.mediaDevices.getUserMedia({ audio: true })` after a Record
button click. Select a supported MediaRecorder MIME type using `MediaRecorder.isTypeSupported`, preferring
`audio/webm;codecs=opus`, then `audio/mp4`. If neither works, offer file upload. Preserve `recorder.mimeType`
in the resulting Blob; do not rename WebM bytes to `.wav`. Collect `dataavailable` chunks, call
`recorder.start(250)`, and stop when the user clicks Stop, after 60 seconds, or before accumulated chunks exceed
10 MiB. In `stop`, `error`, cancel and unmount cleanup, call `stream.getTracks().forEach(track => track.stop())`
and clear timers. Create the Blob only after the recorder's final `dataavailable` and `stop` events.

```ts
// recordedBlob is the completed MediaRecorder Blob, with its original MIME type.
const form = new FormData()
form.set('file', recordedBlob)
const response = await fetch('/api/voice/transcribe', { method: 'POST', body: form })
const result = await response.json()
if (!response.ok) throw new Error(result.error ?? 'Transcription failed')
// Show result.text in an editable field. Empty text means no speech was recognized.
```

Do not set `Content-Type` on a FormData upload; the browser supplies the boundary. Show clear states for recording,
uploading, processing and failure. Recording needs HTTPS (or localhost), a real user permission grant, and a
supported browser. MonstarX's preview iframe allows the microphone. If the embedded browser blocks access, use
the preview's Open in new tab button. Offer file upload when recording is unavailable or denied.

**Playback:** POST text to the app's speech route; read the result as a Blob and use it with `<audio controls>`.

```ts
const response = await fetch('/api/voice/speech', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'Hello!', language: 'en' }),
})
if (!response.ok) throw new Error('Speech generation failed')
const url = URL.createObjectURL(await response.blob())
// Assign url to <audio controls src={url}>. Revoke the previous URL on replacement/unmount.
```

Use a Play button or audio controls: browsers may block automatic playback after an asynchronous call. Revoke
object URLs and stop old playback when starting a new recording. Generated audio is not stored automatically;
use the app's storage helper if the user explicitly wants to save it.

For a **voice conversation**, compose `transcribe → generateText → generateSpeech` on authorized server routes.
Keep the recognized transcript and reply text visible, manage the conversation history in the app, and instruct
the text model to give short, plain-text spoken replies (e.g. `maxTokens: 300`). A speech failure should leave the
text reply usable. The API returns a complete MP3; it does not provide continuous listening, live partial captions,
automatic interruptions, phone calling, or full-duplex speech. These are recorded, turn-based interactions.

## Country data

Live public data — weather, transport, places and addresses, business registries, prices, holidays, public health and
more — from the country data servers MonstarX hosts, for Singapore (`sg`), Japan (`jp`), Malaysia (`my`), India
(`in`), Indonesia (`id`), the UAE (`uae`) and the Philippines (`ph`). No account and no key.

- Only for the countries the owner switched on in Backend → Country data. A country that is off answers 403: ask for
  it with `request_country_data` instead of writing calls to it, and never call a government API yourself instead.
- `import { countryData } from '@/lib/monstarx/country-data'` in server functions and server routes.
- `await countryData.call('sg', 'sg_carpark_availability')` or `await countryData.call('jp', 'jp_postal_code', { code })`
  returns what the tool answered. The country servers answer JSON with the data and where it came from, usually
  `{ source, retrieved_at, license, agency, data }`, and the shape of `data` is each tool's own: call the tool with
  `call_mcp_tool` (server `country:<id>`) and read its real answer before writing the code that uses it.
- `await countryData.tools('sg')` lists a country's tools with the JSON Schema of their arguments. The builder sees the
  same list with `list_mcp_tools`. Tool names start with the country (`sg_`, `jp_`, …); India's also have state tools
  (`ka_`, `mh_`, `dl_`, …) and the UAE's emirate ones (`dubai_`, `abudhabi_`, …).
- A call that does not return data throws `CountryDataError` with a `status`: 403 the country is off, 422 the tool
  refused the arguments (its message says why: an unknown postal code, a missing argument), 429 the day's calls are
  spent, 502 the data service could not be reached. Catch it where the data is shown and show what is wrong in the
  app's own words; never let it blank the page.
- Each app may make 5,000 calls a day. The data is live, so read it when a page is opened or on a refresh button, and
  keep what the app needs to remember (a user's saved car park, a price history) in its own database.
- Show the source the answer names (`source`, `agency`, `license`) somewhere near the data, as the open data licences
  ask.
- Times inside `data` are usually the country's local time, often with no offset (data.gov.sg's `update_datetime` is
  Singapore time): add the country's offset before comparing them with `Date.now()`, or show them as they are.

## Maps

Every app can show a map. Nothing has to be connected, there is no API key, and there is no setup: the basemap
comes from OpenFreeMap (OpenStreetMap data, no registration, no request limits, commercial use allowed) and the
country outlines ship inside the app. **Never draw a map by hand** — no hand-written SVG continents, no
hard-coded country paths, no `<div>` grid pretending to be a globe. Use these two components.

### `<WorldMap>` — choose a country, or colour the world by a number

`import { WorldMap } from '@/lib/monstarx/world'`

This is the right component whenever the map is about countries: a region picker, "where is the news from",
coverage, sales by market, a travel list. It draws real country outlines as SVG, so it needs no API key, no
network and no WebGL, and it renders in a screenshot.

```tsx
import { useState } from 'react'
import { WorldMap, countryName, type Country } from '@/lib/monstarx/world'

const [country, setCountry] = useState<Country | null>(null)

<WorldMap
  selected={country?.code}
  onSelect={setCountry}          // Country | null (clicking the selected country clears it)
  values={{ JP: 42, BR: 17 }}    // optional: colours countries by a number, keyed by ISO alpha-2
  className="w-full"
/>
{country ? <h2>Top stories from {countryName(country)}</h2> : <p>Pick a country on the map.</p>}
```

- `Country` is `{ code, code3, name, region, subregion, lat, lon }` — `code` is the ISO alpha-2 ("JP"), which is
  what every prop here works in. `name` is English: wherever people read a country's name, show
  `countryName(country)` (or `countryName('JP')`), which names it in the page's language (`<html lang>`: "日本",
  "Japão", "일본") — the map's tooltip and labels already do.
- Countries are keyboard reachable and announce their name, so a map is never the only way to choose one.
- Other props: `highlight` (codes drawn in the accent colour), `disabled`, `markers` (`{ lat, lon, label }`),
  `focus` (a country code, a region name such as `'Europe'`, or a lat/lon box) to frame part of the world,
  `projection` (`'natural'`, `'equirectangular'`, `'mercator'`), `colors`, `formatTooltip`, and `children`
  rendered over the map for a legend.
- Pair it with a search box: `searchCountries(query)` returns matching countries, `findCountry(query)` the best
  single match for an ISO code or a name — in English or in the page's language.

### `<Map>` — a street map you can pan and zoom

`import { Map } from '@/lib/monstarx/map'`

For addresses, pins, routes and "what is near here".

```tsx
import { Map } from '@/lib/monstarx/map'

<Map
  center={{ lat: 35.68, lon: 139.69 }}
  zoom={11}
  style="streets"                                  // 'light' | 'dark' | 'terrain' | 'satellite'
  markers={venues.map((v) => ({ id: v.id, lat: v.lat, lon: v.lon, label: v.name }))}
  onMarkerClick={(marker) => setOpenId(marker.id!)}
  className="h-[28rem] w-full"
/>
```

- A map needs a height. `className` sets the box and defaults to `h-96 w-full`.
- `fit={points}` frames every point instead of using `center`/`zoom`. `onMapClick` gives the clicked
  `{ lat, lon }`, `onMove` the view after a pan or zoom, `interactive={false}` makes a still map.
- The map is drawn in the browser only; the page still server-renders, and a browser without WebGL gets a
  readable message instead of an empty box.
- Markers are diffed by `id`, so adding one does not rebuild the rest.

### What still needs a connector

- **Turning an address into coordinates** (geocoding), directions and places search are not built in. Store the
  latitude and longitude you already have, or ask for the Mapbox or Google Maps connector with
  `request_connector` and follow its guide. Country and region lookup needs nothing: use `findCountry()`.
- **Satellite imagery** needs the Mapbox connector. Without it `style="satellite"` shows the detailed street map.
- When the **Mapbox connector is connected, `<Map>` uses Mapbox's styles by itself.** There is nothing to change
  in the app, and no reason to load Mapbox GL JS from a CDN or to read `PUBLIC_MAPBOX_ACCESS_TOKEN` yourself.

## The owner's own Cloudflare account

Some apps run on their owner's own Cloudflare account instead of MonstarX's: their Worker, their D1 database, their
domain, their bill. That is the **Cloudflare connector**, and it also opens up every Cloudflare service to the app's
code through one managed helper.

```ts
import { cloudflare } from '@/lib/monstarx/cloudflare' // server code only
```

**Add a service before you use it.** `cloudflare_service({ service: 'kv', name: 'sessions' })` creates it on their
account, binds it to the published Worker and makes it work in the preview at once, then answers with the binding
name and a snippet. Calling it again for the same name is harmless. Without a connected Cloudflare account the tool
says so; ask for it with `request_connector('cloudflare', required: true)` and build everything that does not depend
on it in the meantime.

| Service | `service` | What the app gets |
| --- | --- | --- |
| KV | `kv` | `cloudflare.kv(name)` — `get`, `getJson`, `put(key, value, { expirationTtl, metadata })`, `delete`, `list({ prefix, limit, cursor })` |
| R2 | `r2` | `cloudflare.r2(name)` — `put`, `get`, `text`, `delete`, `list` |
| Queues | `queue` | `cloudflare.queue(name)` — `send(body)`, `sendBatch([...])` |
| Vectorize | `vectorize` | `cloudflare.vectorize(name)` — `upsert`, `query`, `getByIds`, `deleteByIds` |
| Workers AI | `ai` | `cloudflare.ai` — `run(model, input)`, `text(model, { prompt })`, `embed(model, [text])`, `image(model, input)` |
| Browser Rendering | `browser` | `cloudflare.browser` — `screenshot`, `pdf`, `markdown`, `content`, `links`, `scrape`, `json` |
| Images | `images` | `cloudflare.images` — `upload`, `get`, `delete`, `url(id, variant)` |
| Analytics Engine | `analytics` | `cloudflare.analytics(name)` — `write({ blobs, doubles, indexes })`, `query(sql)` |

Anything else Cloudflare offers: `cloudflare.api(method, path, body)` with `cloudflare.accountId`, e.g.
``cloudflare.api('GET', `/accounts/${cloudflare.accountId}/workers/scripts`)``.

```ts
// Semantic search over the app's own records.
const [vector] = await cloudflare.ai.embed('@cf/baai/bge-base-en-v1.5', [query])
const { matches } = await cloudflare.vectorize('docs').query(vector!, { topK: 5 })
const rows = await db.select().from(docs).where(inArray(docs.id, matches.map((m) => m.id)))
```

**The rules**

- **Server code only.** These calls carry the owner's Cloudflare token; never import this file into a component or
  anything the browser loads, and never put `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` into a `PUBLIC_*`
  value, a page, a log line or an error message shown to a user.
- **The app's records still belong in the database.** Use MonstarX's database, file storage and AI for the ordinary
  cases — they need nothing connected. Reach for Cloudflare's own when the owner asked for their account, or for
  something with no MonstarX equivalent: a queue, a vector index, a real browser.
- **KV is eventually consistent**: never store something the very next request has to read back.
- **Vectorize writes are applied a moment later**: do not upsert and immediately query for the same id.
- **Analytics Engine only records from the published app.** In a preview `write()` is a no-op that says so in the
  log — which is fine, it is telemetry. `query()` works everywhere.
- **A missing service is a clear error, not a crash.** If the helper says a service is not set up, add it with
  `cloudflare_service`; do not work around it with raw `fetch` calls to api.cloudflare.com.
- The published app and the preview use **different databases**: the preview keeps its practice data on MonstarX,
  and the live app has the owner's own D1 on their account, which starts empty and gets every migration applied.

## Firebase

Only when the owner has connected the **Firebase** connector (Backend → Cloud). It is their own Firebase project:
the data, accounts and files in it are already theirs, and this app reads and writes them through
`src/lib/monstarx/firebase.ts`, **server code only**.

```ts
import { firestore, firebaseAuth, firebaseStorage, firebaseMessaging, firebaseRealtime } from '@/lib/monstarx/firebase'
```

Never add the `firebase` or `firebase-admin` package (they are not installed, and firebase-admin cannot run on
Cloudflare Workers), never load the SDK from a CDN, and never read `FIREBASE_SERVICE_ACCOUNT` yourself: it is the
key to the owner's whole Firebase project and must never reach the browser. Everything below is plain `fetch`
against Firebase's REST APIs, so it works the same in the preview and in the published app.
`firebaseConnected()` is true when there is a project to talk to and `firebaseProjectId()` names it; every call
throws one readable "Firebase is not connected yet" error when there is not.

### `firestore` — documents

Values are ordinary JavaScript: strings, numbers, booleans, `null`, `Date`, arrays and nested objects go in and
come back as themselves (Firestore's typed values and string-encoded whole numbers are handled for you). Every
document comes back with its `id`, and `id` is never written as a field. A collection path may name a
subcollection: `users/${uid}/orders`.

```ts
const post = await firestore.add('posts', { title, authorId: user.id, createdAt: new Date(), votes: 0 })
const one = await firestore.get<Post>('posts', id)                       // null when there is no such document
const mine = await firestore.query<Post>('posts', {
  where: [['authorId', '==', user.id], ['published', '==', true]],       // ==, !=, <, <=, >, >=, in, not-in,
  orderBy: 'createdAt', direction: 'desc', limit: 20,                    // array-contains, array-contains-any
})
await firestore.update('posts', id, { title })      // only the fields you pass; fails if the document is gone
await firestore.set('posts', id, post)              // replaces the whole document, creating it if needed
await firestore.increment('posts', id, 'votes', 1)  // adds to a number without reading it first
await firestore.remove('posts', id)
await firestore.count('posts', [['published', '==', true]])              // counts without reading the documents
await firestore.list<Post>('posts', { limit: 50, orderBy: 'createdAt', direction: 'desc' })
await firestore.collections()                                            // the collection names that exist
await firestore.writeMany('posts', rows)                                 // many at once (seeding, importing)
```

- `list` reads at most 200 documents when no limit is given: page with `query({ limit, offset })`.
- `writeMany` takes documents with or without an `id` (Firestore names the ones without) and sends 200 per
  request, so seeding a collection is a handful of calls rather than one per row.
- A query that combines a range (`<`, `>`, `<=`, `>=`) with other conditions, or orders by another field, needs a
  composite index. Firestore answers the first such query with an error containing a link that creates it; pass
  that link on to the owner rather than silently dropping the condition.
- Firestore charges per document read, so query with a `where` and a `limit` instead of reading a collection and
  filtering in JavaScript, and use `count` for totals.
- A document holds at most 1 MiB. Keep files in `firebaseStorage` and their path in the document.

### `firebaseAuth` — the owner's Firebase accounts

Sign-in happens in server functions, so the tokens never sit in the browser's storage: sign in, then keep the
tokens in an httpOnly cookie of this app.

```ts
const session = await firebaseAuth.signIn({ email, password })   // { uid, email, idToken, refreshToken, expiresAt }
const session = await firebaseAuth.signUp({ email, password, displayName })
const user = await firebaseAuth.verifyIdToken(session.idToken)   // checks Google's signature, this project and expiry
const fresh = await firebaseAuth.refresh(session.refreshToken)   // id tokens last an hour
await firebaseAuth.sendPasswordReset(email)                      // Firebase sends the email
```

- `signIn`, `signUp`, `refresh` and `sendPasswordReset` need the web API key in the connector; the calls below
  use the key file and act as the project's administrator: `getUser`, `getUserByEmail`, `listUsers`,
  `createUser`, `updateUser`, `deleteUser`, `setClaims`.
- Failures arrive as sentences to show people ("That email address and password do not match an account.").
  Firebase deliberately does not say which half was wrong, and a password reset for an unknown address succeeds
  silently — never tell a visitor whether an address has an account.
- `verifyIdToken` is what protects a page: never trust a uid the browser sent.
- MonstarX's own Auth (`requireUser()`, `authClient`) keeps working; use **one** of the two for a given app, and
  Firebase's only when the owner's people already have Firebase accounts.

### `firebaseStorage` — files in the Firebase bucket

Cloud Storage needs the owner's Firebase project to be on the pay-as-you-go Blaze plan, and a bucket to have been
created in the console; without one, every call here says so. MonstarX's own `storage` helper needs neither.

```ts
const file = await firebaseStorage.put(`receipts/${id}.pdf`, bytes, { contentType: 'application/pdf' })
file.url                                   // a URL that serves the file, safe to store and link
await firebaseStorage.get(path)            // { body, contentType, size } or null
await firebaseStorage.list('receipts/')    // up to 1000 files
await firebaseStorage.remove(path)
```

### `firebaseMessaging` — push notifications

```ts
await firebaseMessaging.send({ token: deviceToken, title: 'Order shipped', body: 'On its way', data: { orderId } })
await firebaseMessaging.send({ topic: 'news', title: 'New issue out' })
```

Sending works from here; **getting** a device token in a web browser needs the Firebase JavaScript SDK, which this
app does not have. Send to tokens the app was given (from the owner's mobile app, say) or to a topic, and say so
plainly rather than building a web push sign-up that cannot work.

### `firebaseRealtime` — the Realtime Database

Only when the connector has a database URL. `firebaseRealtime.get(path)`, `.set(path, value)`,
`.update(path, patch)`, `.push(path, value)` (returns the new key) and `.remove(path)`. Firestore is the usual
choice; use this one when the owner's data is already in it.

### When something is not set up in Firebase

The helper turns Google's refusals into sentences: a project with no Firestore database, a query that needs an
index, a sign-in method that is switched off, a service account without permission. Show that message rather than
a blank page, and tell the owner what to switch on in the Firebase console.

`firebaseClient(config)` builds a client for a *different* Firebase project (a second key file kept as a secret).
`parseServiceAccount`, `firebaseConfigFrom`, `toFirestoreValue`, `toFirestoreFields`, `fromFirestoreValue` and
`fromFirestoreFields` are the pieces it is made of; app code rarely needs them.

## Publishing on Vercel

The owner can connect Vercel under **Publish → Other hosting → Vercel**, then deploy a preview or production version and manage that Vercel project's domains and environment variables. This is a publishing connection held by MonstarX: the Vercel access token is not an app secret, is never available to this code, and should never be requested with `request_connector` for use in `process.env`.

MonstarX supplies a TanStack Start/Nitro build configuration for this app's Vercel deployment. Its database, mail, AI and file storage still use the MonstarX host through the managed service URLs and token; they are not automatically replaced by Vercel storage products. User-defined secrets from Backend → Secrets are synchronized to encrypted Vercel environment variables on each deploy. Changes to those values need a new deployment. Variables with a `VITE_` prefix may be included in browser code, so they must hold public values only.

## Configuration and secrets

- Secrets the owner adds under Backend → Secrets, and the keys of connected services, are environment variables:
  read `process.env.NAME` in server code only.
- `PUBLIC_*` values may reach the browser: `const env = await getPublicEnv()` (from `@/lib/config`) in a route loader.
- MonstarX sets `MONSTARX_DATA_URL`, `MONSTARX_DATA_TOKEN`, `MONSTARX_MAIL_URL`, `MONSTARX_AI_URL`,
  `MONSTARX_STORAGE_URL`, `MONSTARX_COUNTRY_DATA_URL` and `BETTER_AUTH_SECRET`, plus `MONSTARX_PREVIEW=1` in previews, and
  `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `MONSTARX_CF_RESOURCES` when a Cloudflare account is
  connected. The helpers above use them: never read, print or replace them yourself. Names starting with
  `MONSTARX_`, `BETTER_AUTH_` or `CLOUDFLARE_` are reserved.

## The preview, and what your tools can see

- The preview is this app's dev server. A saved change reloads in place, and the dev server regenerates
  `src/routeTree.gen.ts` from `src/routes`.
- `view_page` gets a page the way a signed-out visitor's first request does: the HTML rendered on the server, without
  cookies and without running the page's JavaScript afterwards. Content that loads later in the browser, and anything
  behind sign-in, is not in it.
- `read_logs` shows the dev server's latest output: server errors, failed requests and `console.log` calls in server
  code. The browser's console is not in it.
- `check_project` renders every page that has no URL parameters and runs the TypeScript check.
- Nothing you have can sign in, click, pay or receive an email. Call something fixed only when a tool showed it;
  otherwise say what you changed and what the user should try.


## Reliable exports and structured AI

Use `import { copyText } from '@/lib/monstarx/clipboard'` for copy/export buttons. Await `copyText(value)` from the click handler, close the export menu and show success only after it resolves. Catch failure, show the error and offer selectable text or a download. It attempts the Clipboard API and a browser fallback; neither permission nor success is assumed.

For AI data that drives the UI or is saved, validate the shape at runtime:

```ts
const architecture = await ai.generateJson({
  prompt: 'Return a concise architecture for this project.',
  schema: architectureSchema,
})
```

`schema` is converted to JSON Schema and sent to a provider that supports structured output; Zod also checks the returned value locally. `validate` stays on the server for checks such as references to other records. `generateJson` tolerates a JSON markdown fence and retries invalid JSON or schema output once with validation feedback. Set `repair: false` to disable repair. Successful calls do not add another model call. Network, authentication and quota errors are not retried by this helper. A response cut off by the output limit gets a distinct error. Show recoverable errors in the UI; log the underlying cause server-side instead of discarding it.

Reuse `useAction`/`useOptimisticAction` for writes, including loading, double-click protection, errors and refresh. Await critical persistence first. Treat optional receipt/notification delivery as a separate outcome: a failed email must not make a completed booking appear unsaved. Never put required security actions (OTP delivery or verification) in that optional path.
