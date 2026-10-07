// Safe to import from routes and components: getSessionUser is a server function (its handler
// only runs on the server). The server-only helpers live in ./session.server.ts.
import { createServerFn } from '@tanstack/react-start'
import { currentUser } from './session.server'

export type { SessionUser } from './session.server'

/** For route loaders and beforeLoad: `const user = await getSessionUser()`. */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(async () => currentUser())

/** How people can sign in to this app, for the sign-in page: show "Continue with Google" when `google` is true. */
export const getSignInOptions = createServerFn({ method: 'GET' }).handler(async () => ({
  google: Boolean(
    (process.env.MONSTARX_GOOGLE_CLIENT_ID && process.env.MONSTARX_GOOGLE_CLIENT_SECRET) ||
      (process.env.MONSTARX_SIGN_IN_URL && process.env.MONSTARX_SIGN_IN_CLIENT_ID && process.env.MONSTARX_SIGN_IN_SECRET),
  ),
}))
