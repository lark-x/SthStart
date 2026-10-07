// Dedicated preview; does not load .env, stop another server or use production credentials.
import {createServer} from 'vite';
import vinext from 'vinext';
import tailwindcss from '@tailwindcss/postcss';
if(!process.argv.includes('--isolated'))throw new Error('Pass --isolated.');
process.env.STHSTART_SERVICE_URL='http://127.0.0.1:4287';
process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL='http://127.0.0.1:4287';
process.env.STHSTART_ADMIN_TOKEN='publication-isolated-admin-token-12345678';
process.env.STHSTART_SESSION_SECRET='publication-isolated-session-secret-12345678';
process.env.PORTAL_ORIGINS='http://127.0.0.1:4197';
const server=await createServer({configFile:false,envDir:false,cacheDir:'node_modules/.vite-publication-fixture',
  css:{postcss:{plugins:[tailwindcss()]}},plugins:[vinext()],
  server:{host:'127.0.0.1',port:4197,strictPort:true,watch:{ignored:['**/upstream/**']}}});
await server.listen();server.printUrls();
process.on('SIGINT',()=>void server.close().then(()=>process.exit(0)));
process.on('SIGTERM',()=>void server.close().then(()=>process.exit(0)));
