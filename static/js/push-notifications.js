// Gestión de notificaciones push
class PushNotificationManager {
  constructor() {
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    this.registration = null;
    this.subscription = null;
    // Cargar clave VAPID desde configuración del sitio
    this.vapidPublicKey = this.getVapidPublicKey();
  }

  // Obtener clave VAPID pública desde configuración
  getVapidPublicKey() {
    // Intentar obtener desde meta tag primero
    const metaVapid = document.querySelector('meta[name="vapid-public-key"]');
    if (metaVapid && metaVapid.content !== 'TU_CLAVE_VAPID_PUBLICA_AQUI') {
      return metaVapid.content;
    }
    
    // Fallback desde configuración global del sitio
    if (window.siteConfig && window.siteConfig.vapidPublicKey) {
      return window.siteConfig.vapidPublicKey;
    }
    
    // Error si no se encuentra configuración válida
    console.error('VAPID public key no configurada. Verifica la configuración del sitio.');
    return null;
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

  // Enviar suscripción al servidor (mejorado para seguridad)
  async sendSubscriptionToServer(subscription) {
    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest', // Protección CSRF básica
        },
        body: JSON.stringify({
          subscription: subscription,
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
          origin: window.location.origin // Verificación de origen
        })
      });

      if (!response.ok) {
        throw new Error('Error enviando suscripción al servidor');
      }

      const result = await response.json();
      
      // Almacenar solo identificador seguro, no datos sensibles
      if (result.subscriptionId) {
        this.storeSecureSubscriptionData(result.subscriptionId, true);
      }

      console.log('Suscripción enviada al servidor');
    } catch (error) {
      console.error('Error enviando suscripción:', error);
      // Fallback con datos mínimos no sensibles
      this.storeSecureSubscriptionData(null, true);
    }
  }

  // Remover suscripción del servidor (mejorado para seguridad)
  async removeSubscriptionFromServer(subscription) {
    try {
      const response = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest', // Protección CSRF básica
        },
        body: JSON.stringify({
          subscription: subscription,
          timestamp: Date.now(),
          origin: window.location.origin // Verificación de origen
        })
      });

      if (!response.ok) {
        throw new Error('Error removiendo suscripción del servidor');
      }

      console.log('Suscripción removida del servidor');
    } catch (error) {
      console.error('Error removiendo suscripción:', error);
    }
    
    // Limpiar almacenamiento local
    this.clearSecureSubscriptionData();
  }

  // Almacenamiento seguro de datos de suscripción
  storeSecureSubscriptionData(subscriptionId, isSubscribed) {
    const secureData = {
      // Solo datos mínimos no sensibles
      subscribed: isSubscribed,
      timestamp: Date.now(),
      // Hash simple del user agent para consistencia (no identificación)
      clientHash: this.generateSimpleHash(navigator.userAgent.substring(0, 20)),
      // ID del servidor (si está disponible) para identificación segura
      id: subscriptionId || null
    };
    
    try {
      localStorage.setItem('push_status', JSON.stringify(secureData));
    } catch (error) {
      console.warn('No se pudo guardar estado en localStorage:', error);
    }
  }

  // Leer datos seguros de suscripción
  getSecureSubscriptionData() {
    try {
      const data = localStorage.getItem('push_status');
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Error leyendo estado de suscripción:', error);
      return null;
    }
  }

  // Limpiar datos de suscripción
  clearSecureSubscriptionData() {
    try {
      localStorage.removeItem('push_status');
      // Limpiar también el formato anterior por compatibilidad
      localStorage.removeItem('pushSubscriptionStatus');
    } catch (error) {
      console.warn('Error limpiando estado de suscripción:', error);
    }
  }

  // Generar hash simple (no criptográfico, solo para consistencia)
  generateSimpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convertir a 32-bit integer
    }
    return Math.abs(hash).toString(16);
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
