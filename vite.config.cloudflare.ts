import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// monstarx:tailwind-sources
// Tailwind makes a stylesheet from the class names it finds in every file under the project, and it only
// honours .gitignore inside a git repository, which a workspace is not. Left alone it reads the build's own
// output: a publish builds the browser half first, the server half then finds class-like words in that
// bundle ("t.filter!==…"), makes a different stylesheet under a different name, and the page links a file
// that was never uploaded — unstyled until its scripts load. So every stylesheet that loads Tailwind is told
// to skip build output, caches and MonstarX's own tooling. MonstarX copies this block, as it is, into the
// preview's vite.config.ts and the publish build's vite.config.cloudflare.ts.
const NOT_APP_SOURCES = [
  // Build output and caches: what the build itself writes, so never the same for its two halves.
  'dist',
  '.wrangler',
  '.tanstack',
  '.data',
  // MonstarX's own files: the same for every app, and no class in them is ever the app's.
  '.monstarx-dev-env',
  'MONSTARX.md',
  'monstarx-inspector.js',
  'monstarx-proxy.mjs',
  'vite.config.ts',
  'vite.config.cloudflare.ts',
  'wrangler.jsonc',
]
function tailwindAppSources(): Plugin {
  let root = process.cwd()
  return {
    name: 'monstarx-tailwind-sources',
    enforce: 'pre',
    configResolved(config) {
      root = config.root
    },
    transform(code, id) {
      const file = id.split('?')[0] ?? id
      // The stylesheets Tailwind itself compiles: .css files, but not ?raw, ?url, workers or CommonJS proxies.
      if (!file.endsWith('.css') || /[?&](?:worker|sharedworker|raw|url)\b|\?commonjs-proxy|\/\.vite\//.test(id)) return null
      if (!/@import\s+['"]tailwindcss(?:\/utilities(?:\.css)?)?['"]|@tailwind\s+utilities/.test(code)) return null
      const skipped = NOT_APP_SOURCES.map((entry) => {
        const relative = path.relative(path.dirname(file), path.join(root, entry)).split(path.sep).join('/')
        return '@source not ' + JSON.stringify(relative.startsWith('.') ? relative : './' + relative) + ';'
      })
      return { code: code + '\n' + skipped.join('\n') + '\n', map: null }
    },
  }
}
// /monstarx:tailwind-sources

// Used by `npm run deploy`: builds the app as a Cloudflare Worker (SSR in workerd).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  // Keep MapLibre out of Vite's dependency pre-bundler in dev. The managed <Map> component
  // imports its worker with ?worker&url so published builds emit the worker and its shared module.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // tailwindAppSources must come before tailwindcss: both run first ("pre"), in this order.
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tailwindAppSources(), tailwindcss(), tanstackStart(), viteReact()],
})
