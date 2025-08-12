// Script para añadir meta tags PWA dinámicamente
(function() {
  'use strict';
  
  // Función para añadir meta tag si no existe
  function addMetaTag(name, content, property = false) {
    const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
    if (!document.querySelector(selector)) {
      const meta = document.createElement('meta');
      if (property) {
        meta.setAttribute('property', name);
      } else {
        meta.setAttribute('name', name);
      }
      meta.setAttribute('content', content);
      document.head.appendChild(meta);
    }
  }
  
  // Función para cargar configuración de forma segura (con GitHub Secrets)
  async function loadPWAConfig() {
    // 1. Prioridad máxima: Configuración inyectada desde GitHub Secrets durante el build
    if (window.PWA_SECURE_CONFIG && window.PWA_SECURE_CONFIG.hasVapidFromEnv) {
      console.log('✅ VAPID key cargada desde GitHub Secrets de forma segura');
      return { 
        vapidPublicKey: window.PWA_SECURE_CONFIG.vapidKey,
        source: 'github-secrets'
      };
    }
    
    // 2. Fallback: Función de configuración segura (si existe)
    if (window.getSecureVapidKey) {
      const vapidKey = window.getSecureVapidKey();
      if (vapidKey) {
        console.log('✅ VAPID key cargada desde función segura');
        return { vapidPublicKey: vapidKey, source: 'secure-function' };
      }
    }
    
    // 3. Fallback: Cargar desde endpoint de configuración
    try {
      const response = await fetch('/api/pwa-config.json');
      if (response.ok) {
        const config = await response.json();
        console.log('✅ Configuración PWA cargada desde endpoint');
        return { ...config, source: 'endpoint' };
      }
    } catch (error) {
      console.warn('No se pudo cargar configuración PWA desde endpoint');
    }
    
    // 4. Fallback para desarrollo: Meta tag
    const metaVapid = document.querySelector('meta[name="vapid-public-key"]');
    if (metaVapid && metaVapid.content && metaVapid.content.length > 50) {
      console.log('✅ VAPID key cargada desde meta tag de desarrollo');
      return { vapidPublicKey: metaVapid.content, source: 'meta-tag' };
    }
    
    // 5. Último fallback: configuración local
    if (window.PWAConfig && window.PWAConfig.vapidPublicKey) {
      console.log('✅ VAPID key cargada desde configuración local');
      return { vapidPublicKey: window.PWAConfig.vapidPublicKey, source: 'local-config' };
    }
    
    console.warn('⚠️ No se pudo cargar clave VAPID desde ninguna fuente segura');
    return null;
  }
  
  // Función para añadir link si no existe
  function addLink(rel, href, attributes = {}) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement('link');
      link.setAttribute('rel', rel);
      link.setAttribute('href', href);
      
      // Añadir atributos adicionales
      Object.keys(attributes).forEach(key => {
        link.setAttribute(key, attributes[key]);
      });
      
      document.head.appendChild(link);
    }
  }
  
  // Ejecutar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPWA);
  } else {
    initPWA();
  }
  
  async function initPWA() {
    const config = await loadPWAConfig();
    addPWAMetas(config);
  }
  
  function addPWAMetas(config) {
    // PWA Meta Tags básicos
    addMetaTag('theme-color', '#3c8b94');
    addMetaTag('apple-mobile-web-app-capable', 'yes');
    addMetaTag('apple-mobile-web-app-status-bar-style', 'default');
    addMetaTag('apple-mobile-web-app-title', 'Mundo Dolphins');
    addMetaTag('msapplication-TileColor', '#3c8b94');
    addMetaTag('msapplication-config', '/browserconfig.xml');
    addMetaTag('mobile-web-app-capable', 'yes');
    addMetaTag('application-name', 'Mundo Dolphins');
    
    // VAPID Key solo si está disponible en la configuración
    if (config && config.vapidPublicKey) {
      addMetaTag('vapid-public-key', config.vapidPublicKey);
      console.log('✅ VAPID key cargada desde configuración segura');
    } else {
      console.warn('⚠️ No se pudo cargar VAPID key desde configuración');
    }
    
    // Links PWA
    addLink('manifest', '/manifest.json');
    addLink('preload', '/js/push-notifications.js', { as: 'script' });
    addLink('preload', '/sw.js', { as: 'script' });
    
    // Open Graph (si no existen)
    if (!document.querySelector('meta[property="og:title"]')) {
      addMetaTag('og:title', document.title, true);
      addMetaTag('og:description', 'El podcast de los Dolphins de Miami', true);
      addMetaTag('og:type', 'website', true);
      addMetaTag('og:url', window.location.href, true);
      addMetaTag('og:site_name', 'Mundo Dolphins', true);
      addMetaTag('og:image', '/assets/Mundo_Dolphins.jpg', true);
    }
    
    // Twitter Card (si no existen)
    if (!document.querySelector('meta[name="twitter:card"]')) {
      addMetaTag('twitter:card', 'summary_large_image');
      addMetaTag('twitter:site', '@MundoDolphins');
      addMetaTag('twitter:creator', '@MundoDolphins');
      addMetaTag('twitter:title', document.title);
      addMetaTag('twitter:description', 'El podcast de los Dolphins de Miami');
      addMetaTag('twitter:image', '/assets/Mundo_Dolphins.jpg');
    }
    
    console.log('✅ Meta tags PWA añadidos dinámicamente');
  }
})();
