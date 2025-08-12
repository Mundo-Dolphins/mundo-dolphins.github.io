// Gestión de notificaciones push
class PushNotificationManager {
  constructor() {
    console.log('🔍 Construyendo PushNotificationManager...');
    this.isSupported = 'serviceWorker' in navigator && 'PushManager' in window;
    console.log('🔍 Soporte verificado:', this.isSupported);
    this.registration = null;
    this.subscription = null;
    // Cargar clave VAPID desde configuración del sitio
    this.vapidPublicKey = this.getVapidPublicKey();
    console.log('🔍 VAPID key obtenida:', this.vapidPublicKey ? 'Sí' : 'No');
  }

  // Obtener clave VAPID pública desde configuración con validación mejorada
  getVapidPublicKey() {
    console.log('🔍 Obteniendo VAPID key...');
    
    // Intentar obtener desde meta tag primero
    const metaVapid = document.querySelector('meta[name="vapid-public-key"]');
    console.log('🔍 Meta tag encontrado:', metaVapid);
    if (metaVapid && metaVapid.content && this.isValidVapidKey(metaVapid.content)) {
      console.log('✅ VAPID key desde meta tag válida');
      return metaVapid.content;
    }
    
    // Fallback desde configuración global del sitio
    console.log('🔍 Verificando window.siteConfig:', window.siteConfig);
    if (window.siteConfig && window.siteConfig.vapidPublicKey && this.isValidVapidKey(window.siteConfig.vapidPublicKey)) {
      console.log('✅ VAPID key desde siteConfig válida');
      return window.siteConfig.vapidPublicKey;
    }
    
    // Error si no se encuentra configuración válida
    console.error('❌ VAPID public key no configurada o inválida. Verifica la configuración del sitio.');
    return null;
  }
  
  // Validar formato de clave VAPID
  isValidVapidKey(key) {
    if (!key || typeof key !== 'string') {
      return false;
    }
    
    // Verificar que no sea un placeholder conocido
    const invalidPlaceholders = [
      'TU_CLAVE_VAPID_PUBLICA_AQUI',
      'YOUR_VAPID_PUBLIC_KEY_HERE',
      'PLACEHOLDER',
      ''
    ];
    
    if (invalidPlaceholders.includes(key)) {
      return false;
    }
    
    // Verificar longitud básica (las claves VAPID tienen ~87 caracteres en base64)
    if (key.length < 80 || key.length > 100) {
      return false;
    }
    
    // Verificar que parece ser base64 URL-safe
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      return false;
    }
    
    return true;
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

  // Almacenamiento seguro de datos de suscripción con validación
  storeSecureSubscriptionData(subscriptionId, isSubscribed) {
    // Validar entradas
    if (typeof isSubscribed !== 'boolean') {
      console.warn('Estado de suscripción inválido');
      return;
    }
    
    const secureData = {
      // Solo datos mínimos no sensibles
      subscribed: isSubscribed,
      timestamp: Date.now(),
      // ID del servidor (si está disponible) para identificación segura
      id: subscriptionId || null,
      // Version para migración futura
      version: '2.0'
    };
    
    try {
      // Validar que localStorage está disponible
      if (typeof Storage === 'undefined') {
        console.warn('localStorage no está disponible');
        return;
      }
      
      localStorage.setItem('push_status', JSON.stringify(secureData));
    } catch (error) {
      console.warn('No se pudo guardar estado en localStorage:', error);
    }
  }

  // Leer datos seguros de suscripción con validación
  getSecureSubscriptionData() {
    try {
      if (typeof Storage === 'undefined') {
        return null;
      }
      
      const data = localStorage.getItem('push_status');
      if (!data) {
        return null;
      }
      
      const parsed = JSON.parse(data);
      
      // Validar estructura de datos
      if (!parsed || typeof parsed.subscribed !== 'boolean') {
        console.warn('Datos de suscripción corruptos, limpiando...');
        this.clearSecureSubscriptionData();
        return null;
      }
      
      // Verificar expiración (30 días)
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - parsed.timestamp > maxAge) {
        console.log('Datos de suscripción expirados, limpiando...');
        this.clearSecureSubscriptionData();
        return null;
      }
      
      return parsed;
    } catch (error) {
      console.warn('Error leyendo estado de suscripción:', error);
      this.clearSecureSubscriptionData();
      return null;
    }
  }

  // Limpiar datos de suscripción de forma segura
  clearSecureSubscriptionData() {
    try {
      if (typeof Storage === 'undefined') {
        return;
      }
      
      // Limpiar múltiples claves por compatibilidad
      const keysToRemove = [
        'push_status',
        'pushSubscriptionStatus', // Formato anterior
        'push_subscription_data' // Formato legacy
      ];
      
      keysToRemove.forEach(key => {
        try {
          localStorage.removeItem(key);
        } catch (error) {
          console.warn(`Error removiendo ${key}:`, error);
        }
      });
    } catch (error) {
      console.warn('Error limpiando estado de suscripción:', error);
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
  console.log('🔍 DOM cargado, inicializando PushNotificationManager...');
  
  const pushManager = new PushNotificationManager();
  console.log('🔍 PushNotificationManager creado:', pushManager);
  
  // Inicializar
  pushManager.init().then(() => {
    console.log('✅ PushNotificationManager inicializado');
  }).catch(error => {
    console.error('❌ Error inicializando PushNotificationManager:', error);
  });

  // Event listeners para los botones
  const subscribeBtn = document.getElementById('subscribe-btn');
  const unsubscribeBtn = document.getElementById('unsubscribe-btn');
  const testBtn = document.getElementById('test-notification-btn');

  console.log('🔍 Botones encontrados:', {
    subscribe: subscribeBtn,
    unsubscribe: unsubscribeBtn,
    test: testBtn
  });

  if (subscribeBtn) {
    subscribeBtn.addEventListener('click', () => {
      console.log('🔍 Click en botón suscribir');
      pushManager.subscribe();
    });
  }

  if (unsubscribeBtn) {
    unsubscribeBtn.addEventListener('click', () => {
      console.log('🔍 Click en botón desuscribir');
      pushManager.unsubscribe();
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', () => {
      console.log('🔍 Click en botón test');
      pushManager.showTestNotification();
    });
  }

  // Hacer disponible globalmente para debugging
  window.pushManager = pushManager;
  window.PushNotificationManager = PushNotificationManager;
});
