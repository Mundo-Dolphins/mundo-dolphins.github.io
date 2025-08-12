// Script generado automáticamente por Hugo con configuración PWA segura
// NO EDITAR MANUALMENTE - Este archivo se regenera en cada build

{{- $vapidKey := getenv "VAPID_PUBLIC_KEY" -}}
{{- $isProduction := eq hugo.Environment "production" -}}

(function() {
  'use strict';
  
  // Configuración PWA inyectada de forma segura durante el build
  window.PWABuildConfig = {
    vapidPublicKey: {{ if and $vapidKey $isProduction }}"{{ $vapidKey }}"{{ else }}null{{ end }},
    environment: "{{ hugo.Environment }}",
    buildTime: "{{ now.Format "2006-01-02T15:04:05Z07:00" }}",
    isProduction: {{ $isProduction }},
    hasSecureKey: {{ if and $vapidKey $isProduction }}true{{ else }}false{{ end }}
  };

  // Función para obtener la clave VAPID de forma segura
  window.getSecureVapidKey = function() {
    // En producción, usar la clave inyectada durante el build
    if (window.PWABuildConfig && window.PWABuildConfig.hasSecureKey) {
      return window.PWABuildConfig.vapidPublicKey;
    }
    
    // En desarrollo, intentar cargar desde meta tag
    var metaVapid = document.querySelector('meta[name="vapid-public-key"]');
    if (metaVapid && metaVapid.content && metaVapid.content.length > 50) {
      return metaVapid.content;
    }
    
    // Fallback para desarrollo local
    if (window.PWAConfig && window.PWAConfig.vapidPublicKey) {
      return window.PWAConfig.vapidPublicKey;
    }
    
    console.warn('⚠️ No se pudo obtener clave VAPID segura');
    return null;
  };

  console.log('✅ Configuración PWA cargada para entorno:', window.PWABuildConfig.environment);
  
  if (window.PWABuildConfig.hasSecureKey) {
    console.log('🔐 VAPID key cargada de forma segura desde build');
  } else {
    console.log('🔧 Modo desarrollo - VAPID key se cargará dinámicamente');
  }
})();
