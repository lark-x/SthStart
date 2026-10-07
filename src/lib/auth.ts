// SERVER-ONLY. Better Auth for this app's users, stored in the app's own database.
// Email + password is enabled; the users can be managed from MonstarX's Backend tab.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, genericOAuth, oauthPopup } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import * as authSchema from '../db/auth-schema'
import { framedSignIn } from './auth-popup'
import { getDb } from './db'
import { sendEmail } from './email'

async function create() {
  const db = await getDb()
  // Continue with Google, when the owner turns it on in MonstarX (Backend → Cloud → Auth). MonstarX sets either the
  // owner's own Google app (MONSTARX_GOOGLE_*) or MonstarX Google, which signs in through MonstarX (MONSTARX_SIGN_IN_*).
  // Both are the provider `google`: `authClient.signIn.social({ provider: 'google', callbackURL: '/' })`.
  const googleClientId = process.env.MONSTARX_GOOGLE_CLIENT_ID
  const googleClientSecret = process.env.MONSTARX_GOOGLE_CLIENT_SECRET
  const signInUrl = process.env.MONSTARX_SIGN_IN_URL
  const signInClientId = process.env.MONSTARX_SIGN_IN_CLIENT_ID
  const signInSecret = process.env.MONSTARX_SIGN_IN_SECRET
  const monstarxGoogle =
    !(googleClientId && googleClientSecret) && signInUrl && signInClientId && signInSecret
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'google',
                clientId: signInClientId,
                clientSecret: signInSecret,
                authorizationUrl: `${signInUrl}/authorize`,
                tokenUrl: `${signInUrl}/token`,
                userInfoUrl: `${signInUrl}/userinfo`,
                scopes: ['openid', 'email', 'profile'],
                pkce: true,
              },
            ],
          }),
        ]
      : []
  // Inside a frame (the MonstarX preview) Google sign-in runs in a pop-up: ./auth-popup.ts.
  const google = Boolean(googleClientId && googleClientSecret) || monstarxGoogle.length > 0
  const popup = google ? [framedSignIn(), oauthPopup()] : []
  return betterAuth({
    appName: 'App',
    baseURL: process.env.BETTER_AUTH_URL || undefined,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Password reset works out of the box: the link is emailed through MonstarX's email service.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your password',
          text: `Hi ${user.name || 'there'},\n\nReset your password with this link (valid for one hour):\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
        })
      },
    },
    ...(googleClientId && googleClientSecret ? { socialProviders: { google: { clientId: googleClientId, clientSecret: googleClientSecret, prompt: 'select_account' as const } } } : {}),
    // Someone who signed up with email and later continues with Google (same verified address) stays one user.
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    plugins: [admin(), ...monstarxGoogle, ...popup, tanstackStartCookies()],
    // A MonstarX preview runs in a frame of the MonstarX workspace, on another site, where browsers drop SameSite=Lax
    // cookies: sign-in would create a session the app never sees again. Previews use cross-site cookies partitioned to
    // the workspace; published apps keep Better Auth's first-party defaults.
    advanced: process.env.MONSTARX_PREVIEW === '1' ? { defaultCookieAttributes: { sameSite: 'none', secure: true, partitioned: true } } : undefined,
  })
}

export type AppAuth = Awaited<ReturnType<typeof create>>

let instance: Promise<AppAuth> | null = null

export function getAuth(): Promise<AppAuth> {
  instance ??= create().catch((error: unknown) => {
    instance = null
    throw error
  })
  return instance
}
