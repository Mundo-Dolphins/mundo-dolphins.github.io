// Firebase Cloud Messaging Service Worker (templated by Hugo)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "{{ getenv \"FIREBASE_API_KEY\" | default \"demo-api-key\" }}",
  authDomain: "{{ getenv \"FIREBASE_AUTH_DOMAIN\" | default \"demo-project.firebaseapp.com\" }}",
  projectId: "{{ getenv \"FIREBASE_PROJECT_ID\" | default \"demo-project\" }}",
  storageBucket: "{{ getenv \"FIREBASE_STORAGE_BUCKET\" | default \"demo-project.appspot.com\" }}",
  messagingSenderId: "{{ getenv \"FIREBASE_MESSAGING_SENDER_ID\" | default \"123456789\" }}",
  appId: "{{ getenv \"FIREBASE_APP_ID\" | default \"1:123456789:web:abcdef\" }}"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notificationTitle = payload.notification?.title || payload.data?.title || 'Mundo Dolphins';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'Nuevo contenido disponible',
    icon: payload.notification?.icon || payload.data?.icon || '/favicon-192x192.png',
    badge: '/favicon-96x96.png',
    tag: 'mundo-dolphins-fcm',
    renotify: true,
    requireInteraction: false,
    data: {
      url: payload.notification?.click_action || payload.data?.url || '/',
      fcm_message_id: payload.fcmMessageId
    },
    actions: [
      { action: 'view', title: 'Ver', icon: '/favicon-32x32.png' },
      { action: 'dismiss', title: 'Cerrar', icon: '/favicon-16x16.png' }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

const CACHE_NAME = 'mundo-dolphins-fcm-v1';
const urlsToCache = ['/', '/favicon-192x192.png', '/favicon-96x96.png'];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        urlsToCache.map(url =>
          cache.add(url).catch(err => {
            console.warn('Failed to cache:', url, err);
            return null;
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
