import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function offlinePlugin() {
  let config;
  return {
    name: 'showroom-offline',
    apply: 'build',
    configResolved(value) { config = value; },
    async writeBundle() {
      const entries = {};
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');

      async function collect(folder, prefix = '') {
        for (const entry of await readdir(folder, { withFileTypes: true })) {
          const name = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await collect(path.join(folder, entry.name), `${name}/`);
          else if (name !== 'sw.js') entries[name] = hash(await readFile(path.join(folder, entry.name)));
        }
      }
      const output = path.resolve(config.root, config.build.outDir);
      // HTML is emitted after generateBundle in Vite 8, so hash final disk output.
      await collect(output);
      // One shared content cache lets new UI versions reuse identical large models.
      const source = `
const FILES = ${JSON.stringify(entries)};
const CACHE = 'voyah-threejs-content-v1';
const SCOPE = new URL(self.registration.scope);
const key = hash => new Request(new URL('_cached/' + hash, SCOPE));
async function asset(name) {
  const cache = await caches.open(CACHE), request = key(FILES[name]);
  const existing = await cache.match(request);
  if (existing) return existing;
  const response = await fetch(new URL(name, SCOPE), {cache: 'no-store'});
  if (!response.ok) throw new Error('Offline resource failed: ' + name);
  const bytes = await response.clone().arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== FILES[name]) throw new Error('Offline resource changed: ' + name);
  await cache.put(request, response.clone());
  return response;
}
self.addEventListener('install', event => event.waitUntil((async () => {
  // Limit concurrent model/texture requests on mobile.
  const names = Object.keys(FILES);
  for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map(asset));
})()));
async function ready(client) {
  const cache = await caches.open(CACHE);
  const complete = (await Promise.all(Object.values(FILES).map(h => cache.match(key(h))))).every(Boolean);
  if (complete) client?.postMessage({type: 'CACHE_READY'});
}
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  for (const client of await self.clients.matchAll()) await ready(client);
})()));
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CACHE_STATUS') event.waitUntil(ready(event.source));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  const name = event.request.mode === 'navigate' ? 'index.html' : decodeURIComponent(url.pathname.slice(SCOPE.pathname.length));
  if (FILES[name]) event.respondWith(asset(name));
});
`;
      await writeFile(path.join(output, 'sw.js'), source);
    },
  };
}
