import { createAuthClient } from 'better-auth/react'

/**
 * Browser client for this app's accounts.
 *   await authClient.signUp.email({ name, email, password })
 *   await authClient.signIn.email({ email, password })
 *   await authClient.signIn.social({ provider: 'google', callbackURL: '/dashboard' })
 *   await authClient.signOut()
 *   const { data: session } = authClient.useSession()
 */
const client = createAuthClient()

type SocialInput = Parameters<typeof client.signIn.social>[0]
type SocialResult = Awaited<ReturnType<typeof client.signIn.social>>

const POLL_MS = 1000
const GIVE_UP_MS = 5 * 60_000

function randomNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const failure = (message: string) => ({ data: null, error: { message, status: 400, statusText: 'Bad Request' } }) as unknown as SocialResult

/**
 * Google refuses to open inside a frame, and the MonstarX preview shows the app in one: there, signing in with Google
 * opens a pop-up, and the frame collects the session when it is done (./auth-popup.ts) and goes on to `callbackURL`.
 */
async function signInInPopup(input: SocialInput): Promise<SocialResult> {
  const nonce = randomNonce()
  const callbackURL = input.callbackURL ?? '/'
  const start = new URL('/api/auth/oauth-popup/start', window.location.origin)
  start.searchParams.set('provider', input.provider)
  start.searchParams.set('popupOrigin', window.location.origin)
  start.searchParams.set('popupNonce', nonce)
  start.searchParams.set('callbackURL', callbackURL)
  if (input.errorCallbackURL) start.searchParams.set('errorCallbackURL', input.errorCallbackURL)
  if (input.newUserCallbackURL) start.searchParams.set('newUserCallbackURL', input.newUserCallbackURL)
  const popup = window.open(start.toString(), 'monstarx-sign-in', 'popup,width=480,height=640')
  if (!popup) return failure('Allow pop-ups for this page to sign in with Google.')
  const startedAt = Date.now()
  let closedAt: number | null = null
  while (Date.now() - startedAt < GIVE_UP_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const response = await fetch(`/api/auth/monstarx/framed-sign-in?nonce=${nonce}`, { credentials: 'include', cache: 'no-store' }).catch(() => null)
    const result = (await response?.json().catch(() => null)) as { done?: boolean; redirectTo?: string; error?: string } | null
    if (result?.done) {
      if (!popup.closed) popup.close()
      if (result.error) return failure(result.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in did not work. Try again.')
      window.location.href = result.redirectTo ?? callbackURL
      return { data: { url: result.redirectTo ?? callbackURL, redirect: true }, error: null } as unknown as SocialResult
    }
    // The pop-up can close itself a moment before its result is kept: look a few more times before giving up.
    if (popup.closed) closedAt ??= Date.now()
    if (closedAt && Date.now() - closedAt > 3 * POLL_MS) return failure('Google sign-in was cancelled.')
  }
  return failure('Google sign-in took too long. Try again.')
}

const framed = typeof window !== 'undefined' && window.self !== window.top

const signIn = new Proxy(client.signIn, {
  get(target, property, receiver) {
    if (property === 'social' && framed) return (input: SocialInput, options?: Parameters<typeof client.signIn.social>[1]) => (input.provider === 'google' ? signInInPopup(input) : target.social(input, options))
    return Reflect.get(target, property, receiver)
  },
})

export const authClient = new Proxy(client, {
  get(target, property, receiver) {
    return property === 'signIn' ? signIn : Reflect.get(target, property, receiver)
  },
}) as typeof client
