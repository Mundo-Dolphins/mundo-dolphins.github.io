// Script de depuración para notificaciones push
console.log('🔍 Iniciando depuración de notificaciones push...');

// Verificar soporte
console.log('🔧 Verificando soporte:');
console.log('  - Service Worker:', 'serviceWorker' in navigator);
console.log('  - PushManager:', 'PushManager' in window);
console.log('  - Notifications:', 'Notification' in window);

// Verificar configuración
console.log('🔧 Verificando configuración:');
console.log('  - PWA_SECURE_CONFIG:', window.PWA_SECURE_CONFIG);
console.log('  - siteConfig:', window.siteConfig);

// Intentar cargar configuración VAPID
async function debugVapidConfig() {
  console.log('🔍 Intentando cargar configuración VAPID...');
  
  try {
    const response = await fetch('/scripts/vapid-config.json');
    if (response.ok) {
      const config = await response.json();
      console.log('✅ Configuración VAPID local:', config);
      
      // Configurar window.siteConfig si no existe
      if (!window.siteConfig) {
        window.siteConfig = {};
      }
      window.siteConfig.vapidPublicKey = config.publicKey;
      console.log('✅ window.siteConfig configurado:', window.siteConfig);
      
      return config;
    } else {
      console.error('❌ No se pudo cargar vapid-config.json:', response.status);
    }
  } catch (error) {
    console.error('❌ Error cargando configuración VAPID:', error);
  }
  
  return null;
}

// Verificar elementos del DOM
function debugDOMElements() {
  console.log('🔍 Verificando elementos del DOM:');
  const subscribeBtn = document.getElementById('subscribe-btn');
  const unsubscribeBtn = document.getElementById('unsubscribe-btn');
  const statusText = document.getElementById('notification-status');
  
  console.log('  - Botón suscribir:', subscribeBtn);
  console.log('  - Botón desuscribir:', unsubscribeBtn);
  console.log('  - Estado:', statusText);
  
  return { subscribeBtn, unsubscribeBtn, statusText };
}

// Verificar PushNotificationManager
function debugPushManager() {
  console.log('🔍 Verificando PushNotificationManager:');
  if (window.PushNotificationManager) {
    console.log('✅ PushNotificationManager disponible');
    
    // Intentar crear instancia
    try {
      const manager = new window.PushNotificationManager();
      console.log('✅ Instancia creada:', manager);
      console.log('  - VAPID Key:', manager.vapidPublicKey);
      console.log('  - Soportado:', manager.isSupported);
      
      return manager;
    } catch (error) {
      console.error('❌ Error creando PushNotificationManager:', error);
    }
  } else {
    console.error('❌ PushNotificationManager no disponible');
  }
  
  return null;
}

// Ejecutar depuración cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await debugVapidConfig();
    debugDOMElements();
    debugPushManager();
  });
} else {
  // DOM ya está listo
  (async () => {
    await debugVapidConfig();
    debugDOMElements();
    debugPushManager();
  })();
}

console.log('🔍 Script de depuración cargado');
