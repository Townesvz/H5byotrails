// Service Worker voor Hike5 Trail Companion
// Versie 1.0.0

const CACHE_VERSION = 'hike5-v1';
const CACHE_ASSETS = 'hike5-assets-v1';
const CACHE_DATA = 'hike5-data-v1';
const CACHE_IMAGES = 'hike5-images-v1';

// Essentiële bestanden die altijd gecached moeten worden
const ESSENTIAL_FILES = [
  '/',
  '/index.html',
  '/main.jsx',
  '/style.css',
  '/manifest.json'
];

// Install event - cache essentials
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      console.log('[Service Worker] Caching essential files');
      return cache.addAll(ESSENTIAL_FILES);
    }).then(() => {
      // Skip waiting zodat nieuwe service worker meteen actief wordt
      return self.skipWaiting();
    })
  );
});

// Activate event - cleanup oude caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Verwijder oude caches
          if (cacheName !== CACHE_VERSION && 
              cacheName !== CACHE_ASSETS && 
              cacheName !== CACHE_DATA && 
              cacheName !== CACHE_IMAGES) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim clients zodat service worker meteen controle neemt
      return self.clients.claim();
    })
  );
});

// Fetch event - serving strategie
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip externe API calls (bijv. OpenStreetMap)
  if (!url.origin.includes(self.location.origin)) {
    return;
  }

  event.respondWith(
    handleFetch(request)
  );
});

async function handleFetch(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Strategie per bestandstype
  
  // 1. Trail data (JSON, GPX) - Cache first, network fallback
  if (path.includes('/data/trails/') && (path.endsWith('.json') || path.endsWith('.gpx'))) {
    return cacheFirst(request, CACHE_DATA);
  }

  // 2. Images - Cache first, network fallback
  if (path.includes('/data/trails/') && (path.match(/\.(jpg|jpeg|png|webp|svg)$/i))) {
    return cacheFirst(request, CACHE_IMAGES);
  }

  // 3. App assets (JS, CSS) - Network first, cache fallback
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.css')) {
    return networkFirst(request, CACHE_ASSETS);
  }

  // 4. HTML - Network first, cache fallback
  if (path.endsWith('.html') || path === '/') {
    return networkFirst(request, CACHE_VERSION);
  }

  // 5. Alles anders - Network first
  return networkFirst(request, CACHE_ASSETS);
}

// Cache First strategie (voor trail data en images)
async function cacheFirst(request, cacheName) {
  try {
    // Probeer uit cache
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      console.log('[Service Worker] Serving from cache:', request.url);
      
      // Update cache in background (stale-while-revalidate)
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
      }).catch(() => {
        // Netwerk niet beschikbaar, geen probleem
      });
      
      return cached;
    }

    // Niet in cache, haal van netwerk
    console.log('[Service Worker] Fetching from network:', request.url);
    const response = await fetch(request);
    
    if (response && response.status === 200) {
      const responseClone = response.clone();
      cache.put(request, responseClone);
    }
    
    return response;
    
  } catch (error) {
    console.log('[Service Worker] Fetch failed, returning offline fallback:', error);
    
    // Als het een JSON request is, return empty array
    if (request.url.includes('.json')) {
      return new Response('[]', {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Voor andere requests, return offline pagina
    return new Response('Offline - geen verbinding', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Network First strategie (voor app code)
async function networkFirst(request, cacheName) {
  try {
    console.log('[Service Worker] Fetching from network:', request.url);
    const response = await fetch(request);
    
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    
    return response;
    
  } catch (error) {
    console.log('[Service Worker] Network failed, trying cache:', error);
    
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Laatste fallback
    return new Response('Offline - geen verbinding', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// Background sync voor later
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);
  
  if (event.tag === 'sync-trail-data') {
    event.waitUntil(syncTrailData());
  }
});

async function syncTrailData() {
  // TODO: Implementeer sync logica
  console.log('[Service Worker] Syncing trail data...');
}

// Push notifications voor later
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received');
  
  const options = {
    body: event.data ? event.data.text() : 'Nieuwe notificatie van Hike5',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification('Hike5 Trail Companion', options)
  );
});
