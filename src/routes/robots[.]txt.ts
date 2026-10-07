import { createFileRoute } from '@tanstack/react-router'
import { robotsTxt } from '@/lib/monstarx/seo'

/**
 * GET /robots.txt — the crawl rules from the SEO/GEO tab (managed by MonstarX; change them there, not here).
 * While the app is not marked indexable it asks every crawler to stay away, so an app that is still being built
 * never turns up in search results.
 */
export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () => new Response(robotsTxt(), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } }),
    },
  },
})
