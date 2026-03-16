const CACHE_NAME = 'savewave-v9';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/main.js',
    '/arma3-Photoroom.png'
];

// Kurulum — statik dosyaları cache'e al
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Aktivasyon — eski cache'leri temizle
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — önce cache, yoksa network
self.addEventListener('fetch', (event) => {
    // API isteklerini cache'leme, direkt network'e git
    if (event.request.url.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                // Başarılı statik dosyaları cache'e ekle
                if (response.status === 200 && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => {
                // Offline sayfası
                return caches.match('/index.html');
            });
        })
    );
});
