import { createFileRoute } from '@tanstack/react-router'
import { appPagePaths, seoConfig, sitemapXml } from '@/lib/monstarx/seo'

/** GET /sitemap.xml — every page of the app that can be indexed (managed by MonstarX; see the SEO/GEO tab). */
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: () => {
        if (!seoConfig.sitemap.enabled || !seoConfig.indexable) return new Response('Not found', { status: 404 })
        return new Response(sitemapXml(appPagePaths()), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=300' } })
      },
    },
  },
})
