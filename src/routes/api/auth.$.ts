import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '@/lib/auth'

/** Better Auth endpoints for this app: /api/auth/* (sign-up, sign-in, session, sign-out). */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }) => (await getAuth()).handler(request),
      POST: async ({ request }) => (await getAuth()).handler(request),
    },
  },
})
