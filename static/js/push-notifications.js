// Gestión de notificaciones push
class PushNotificationManager {
  constructor() {
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    this.registration = null;
    this.subscription = null;
    this.vapidPublicKey = 'BNVHEdU6MquHk0FNf5rMSLiGqN-4HjueaGeDztf-rCjaJHaM-3bmGJ6Lxj-2QfRgZygiioAwJp9yjgsKhEW9IZ0'; // Clave VAPID pública generada
  }

  // Inicializar el servicio
  async init() {
    if (!this.isSupported) {
      console.log('Push notifications no son soportadas');
      return false;
    }

    try {
      // Registrar service worker
      this.registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registrado:', this.registration);

      // Verificar si ya hay una suscripción
      this.subscription = await this.registration.pushManager.getSubscription();
      
      if (this.subscription) {
        console.log('Ya hay una suscripción activa');
        this.updateUI(true);
      } else {
        console.log('No hay suscripción activa');
        this.updateUI(false);
      }

      return true;
    } catch (error) {
      console.error('Error inicializando push notifications:', error);
      return false;
    }
  }

  // Solicitar permiso y suscribirse
  async subscribe() {
    if (!this.registration) {
      console.error('Service Worker no está registrado');
      return false;
    }

    try {
      // Solicitar permiso
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        console.log('Permiso de notificaciones denegado');
        return false;
      }

      // Crear suscripción
      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.vapidPublicKey)
      });

      console.log('Suscripción creada:', this.subscription);

      // Enviar suscripción al servidor
      await this.sendSubscriptionToServer(this.subscription);
      
      this.updateUI(true);
      return true;
    } catch (error) {
      console.error('Error al suscribirse:', error);
      return false;
    }
  }

  // Desuscribirse
  async unsubscribe() {
    if (!this.subscription) {
      console.log('No hay suscripción activa');
      return true;
    }

    try {
      await this.subscription.unsubscribe();
      await this.removeSubscriptionFromServer(this.subscription);
      
      this.subscription = null;
      this.updateUI(false);
      
      console.log('Desuscripción exitosa');
      return true;
    } catch (error) {
      console.error('Error al desuscribirse:', error);
      return false;
    }
  }

  // Enviar suscripción al servidor (necesitarás implementar el endpoint)
  async sendSubscriptionToServer(subscription) {
    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: subscription,
          timestamp: Date.now(),
          userAgent: navigator.userAgent
        })
      });

      if (!response.ok) {
        throw new Error('Error enviando suscripción al servidor');
      }

      console.log('Suscripción enviada al servidor');
    } catch (error) {
      console.error('Error enviando suscripción:', error);
      // Por ahora, guardar en localStorage como fallback
      localStorage.setItem('pushSubscription', JSON.stringify(subscription));
    }
  }

  // Remover suscripción del servidor
  async removeSubscriptionFromServer(subscription) {
    try {
      const response = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscription: subscription
        })
      });

      if (!response.ok) {
        throw new Error('Error removiendo suscripción del servidor');
      }

      console.log('Suscripción removida del servidor');
    } catch (error) {
      console.error('Error removiendo suscripción:', error);
      // Remover de localStorage también
      localStorage.removeItem('pushSubscription');
    }
  }

  // Actualizar UI basado en el estado de suscripción
  updateUI(isSubscribed) {
    const subscribeBtn = document.getElementById('subscribe-btn');
    const unsubscribeBtn = document.getElementById('unsubscribe-btn');
    const statusText = document.getElementById('notification-status');

    if (!subscribeBtn || !unsubscribeBtn || !statusText) {
      return;
    }

    if (isSubscribed) {
      subscribeBtn.style.display = 'none';
      unsubscribeBtn.style.display = 'inline-block';
      statusText.textContent = '✅ Notificaciones activadas';
      statusText.className = 'notification-status notification-status--active';
    } else {
      subscribeBtn.style.display = 'inline-block';
      unsubscribeBtn.style.display = 'none';
      statusText.textContent = '🔔 Activar notificaciones';
      statusText.className = 'notification-status notification-status--inactive';
    }
  }

  // Convertir clave VAPID
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // Mostrar notificación de prueba
  async showTestNotification() {
    if (!this.registration) {
      console.error('Service Worker no está registrado');
      return;
    }

    try {
      await this.registration.showNotification('🐬 Mundo Dolphins', {
        body: 'Las notificaciones están funcionando correctamente!',
        icon: '/favicon-192x192.png',
        badge: '/favicon-96x96.png',
        tag: 'test-notification',
        actions: [
          {
            action: 'view',
            title: 'Ver sitio'
          }
        ]
      });
    } catch (error) {
      console.error('Error mostrando notificación de prueba:', error);
    }
  }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  const pushManager = new PushNotificationManager();
  
  // Inicializar
  pushManager.init();

  // Event listeners para los botones
  const subscribeBtn = document.getElementById('subscribe-btn');
  const unsubscribeBtn = document.getElementById('unsubscribe-btn');
  const testBtn = document.getElementById('test-notification-btn');

  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', () => {
      pushManager.subscribe();
    });
  }

  if (unsubscribeBtn) {
    unsubscribeBtn.addEventListener('click', () => {
      pushManager.unsubscribe();
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', () => {
      pushManager.showTestNotification();
    });
  }

  // Hacer disponible globalmente para debugging
  window.pushManager = pushManager;
});
