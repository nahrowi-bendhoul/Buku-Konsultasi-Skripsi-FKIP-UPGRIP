/* Service worker: jalan offline. Ubah VERSI setiap kali index.html diganti. */
const VERSI="bk-v1";
const FILE=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","icon-maskable-512.png","apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSI).then(c=>c.addAll(FILE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSI).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
/* Jaringan dulu (supaya pembaruan langsung terpakai), cadangan dari cache bila offline */
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 const u=new URL(e.request.url);if(u.origin!==location.origin)return;
 e.respondWith(fetch(e.request).then(r=>{if(r&&r.ok){const c=r.clone();caches.open(VERSI).then(ch=>ch.put(e.request,c))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(m=>m||caches.match("index.html"))))});
