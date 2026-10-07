// A second, isolated preview server. Does not stop the user's dev server or load .env.
import { createServer } from 'vite';
import vinext from 'vinext';
import tailwindcss from '@tailwindcss/postcss';
if (!process.argv.includes('--isolated')) throw new Error('Pass --isolated.');
process.env.STHSTART_SERVICE_URL = 'http://127.0.0.1:4289';
process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL = 'http://127.0.0.1:4289';
process.env.STHSTART_ADMIN_TOKEN = 'activity-studio-fixture-token-not-production';
process.env.STHSTART_SESSION_SECRET = 'activity-studio-isolated-session-secret-12345678';
process.env.PORTAL_ORIGINS = 'http://127.0.0.1:4199';
const server = await createServer({ configFile: false, envDir: false, cacheDir: 'node_modules/.vite-studio-fixture',
  css: { postcss: { plugins: [tailwindcss()] } }, plugins: [vinext()],
  server: { host: '127.0.0.1', port: 4199, strictPort: true, watch: { ignored: ['**/upstream/**'] } } });
await server.listen(); server.printUrls();
process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
