// Configuración PWA cargada desde el servidor
window.PWAConfig = {
  vapidPublicKey: null,
  subscriptionEndpoint: '/api/push/subscribe',
  
  // Función para cargar configuración desde el servidor
  async loadConfig() {
    try {
      const response = await fetch('/api/pwa-config');
      if (response.ok) {
        const config = await response.json();
        this.vapidPublicKey = config.vapidPublicKey;
        return true;
      }
    } catch (error) {
      console.warn('No se pudo cargar la configuración PWA desde el servidor, usando valores por defecto');
    }
    
    // Fallback para desarrollo local
    if (!this.vapidPublicKey) {
      // En desarrollo, usar variable desde el meta tag si existe
      const metaVapid = document.querySelector('meta[name="vapid-public-key"]');
      if (metaVapid) {
        this.vapidPublicKey = metaVapid.content;
      }
    }
    
    return !!this.vapidPublicKey;
  },
  
  // Función para obtener la clave VAPID de forma segura
  getVapidKey() {
    return this.vapidPublicKey;
  }
};
