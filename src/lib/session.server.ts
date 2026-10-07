// SERVER-ONLY helpers for the signed-in user. Import this file from src/server/*.ts modules
// (inside server function handlers) and from server routes; never from routes or components.
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getAuth } from './auth'

export interface SessionUser {
  id: string
  email: string
  name: string
  image?: string | null
}

export async function currentUser(): Promise<SessionUser | null> {
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: getRequestHeaders() })
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email, name: session.user.name, image: session.user.image }
}

/** Throws when nobody is signed in; use at the top of server functions that touch user data. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser()
  if (!user) throw new Error('Please sign in to continue')
  return user
}
