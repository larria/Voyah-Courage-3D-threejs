
const FILES = {"assets/index-DlnrR9iB.js":"097e5978e410b4595489a51930b8149984eb30edeb5533108bb131235f3e6e66","assets/index-ni0sFlVP.css":"321aa0b57bb72d62c8faab07a2646320feb00f2a5b3d4aa6faea3258769f0e61","icons/showroom-192.png":"bfdcb03142f30106f34eecd2533c1f9a1823519f1eb8816435a2045b0804f3f0","icons/showroom-512.png":"bab142edc523730bab884937a80da39a58847fa83b424533aebc888485d5adbb","index.html":"d3588e2ed7b2ea0f5f7fe2f1ae05ee2b89e705e29523a5ed0a9356a3ac337215","interactions.json":"115dcd34d1e078a67b494f62d805f436eeda338ffcd0676b83148473472986cf","manifest.webmanifest":"683f33744ddd75cc7ed3f8f0e8f09291a7a20cb37e08124268252fb4319e4a6c","meshes.npz":"47017e0ae17386dc0058528f8d5dc35a47e55b4a649455c71145cd1242a63cd6","scene.json":"5007e600d9dc2858cc85738a4aa4ba77fe4379cca7da2b1b263e7faee3a2da70","showroom.svg":"b3859a09b92d5530a3d5f7766bc2d26b000879eb6bf63beecebdded23b580305","textures/3_泰山_云米_竖.png":"75fdfa5a6578447ac8ebfb3b01170b5f00176cdfee10f523ccc85c99696522ac","textures/Car_WheelTire.png":"c294b168503b7171eb089ccfef5c61235fc4ee2b327de9f0cc61052f14cbfa54","textures/SDop.png":"13d92becb39825ef586c81019a36eb19bc5cde9052965ff279f55aa0a17d7c6c","textures/贴图.png":"b7909b7901ef13ccd7cf30cfa2a1dc9261871d559d5ff61a06340b7c767f17d9","textures/音箱_A.png":"bb2f3fb3cbedfb1486f6defc8cbc3b024747312143787e17c3b00e30a309c847"};
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
