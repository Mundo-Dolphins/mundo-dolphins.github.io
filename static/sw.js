// Service Worker para notificaciones push
const CACHE_NAME = 'mundo-dolphins-v1';
const urlsToCache = [
  '/',
  '/css/mundodolphins.css',
  '/js/push-notifications.js'
];

// Instalar service worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activar service worker
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
});

// Manejar notificaciones push
self.addEventListener('push', function(event) {
  console.log('Push message received:', event);
  
  let notificationData = {};
  
  if (event.data) {
    try {
      notificationData = event.data.json();
    } catch (e) {
      notificationData = {
        title: 'Nuevo artículo en Mundo Dolphins',
        body: event.data.text(),
        icon: '/favicon-192x192.png',
        badge: '/favicon-96x96.png'
      };
    }
  } else {
    notificationData = {
      title: 'Nuevo contenido disponible',
      body: 'Hay nuevo contenido en Mundo Dolphins',
      icon: '/favicon-192x192.png',
      badge: '/favicon-96x96.png'
    };
  }

  const options = {
    body: notificationData.body,
    icon: notificationData.icon || '/favicon-192x192.png',
    badge: notificationData.badge || '/favicon-96x96.png',
    tag: 'mundo-dolphins-notification',
    renotify: true,
    requireInteraction: false,
    actions: [
      {
        action: 'view',
        title: 'Ver artículo',
        icon: '/favicon-32x32.png'
      },
      {
        action: 'dismiss',
        title: 'Cerrar',
        icon: '/favicon-16x16.png'
      }
    ],
    data: {
      url: notificationData.url || '/',
      timestamp: Date.now()
    }
  };

  event.waitUntil(
    self.registration.showNotification(notificationData.title, options)
  );
});

// Manejar clicks en las notificaciones
self.addEventListener('notificationclick', function(event) {
  console.log('Notification click received:', event);
  
  event.notification.close();
  
  if (event.action === 'view') {
    const urlToOpen = event.notification.data.url || '/';
    
    event.waitUntil(
      clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      }).then(function(clientList) {
        // Si ya hay una ventana abierta, enfocarla
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => {
              return client.navigate(urlToOpen);
            });
          }
        }
        
        // Si no hay ventana abierta, abrir una nueva
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
    );
  } else if (event.action === 'dismiss') {
    // Solo cerrar la notificación
    return;
  } else {
    // Click en la notificación sin action específica
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  }
});

// Manejar cierre de notificaciones
self.addEventListener('notificationclose', function(event) {
  console.log('Notification was closed:', event);
  
  // Aquí podrías enviar analytics sobre notificaciones cerradas
});
