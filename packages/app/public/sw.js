// OpenCode Service Worker for PWA Support
// Provides offline caching and app shell support

const CACHE_NAME = 'opencode-v1'
const STATIC_CACHE_NAME = 'opencode-static-v1'

// App shell assets to cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/site.webmanifest'
]

// Install event - cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((error) => {
        console.warn('Failed to cache some app shell assets:', error)
      })
    })
  )
  // Activate immediately
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => {
            return cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE_NAME
          })
          .map((cacheName) => caches.delete(cacheName))
      )
    })
  )
  // Take control of all pages immediately
  self.clients.claim()
})

// Fetch event - network first with cache fallback for navigation
// Cache first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip cross-origin requests
  if (url.origin !== location.origin) return

  // Skip API requests (let them go through normally)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/session/')) {
    return
  }

  // For navigation requests (HTML), use network first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response before caching
          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache)
          })
          return response
        })
        .catch(() => {
          // Fallback to cache, then to offline page
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse
            return caches.match('/') // Return app shell for SPA routing
          })
        })
    )
    return
  }

  // For static assets (JS, CSS, images), use cache first
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse

        return fetch(request).then((response) => {
          // Only cache successful responses
          if (!response || response.status !== 200) return response

          const responseToCache = response.clone()
          caches.open(STATIC_CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache)
          })
          return response
        })
      })
    )
    return
  }

  // For other requests, use network first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  )
})

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)))
      })
    )
  }
})
