// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Configuración de Firebase (demo para desarrollo)
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  storageBucket: "demo-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Inicializar Firebase Messaging
const messaging = firebase.messaging();

// Manejar mensajes en background
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Mensaje en background recibido:', payload);
  
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
      {
        action: 'view',
        title: 'Ver',
        icon: '/favicon-32x32.png'
      },
      {
        action: 'dismiss',
        title: 'Cerrar',
        icon: '/favicon-16x16.png'
      }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Manejar clicks en notificaciones
self.addEventListener('notificationclick', function(event) {
  console.log('[firebase-messaging-sw.js] Click en notificación:', event);
  
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';
  
  // Abrir o enfocar la ventana
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      // Buscar si ya hay una ventana abierta
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Cache básico para PWA
const CACHE_NAME = 'mundo-dolphins-fcm-v1';
const urlsToCache = [
  '/',
  '/favicon-192x192.png',
  '/favicon-96x96.png'
];

// Instalar service worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        // Cache resources individually to avoid failures
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn('Failed to cache:', url, err);
              return null;
            })
          )
        );
      })
      .catch(err => {
        console.warn('Cache installation failed, but continuing:', err);
        return Promise.resolve();
      })
  );
  // Forzar activación inmediata
  self.skipWaiting();
});

// Activar service worker
self.addEventListener('activate', function(event) {
  console.log('[FCM SW] Activating Service Worker...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('[FCM SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[FCM SW] Service Worker activated successfully');
      return Promise.resolve();
    }).catch(err => {
      console.warn('[FCM SW] Error during activation:', err);
      return Promise.resolve(); // Don't fail activation
    })
  );
  // Reclamar todos los clientes
  self.clients.claim();
});

// Manejar mensajes del cliente
self.addEventListener('message', function(event) {
  console.log('[FCM SW] Message received:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[FCM SW] Skipping waiting...');
    self.skipWaiting();
  }
});

// Manejo de errores global
self.addEventListener('error', function(event) {
  console.error('[FCM SW] Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', function(event) {
  console.error('[FCM SW] Unhandled promise rejection:', event.reason);
  event.preventDefault(); // Prevent the error from failing the SW
});
