/**
 * Search engines and AI answer engines, for every MonstarX app.
 *
 * The app's owner fills this in from the SEO/GEO tab of the workspace; MonstarX writes what they chose to
 * `src/seo.config.ts`, and everything here reads from it — the `<head>` of every page, `/robots.txt`,
 * `/sitemap.xml` and `/llms.txt`. Nothing in this file needs changing to make an app findable: give the pages
 * titles and descriptions in the tab and they appear.
 *
 * An app that has never been through the tab (or whose config file was removed) falls back to `DEFAULT_SEO`,
 * which keeps the app out of the index rather than publishing half-written metadata.
 */

export type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'

/** One question an AI answer engine (or a search result's FAQ block) can quote. */
export interface SeoQuestion {
  q: string
  a: string
}

export interface SeoPageConfig {
  /** The page's path as the router writes it: "/", "/pricing", "/blog/$slug". */
  path: string
  title?: string
  description?: string
  /** Social card for this page; falls back to the app's. */
  image?: string
  /** Keep this page out of search results. */
  noindex?: boolean
  changefreq?: ChangeFrequency
  /** 0 to 1, the sitemap's hint at how important this page is relative to the others. */
  priority?: number
  /** What this page answers, published as FAQPage data for search and AI answer engines. */
  faq?: SeoQuestion[]
  /** What this page is, for AI answers: one or two plain sentences with the facts worth quoting. */
  summary?: string
}

export interface SeoConfig {
  /** Where the app really lives ("https://acme.com"); every canonical, sitemap and social URL is built from it. */
  siteUrl: string
  siteName: string
  defaultTitle: string
  /** How a page's own title is dressed: "%s · Acme". */
  titleTemplate: string
  defaultDescription: string
  keywords: string[]
  /**
   * BCP 47, e.g. "en", "en-GB", "de". Empty until the owner sets it in the SEO/GEO tab: the root route's own language
   * (`<html lang={seoConfig.locale || 'sw-KE'}>`) stands until then.
   */
  locale: string
  themeColor: string
  /** The social card shown when a link is shared (1200×630 works everywhere). */
  image: string | null
  imageAlt: string
  /** "@acme" — the X/Twitter account the card is attributed to. */
  twitterSite: string
  twitterCard: 'summary' | 'summary_large_image'
  /** Off while the app is a preview or the owner is not ready: every page then says noindex. */
  indexable: boolean
  robots: {
    mode: 'allow' | 'block' | 'custom'
    /** Paths crawlers are asked to leave alone ("/admin", "/api/"). */
    disallow: string[]
    /** Whether ChatGPT, Claude, Perplexity and the other answer engines may read the app (see GEO_CRAWLERS). */
    aiCrawlers: 'allow' | 'block'
    /** Used as-is when mode is "custom". */
    custom: string
  }
  sitemap: {
    enabled: boolean
    /** Paths to leave out of the sitemap. */
    exclude: string[]
    /** Extra URLs (paths or absolute) the router does not know about. */
    extra: string[]
  }
  llms: {
    enabled: boolean
    /** The app in a paragraph, for /llms.txt. */
    summary: string
    /** Anything else an answer engine should know: what it costs, who it is for, what it does not do. */
    notes: string
  }
  organization: {
    name: string
    /** schema.org type: Organization, LocalBusiness, SoftwareApplication, Person, … */
    type: string
    logo: string | null
    /** Profiles that are the same entity (LinkedIn, X, GitHub, Crunchbase). */
    sameAs: string[]
    email: string
    phone: string
    address: string
  }
  /** Ownership tokens from the search consoles, published as meta tags. */
  verification: { google: string; bing: string; yandex: string; pinterest: string }
  /** Questions the whole app answers (every page carries them unless the page has its own). */
  faq: SeoQuestion[]
  pages: SeoPageConfig[]
  /** Every page the app routes, as MonstarX read them from src/routes when it last wrote this file. */
  paths: string[]
}

/** The AI answer-engine crawlers robots.txt names one by one, so allowing or blocking them is a decision, not an accident. */
export const GEO_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot', 'cohere-ai', 'Meta-ExternalAgent', 'Amazonbot', 'YouBot', 'DuckAssistBot'] as const

export const DEFAULT_SEO: SeoConfig = {
  siteUrl: '',
  siteName: '',
  defaultTitle: '',
  titleTemplate: '%s',
  defaultDescription: '',
  keywords: [],
  // Not 'en': a default here outranked the language the app was built in (`lang={seoConfig.locale || 'sw-KE'}`), so a
  // Swahili or Hausa app declared English — English country names, an English spell-checker, an English screen reader.
  locale: '',
  themeColor: '',
  image: null,
  imageAlt: '',
  twitterSite: '',
  twitterCard: 'summary_large_image',
  indexable: false,
  robots: { mode: 'allow', disallow: [], aiCrawlers: 'allow', custom: '' },
  sitemap: { enabled: true, exclude: [], extra: [] },
  llms: { enabled: true, summary: '', notes: '' },
  organization: { name: '', type: 'Organization', logo: null, sameAs: [], email: '', phone: '', address: '' },
  verification: { google: '', bing: '', yandex: '', pinterest: '' },
  faq: [],
  pages: [],
  paths: [],
}

// The owner's settings, written by the SEO/GEO tab. Loaded through a glob rather than a plain import so that an app
// without the file (one built before the tab existed) still builds and serves sensible defaults.
const CONFIG_MODULES = import.meta.glob<{ seo?: Partial<SeoConfig>; default?: Partial<SeoConfig> }>('/src/seo.config*.ts', { eager: true })

function loadConfig(): SeoConfig {
  const found = Object.values(CONFIG_MODULES)[0]
  const raw = found?.seo ?? found?.default
  if (!raw) return DEFAULT_SEO
  return {
    ...DEFAULT_SEO,
    ...raw,
    // A preview runs the dev server and a published app is a build, so this keeps the preview address — which changes
    // and is not the app's real home — out of search results however the app itself is set up.
    indexable: raw.indexable === true && !import.meta.env.DEV,
    robots: { ...DEFAULT_SEO.robots, ...raw.robots },
    sitemap: { ...DEFAULT_SEO.sitemap, ...raw.sitemap },
    llms: { ...DEFAULT_SEO.llms, ...raw.llms },
    organization: { ...DEFAULT_SEO.organization, ...raw.organization },
    verification: { ...DEFAULT_SEO.verification, ...raw.verification },
  }
}

/** What the SEO/GEO tab last saved (or `DEFAULT_SEO` where nothing was saved). */
export const seoConfig: SeoConfig = loadConfig()

/**
 * The app's page paths. MonstarX reads them from `src/routes` and writes them into `src/seo.config.ts` after every
 * build that changes the routing, so the sitemap and /llms.txt list the real pages without this module having to pull
 * every route into its own bundle. Pages with parameters keep their `$`; the sitemap drops them, since they have no
 * one URL. Files this module serves (/robots.txt and the rest) are never pages.
 */
export function appPagePaths(config: SeoConfig = seoConfig): string[] {
  return config.paths.filter((path) => !/\.[a-z0-9]{2,5}$/i.test(path.slice(path.lastIndexOf('/') + 1)))
}

/** An absolute URL for a path, against the configured site address (the path itself when no address is set yet). */
export function absoluteUrl(path: string, config: SeoConfig = seoConfig): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  if (/^https?:\/\//i.test(path)) return path
  if (!config.siteUrl) return clean
  return `${config.siteUrl.replace(/\/+$/, '')}${clean === '/' ? '/' : clean.replace(/\/+$/, '')}`
}

/** A path with its parameters filled in ("/blog/$slug" + { slug: 'hello' } → "/blog/hello"). */
function fillParams(path: string, params: Record<string, string> | undefined): string {
  if (!params || !path.includes('$')) return path
  return path
    .split('/')
    .map((segment) => (segment.startsWith('$') ? (params[segment.slice(1)] ?? segment) : segment))
    .join('/')
}

/** One page's settings, with the app's defaults filled in and its title already dressed by the template. */
export interface ResolvedPageSeo {
  path: string
  title: string
  description: string
  noindex: boolean
  image: string | null
  faq: SeoQuestion[]
  summary: string
}

/** The settings for one page: what the tab holds for it, with the app's defaults filled in. */
export function pageSeo(path: string, config: SeoConfig = seoConfig): ResolvedPageSeo {
  const entry = config.pages.find((page) => page.path === path) ?? config.pages.find((page) => page.path === path.replace(/\/+$/, '')) ?? null
  const title = entry?.title?.trim() || config.defaultTitle
  const dressed = entry?.title?.trim() && config.titleTemplate.includes('%s') ? config.titleTemplate.replace('%s', entry.title.trim()) : title
  return {
    path,
    title: dressed,
    description: entry?.description?.trim() || config.defaultDescription,
    noindex: !config.indexable || Boolean(entry?.noindex),
    image: entry?.image ?? config.image,
    faq: entry?.faq?.length ? entry.faq : config.faq,
    summary: entry?.summary?.trim() ?? '',
  }
}

/** What TanStack Router hands a route's `head()`; only the parts this needs. */
export interface SeoHeadContext {
  matches?: Array<{ fullPath?: string; pathname?: string }>
  params?: Record<string, string>
}

interface HeadMeta {
  title?: string
  name?: string
  property?: string
  content?: string
  charSet?: string
}

/**
 * Every tag the `<head>` of a page needs: title, description, canonical, robots, Open Graph, Twitter, the
 * verification tokens and the structured data search and AI answer engines read.
 *
 * Put it in the root route and every page is covered:
 * `createRootRoute({ head: (ctx) => seoHead(ctx), … })`. A page that wants its own title still sets `head()`
 * itself — the deeper route wins.
 */
export function seoHead(context: SeoHeadContext = {}, config: SeoConfig = seoConfig): { meta: HeadMeta[]; links: Array<Record<string, string>>; scripts: Array<{ type: string; children: string }> } {
  const last = context.matches?.[context.matches.length - 1]
  const routePath = last?.fullPath || last?.pathname || '/'
  const page = pageSeo(routePath, config)
  const url = absoluteUrl(fillParams(last?.pathname || routePath, context.params), config)
  const image = page.image ? absoluteUrl(page.image, config) : null

  const meta: HeadMeta[] = [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }]
  if (page.title) meta.push({ title: page.title })
  if (page.description) meta.push({ name: 'description', content: page.description })
  if (config.keywords.length) meta.push({ name: 'keywords', content: config.keywords.join(', ') })
  meta.push({ name: 'robots', content: page.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1' })
  if (config.themeColor) meta.push({ name: 'theme-color', content: config.themeColor })
  if (config.organization.name) meta.push({ name: 'author', content: config.organization.name })

  meta.push({ property: 'og:type', content: routePath === '/' ? 'website' : 'article' })
  if (config.siteName) meta.push({ property: 'og:site_name', content: config.siteName })
  if (config.locale) meta.push({ property: 'og:locale', content: config.locale.replace('-', '_') })
  if (page.title) meta.push({ property: 'og:title', content: page.title })
  if (page.description) meta.push({ property: 'og:description', content: page.description })
  if (config.siteUrl) meta.push({ property: 'og:url', content: url })
  if (image) {
    meta.push({ property: 'og:image', content: image })
    meta.push({ property: 'og:image:alt', content: config.imageAlt || page.title })
  }
  meta.push({ name: 'twitter:card', content: image ? config.twitterCard : 'summary' })
  if (config.twitterSite) meta.push({ name: 'twitter:site', content: config.twitterSite })
  if (page.title) meta.push({ name: 'twitter:title', content: page.title })
  if (page.description) meta.push({ name: 'twitter:description', content: page.description })
  if (image) meta.push({ name: 'twitter:image', content: image })

  for (const [name, token] of [
    ['google-site-verification', config.verification.google],
    ['msvalidate.01', config.verification.bing],
    ['yandex-verification', config.verification.yandex],
    ['p:domain_verify', config.verification.pinterest],
  ] as const) {
    if (token) meta.push({ name, content: token })
  }

  const links: Array<Record<string, string>> = []
  if (config.siteUrl) links.push({ rel: 'canonical', href: url })

  const scripts = structuredData(routePath, config).map((data) => ({ type: 'application/ld+json', children: JSON.stringify(data) }))
  return { meta, links, scripts }
}

/** The JSON-LD a page publishes: who the app belongs to, what the site is, and the questions the page answers. */
export function structuredData(path: string, config: SeoConfig = seoConfig): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const org = config.organization
  if (org.name) {
    const entity: Record<string, unknown> = { '@context': 'https://schema.org', '@type': org.type || 'Organization', name: org.name }
    if (config.siteUrl) entity.url = config.siteUrl
    if (org.logo) entity.logo = absoluteUrl(org.logo, config)
    if (org.sameAs.length) entity.sameAs = org.sameAs
    if (org.email) entity.email = org.email
    if (org.phone) entity.telephone = org.phone
    if (org.address) entity.address = org.address
    if (config.defaultDescription) entity.description = config.defaultDescription
    out.push(entity)
  }
  if (path === '/' && config.siteUrl && config.siteName) {
    out.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: config.siteName, url: config.siteUrl, ...(config.defaultDescription ? { description: config.defaultDescription } : {}) })
  }
  const page = pageSeo(path, config)
  if (page.faq.length) {
    out.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((entry) => ({ '@type': 'Question', name: entry.q, acceptedAnswer: { '@type': 'Answer', text: entry.a } })),
    })
  }
  return out
}

/** The body of /robots.txt. */
export function robotsTxt(config: SeoConfig = seoConfig): string {
  if (config.robots.mode === 'custom' && config.robots.custom.trim()) return `${config.robots.custom.trim()}\n`
  const lines: string[] = []
  if (!config.indexable || config.robots.mode === 'block') {
    lines.push('User-agent: *', 'Disallow: /')
    return `${lines.join('\n')}\n`
  }
  lines.push('User-agent: *')
  for (const path of config.robots.disallow) lines.push(`Disallow: ${path.startsWith('/') ? path : `/${path}`}`)
  lines.push('Allow: /')
  if (config.robots.aiCrawlers === 'block') {
    lines.push('')
    for (const agent of GEO_CRAWLERS) lines.push(`User-agent: ${agent}`, 'Disallow: /', '')
  }
  if (config.siteUrl && config.sitemap.enabled) lines.push('', `Sitemap: ${absoluteUrl('/sitemap.xml', config)}`)
  if (config.siteUrl && config.llms.enabled) lines.push(`# Plain-language summary for AI answer engines: ${absoluteUrl('/llms.txt', config)}`)
  return `${lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n')}\n`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The body of /sitemap.xml for the app's static pages (paths with parameters are left out: they have no one URL). */
export function sitemapXml(paths: string[], config: SeoConfig = seoConfig, now = new Date()): string {
  const excluded = new Set(config.sitemap.exclude)
  const seen = new Set<string>()
  const entries: string[] = []
  const lastmod = now.toISOString().slice(0, 10)
  for (const path of [...paths, ...config.sitemap.extra]) {
    if (path.includes('$') || excluded.has(path)) continue
    const page = config.pages.find((entry) => entry.path === path)
    if (page?.noindex) continue
    const loc = absoluteUrl(path, config)
    if (seen.has(loc)) continue
    seen.add(loc)
    const parts = [`    <loc>${escapeXml(loc)}</loc>`, `    <lastmod>${lastmod}</lastmod>`]
    if (page?.changefreq) parts.push(`    <changefreq>${page.changefreq}</changefreq>`)
    parts.push(`    <priority>${(page?.priority ?? (path === '/' ? 1 : 0.7)).toFixed(1)}</priority>`)
    entries.push(`  <url>\n${parts.join('\n')}\n  </url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`
}

/**
 * The body of /llms.txt: the app explained to an AI answer engine in plain markdown — what it is, what it does,
 * which pages answer what, and the questions it can quote. The convention comes from llmstxt.org.
 */
export function llmsTxt(paths: string[], config: SeoConfig = seoConfig): string {
  const lines: string[] = [`# ${config.siteName || config.defaultTitle || 'This app'}`, '']
  const summary = config.llms.summary.trim() || config.defaultDescription
  if (summary) lines.push(`> ${summary}`, '')
  if (config.llms.notes.trim()) lines.push(config.llms.notes.trim(), '')
  const listed = paths.filter((path) => !path.includes('$') && !config.pages.find((page) => page.path === path)?.noindex)
  if (listed.length) {
    lines.push('## Pages', '')
    for (const path of listed) {
      const page = pageSeo(path, config)
      const label = page.title || (path === '/' ? 'Home' : path)
      const note = page.summary || page.description
      lines.push(`- [${label}](${absoluteUrl(path, config)})${note ? `: ${note}` : ''}`)
    }
    lines.push('')
  }
  if (config.faq.length) {
    lines.push('## Questions this app answers', '')
    for (const entry of config.faq) lines.push(`### ${entry.q}`, '', entry.a, '')
  }
  if (config.organization.name) {
    lines.push('## Who runs it', '', config.organization.name + (config.organization.email ? ` — ${config.organization.email}` : ''), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
