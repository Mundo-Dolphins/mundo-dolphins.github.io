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
    document.addEventListener('DOMContentLoaded', addPWAMetas);
  } else {
    addPWAMetas();
  }
  
  function addPWAMetas() {
    // PWA Meta Tags
    addMetaTag('theme-color', '#3c8b94');
    addMetaTag('apple-mobile-web-app-capable', 'yes');
    addMetaTag('apple-mobile-web-app-status-bar-style', 'default');
    addMetaTag('apple-mobile-web-app-title', 'Mundo Dolphins');
    addMetaTag('msapplication-TileColor', '#3c8b94');
    addMetaTag('msapplication-config', '/browserconfig.xml');
    addMetaTag('mobile-web-app-capable', 'yes');
    addMetaTag('application-name', 'Mundo Dolphins');
    
    // VAPID Key para push notifications
    addMetaTag('vapid-public-key', 'BNVHEdU6MquHk0FNf5rMSLiGqN-4HjueaGeDztf-rCjaJHaM-3bmGJ6Lxj-2QfRgZygiioAwJp9yjgsKhEW9IZ0');
    
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
