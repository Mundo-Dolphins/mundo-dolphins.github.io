// Firebase Cloud Messaging Manager para notificaciones push
class FCMNotificationManager {
  constructor() {
    this.app = null;
    this.messaging = null;
    this.token = null;
    this.isSupported = this.checkSupport();
    this.config = window.FCM_CONFIG || null;
    
    console.log('🔥 FCMNotificationManager iniciado');
    console.log('🔥 Soporte:', this.isSupported);
    console.log('🔥 Configuración:', !!this.config);
  }

  checkSupport() {
    return 'serviceWorker' in navigator && 
           'PushManager' in window && 
           'Notification' in window &&
           firebase && 
           firebase.messaging &&
           firebase.messaging.isSupported();
  }

  async init() {
    console.log('🔥 Iniciando FCM...');
    
    if (!this.isSupported) {
      console.error('❌ FCM no es soportado en este navegador');
      this.updateUI(false, 'FCM no soportado');
      return false;
    }

    if (!this.config || !this.config.hasKeys) {
      console.warn('⚠️ Configuración de Firebase no disponible (modo demo)');
      this.updateUI(false, 'Configuración no disponible');
      return false;
    }

    try {
      // Inicializar Firebase si no está inicializado
      if (!firebase.apps.length) {
        this.app = firebase.initializeApp(this.config.firebase);
      } else {
        this.app = firebase.app();
      }

      // Obtener messaging
      this.messaging = firebase.messaging();

      // Configurar VAPID key
      if (this.config.vapidKey) {
        this.messaging.useServiceWorker(await this.registerServiceWorker());
        this.messaging.usePublicVapidKey(this.config.vapidKey);
      }

      // Configurar manejo de mensajes en foreground
      this.messaging.onMessage((payload) => {
        console.log('🔥 Mensaje recibido en foreground:', payload);
        this.showForegroundNotification(payload);
      });

      // Verificar si ya tenemos un token
      this.token = await this.messaging.getToken();
      if (this.token) {
        console.log('🔥 Token FCM existente:', this.token);
        this.updateUI(true, 'Notificaciones activas');
        this.saveToken(this.token);
      } else {
        console.log('🔥 No hay token FCM');
        this.updateUI(false, 'No suscrito');
      }

      // Escuchar cambios en el token
      this.messaging.onTokenRefresh(() => {
        this.messaging.getToken().then((refreshedToken) => {
          console.log('🔥 Token FCM actualizado:', refreshedToken);
          this.saveToken(refreshedToken);
        });
      });

      console.log('✅ FCM inicializado correctamente');
      return true;

    } catch (error) {
      console.error('❌ Error inicializando FCM:', error);
      this.updateUI(false, 'Error de inicialización');
      return false;
    }
  }

  async registerServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('🔥 Service Worker FCM registrado:', registration);
      return registration;
    } catch (error) {
      console.error('❌ Error registrando Service Worker FCM:', error);
      throw error;
    }
  }

  async subscribe() {
    console.log('🔥 Iniciando suscripción FCM...');

    if (!this.messaging) {
      console.error('❌ FCM no inicializado');
      return false;
    }

    try {
      // Solicitar permisos
      const permission = await Notification.requestPermission();
      console.log('🔥 Permiso de notificación:', permission);

      if (permission !== 'granted') {
        console.log('❌ Permiso de notificaciones denegado');
        this.updateUI(false, 'Permisos denegados');
        return false;
      }

      // Obtener token FCM
      this.token = await this.messaging.getToken();
      
      if (this.token) {
        console.log('✅ Token FCM obtenido:', this.token);
        this.saveToken(this.token);
        this.updateUI(true, 'Notificaciones activas');
        
        // Mostrar notificación de confirmación
        this.showLocalNotification(
          '🔔 Notificaciones Activadas',
          'Te notificaremos sobre nuevo contenido de Mundo Dolphins'
        );
        
        return true;
      } else {
        console.error('❌ No se pudo obtener token FCM');
        this.updateUI(false, 'Error obteniendo token');
        return false;
      }

    } catch (error) {
      console.error('❌ Error en suscripción FCM:', error);
      this.updateUI(false, 'Error en suscripción');
      return false;
    }
  }

  async unsubscribe() {
    console.log('🔥 Iniciando desuscripción FCM...');

    if (!this.messaging || !this.token) {
      console.log('❌ No hay suscripción activa');
      return true;
    }

    try {
      // Eliminar token
      await this.messaging.deleteToken(this.token);
      this.token = null;
      
      // Limpiar almacenamiento local
      this.clearToken();
      this.updateUI(false, 'Notificaciones desactivadas');
      
      console.log('✅ Desuscripción FCM exitosa');
      return true;

    } catch (error) {
      console.error('❌ Error en desuscripción FCM:', error);
      return false;
    }
  }

  saveToken(token) {
    try {
      const tokenData = {
        token: token,
        timestamp: Date.now(),
        domain: window.location.hostname,
        userAgent: navigator.userAgent.substring(0, 100)
      };
      
      localStorage.setItem('fcm_token', JSON.stringify(tokenData));
      console.log('💾 Token FCM guardado localmente');
      
      // Aquí podrías enviar el token a tu servidor si tienes uno
      // this.sendTokenToServer(token);
      
    } catch (error) {
      console.warn('⚠️ Error guardando token FCM:', error);
    }
  }

  clearToken() {
    try {
      localStorage.removeItem('fcm_token');
      console.log('🗑️ Token FCM eliminado');
    } catch (error) {
      console.warn('⚠️ Error eliminando token FCM:', error);
    }
  }

  getStoredToken() {
    try {
      const stored = localStorage.getItem('fcm_token');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.warn('⚠️ Error leyendo token FCM:', error);
      return null;
    }
  }

  showForegroundNotification(payload) {
    const title = payload.notification?.title || payload.data?.title || 'Mundo Dolphins';
    const body = payload.notification?.body || payload.data?.body || 'Nuevo contenido disponible';
    
    this.showLocalNotification(title, body);
  }

  showLocalNotification(title, body, options = {}) {
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: '/favicon-192x192.png',
        badge: '/favicon-96x96.png',
        tag: 'mundo-dolphins-local',
        ...options
      });
    }
  }

  updateUI(isSubscribed, statusText = '') {
    const subscribeBtn = document.getElementById('subscribe-btn');
    const unsubscribeBtn = document.getElementById('unsubscribe-btn');
    const statusSpan = document.getElementById('notification-status');

    if (!subscribeBtn || !unsubscribeBtn || !statusSpan) {
      return;
    }

    if (isSubscribed) {
      subscribeBtn.style.display = 'none';
      unsubscribeBtn.style.display = 'inline-block';
      statusSpan.textContent = statusText || '✅ Notificaciones activas';
      statusSpan.className = 'notification-status notification-status--active';
    } else {
      subscribeBtn.style.display = 'inline-block';
      unsubscribeBtn.style.display = 'none';
      statusSpan.textContent = statusText || '🔔 Activar notificaciones';
      statusSpan.className = 'notification-status notification-status--inactive';
    }
  }

  // Método para testing
  async sendTestNotification() {
    this.showLocalNotification(
      '🧪 Test FCM',
      'Esta es una notificación de prueba local'
    );
  }
}

// Inicializar cuando Firebase esté disponible y DOM listo
document.addEventListener('DOMContentLoaded', function() {
  console.log('🔥 DOM listo, esperando Firebase...');
  
  // Esperar a que Firebase esté disponible
  const waitForFirebase = () => {
    if (typeof firebase !== 'undefined' && firebase.messaging) {
      console.log('🔥 Firebase disponible, inicializando FCM Manager...');
      
      const fcmManager = new FCMNotificationManager();
      
      // Inicializar FCM
      fcmManager.init().then(success => {
        if (success) {
          console.log('✅ FCM Manager inicializado');
        } else {
          console.log('⚠️ FCM Manager no pudo inicializarse completamente');
        }
      });

      // Configurar event listeners
      const subscribeBtn = document.getElementById('subscribe-btn');
      const unsubscribeBtn = document.getElementById('unsubscribe-btn');
      const testBtn = document.getElementById('test-notification-btn');

      if (subscribeBtn) {
        subscribeBtn.addEventListener('click', () => {
          console.log('🔥 Click en suscribir FCM');
          fcmManager.subscribe();
        });
      }

      if (unsubscribeBtn) {
        unsubscribeBtn.addEventListener('click', () => {
          console.log('🔥 Click en desuscribir FCM');
          fcmManager.unsubscribe();
        });
      }

      if (testBtn) {
        testBtn.addEventListener('click', () => {
          console.log('🔥 Click en test FCM');
          fcmManager.sendTestNotification();
        });
      }

      // Hacer disponible globalmente para debugging
      window.fcmManager = fcmManager;
      
    } else {
      // Intentar de nuevo en 100ms
      setTimeout(waitForFirebase, 100);
    }
  };
  
  waitForFirebase();
});

console.log('🔥 FCM Notifications script cargado');
