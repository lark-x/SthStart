import { createFileRoute } from '@tanstack/react-router'
import { appPagePaths, llmsTxt, seoConfig } from '@/lib/monstarx/seo'

/**
 * GET /llms.txt — the app explained to AI answer engines (ChatGPT, Claude, Perplexity, Google's AI answers) in
 * plain markdown, following llmstxt.org. Managed by MonstarX; the wording comes from the SEO/GEO tab.
 */
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET: () => {
        if (!seoConfig.llms.enabled) return new Response('Not found', { status: 404 })
        return new Response(llmsTxt(appPagePaths()), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } })
      },
    },
  },
})
