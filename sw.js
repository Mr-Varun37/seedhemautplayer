const CORE_CACHE = "seedhemaut-core-v1";
const AUDIO_CACHE = "seedhemaut-audio-v1";
const CORE_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./responsive.css",
    "./script.js",
    "./app.js",
    "./catalog.js",
    "./database.js",
    "./pwa.js",
    "./storage.js",
    "./utils.js",
    "./songs.json",
    "./manifest.json",
    "./icons/play.svg",
    "./icons/pause.svg",
    "./icons/next.svg",
    "./icons/prev.svg",
    "./icons/shuffle.svg",
    "./icons/repeat.svg",
    "./icons/favorite.svg",
    "./icons/random.svg",
    "./icons/app-icon.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.pathname.includes("/songs/")) {
        event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
        return;
    }
    event.respondWith(networkFirst(event.request, CORE_CACHE));
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
}

