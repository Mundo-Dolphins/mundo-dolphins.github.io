---
title: "Test de Notificaciones Push"
date: 2025-08-12T15:47:00+02:00
author: "Admin"
authorLink: "https://mundodolphins.es"
description: "Página de prueba para las notificaciones push"
---

# Test de Notificaciones Push

Esta es una página de prueba para verificar que las notificaciones push funcionan correctamente.

## Test Manual

<button onclick="testPushSystem()" style="background: #008E97; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;">🧪 Test Sistema Push</button>

<div id="test-results" style="margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px;">
<p>Resultados aparecerán aquí...</p>
</div>

<script>
async function testPushSystem() {
  const results = document.getElementById('test-results');
  let html = '<h3>🔍 Resultados del Test</h3>';
  
  // Test 1: Verificar soporte
  html += '<p><strong>1. Soporte del navegador:</strong></p>';
  html += `<ul>`;
  html += `<li>Service Worker: ${'serviceWorker' in navigator ? '✅' : '❌'}</li>`;
  html += `<li>PushManager: ${'PushManager' in window ? '✅' : '❌'}</li>`;
  html += `<li>Notifications: ${'Notification' in window ? '✅' : '❌'}</li>`;
  html += `</ul>`;
  
  // Test 2: Verificar configuración
  html += '<p><strong>2. Configuración:</strong></p>';
  html += `<ul>`;
  html += `<li>PWA_SECURE_CONFIG: ${window.PWA_SECURE_CONFIG ? '✅' : '❌'}</li>`;
  html += `<li>siteConfig: ${window.siteConfig ? '✅' : '❌'}</li>`;
  html += `<li>VAPID key en siteConfig: ${window.siteConfig?.vapidPublicKey ? '✅' : '❌'}</li>`;
  html += `</ul>`;
  
  // Test 3: Cargar configuración VAPID
  html += '<p><strong>3. Carga de configuración VAPID:</strong></p>';
  try {
    const response = await fetch('/vapid-config.json');
    if (response.ok) {
      const config = await response.json();
      html += `<ul><li>Archivo accesible: ✅</li>`;
      html += `<li>Clave pública presente: ${config.publicKey ? '✅' : '❌'}</li>`;
      html += `<li>Longitud clave: ${config.publicKey?.length || 0} caracteres</li></ul>`;
      
      // Configurar si no existe
      if (!window.siteConfig) {
        window.siteConfig = {};
      }
      window.siteConfig.vapidPublicKey = config.publicKey;
      html += '<p>✅ Configuración actualizada</p>';
    } else {
      html += '<ul><li>❌ Error cargando archivo</li></ul>';
    }
  } catch (error) {
    html += `<ul><li>❌ Error: ${error.message}</li></ul>`;
  }
  
  // Test 4: Verificar PushNotificationManager
  html += '<p><strong>4. PushNotificationManager:</strong></p>';
  if (window.PushNotificationManager) {
    try {
      const manager = new window.PushNotificationManager();
      html += `<ul>`;
      html += `<li>Clase disponible: ✅</li>`;
      html += `<li>VAPID key obtenida: ${manager.vapidPublicKey ? '✅' : '❌'}</li>`;
      html += `<li>Soporte verificado: ${manager.isSupported ? '✅' : '❌'}</li>`;
      html += `</ul>`;
      
      // Test de inicialización
      html += '<p><strong>5. Inicialización:</strong></p>';
      try {
        await manager.init();
        html += '<ul><li>✅ Inicialización exitosa</li></ul>';
      } catch (error) {
        html += `<ul><li>❌ Error inicialización: ${error.message}</li></ul>`;
      }
    } catch (error) {
      html += `<ul><li>❌ Error creando instancia: ${error.message}</li></ul>`;
    }
  } else {
    html += '<ul><li>❌ Clase no disponible</li></ul>';
  }
  
  // Test 5: Verificar elementos DOM
  html += '<p><strong>6. Elementos DOM:</strong></p>';
  const subscribeBtn = document.getElementById('subscribe-btn');
  const unsubscribeBtn = document.getElementById('unsubscribe-btn');
  const statusText = document.getElementById('notification-status');
  
  html += `<ul>`;
  html += `<li>Botón suscribir: ${subscribeBtn ? '✅' : '❌'}</li>`;
  html += `<li>Botón desuscribir: ${unsubscribeBtn ? '✅' : '❌'}</li>`;
  html += `<li>Texto estado: ${statusText ? '✅' : '❌'}</li>`;
  html += `</ul>`;
  
  results.innerHTML = html;
}
</script>

## Instrucciones

1. Haz click en el botón "Test Sistema Push" arriba
2. Revisa los resultados del diagnóstico
3. Si todo está ✅, prueba el botón de suscripción en el sidebar
4. Abre la consola del navegador (F12) para ver logs adicionales

## Estado del Sistema

- Service Worker: Debe estar registrado
- VAPID Key: Debe estar configurada
- Botones: Deben responder a clicks
