import { createFileRoute } from '@tanstack/react-router'
import { currentUser } from '@/lib/session.server'
import { storage } from '@/lib/storage'

/**
 * GET /api/files/<key> — serves this app's stored files. Public keys redirect to their direct
 * URL; everything else is streamed only to signed-in users. Apps that need finer rules can add
 * their own route and call storage.get() themselves.
 */
export const Route = createFileRoute('/api/files/$')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = decodeURIComponent(params._splat ?? '')
        if (!key) return new Response('Not found', { status: 404 })
        if (key.startsWith('public/')) return Response.redirect(storage.publicUrl(key), 302)
        if (!(await currentUser())) return new Response('Sign in to access this file', { status: 401 })
        const file = await storage.get(key)
        if (!file) return new Response('Not found', { status: 404 })
        return new Response(file.body, { headers: { 'content-type': file.contentType, 'cache-control': 'private, no-cache' } })
      },
    },
  },
})
