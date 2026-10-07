// SERVER-ONLY. Google sign-in from inside a frame (the MonstarX preview), used by ./auth.ts.
//
// Google refuses to open inside a frame, so a framed app signs in in a pop-up (./auth-client.ts opens it): Better
// Auth's oauthPopup plugin runs the whole sign-in there. Its own hand-back posts the session to the window that
// opened the pop-up, which Google's pages can cut off, and the frame keeps its cookies apart from the pop-up's. So
// the frame collects the result itself: when the pop-up's sign-in ends, its outcome is kept for two minutes under
// the frame's random nonce, and the frame claims it here, which sets the session cookie in the frame.
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { POPUP_MARKER_COOKIE } from 'better-auth/plugins'

const KEEP_MS = 2 * 60_000
const identifierFor = (nonce: string) => `monstarx-popup:${nonce}`
const NONCE_RE = /^[a-f0-9]{32,128}$/

interface Outcome {
  token?: string
  redirectTo?: string
  error?: string
}

export function framedSignIn() {
  return {
    id: 'monstarx-framed-sign-in',
    endpoints: {
      claimFramedSignIn: createAuthEndpoint('/monstarx/framed-sign-in', { method: 'GET' }, async (c) => {
        const nonce = new URL(c.request?.url ?? 'http://x').searchParams.get('nonce') ?? ''
        if (!NONCE_RE.test(nonce)) return c.json({ done: false })
        const kept = await c.context.internalAdapter.findVerificationValue(identifierFor(nonce))
        if (!kept || new Date(kept.expiresAt).getTime() < Date.now()) return c.json({ done: false })
        await c.context.internalAdapter.deleteVerificationByIdentifier(identifierFor(nonce))
        const outcome = JSON.parse(kept.value) as Outcome
        if (!outcome.token) return c.json({ done: true, error: outcome.error ?? 'sign_in_failed' })
        const found = await c.context.internalAdapter.findSession(outcome.token)
        if (!found) return c.json({ done: true, error: 'sign_in_failed' })
        await setSessionCookie(c, { session: found.session, user: found.user })
        return c.json({ done: true, redirectTo: outcome.redirectTo ?? '/' })
      }),
    },
    hooks: {
      after: [
        {
          matcher: (context: { path?: string }) => Boolean(context.path?.startsWith('/callback/')),
          handler: createAuthMiddleware(async (c) => {
            const marker = await c.getSignedCookie(c.context.createAuthCookie(POPUP_MARKER_COOKIE).name, c.context.secret)
            if (!marker) return
            let nonce = ''
            try {
              nonce = (JSON.parse(marker) as { popupNonce?: string }).popupNonce ?? ''
            } catch {
              return
            }
            if (!NONCE_RE.test(nonce)) return
            const location = c.context.responseHeaders?.get('location') ?? null
            const token = c.context.newSession?.session.token
            const error = location ? new URL(location, c.context.baseURL).searchParams.get('error') : null
            if (!token && !error) return
            const outcome: Outcome = token ? { token, redirectTo: location ?? '/' } : { error: error ?? 'sign_in_failed' }
            await c.context.internalAdapter.createVerificationValue({ identifier: identifierFor(nonce), value: JSON.stringify(outcome), expiresAt: new Date(Date.now() + KEEP_MS) })
          }),
        },
      ],
    },
  }
}
