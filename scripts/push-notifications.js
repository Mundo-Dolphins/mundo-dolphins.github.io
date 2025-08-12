#!/usr/bin/env node
/**
 * Script de ejemplo para enviar notificaciones push
 * Necesitarás instalar: npm install web-push
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// Cargar configuración VAPID (solo si no estamos generando claves)
function loadVapidKeys() {
  // Priorizar variables de entorno
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
  }
  
  // Intentar desde archivo de configuración local
  const configPath = path.join(__dirname, 'vapid-config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.error('Error cargando configuración VAPID:', error);
    }
  }
  
  // No usar fallbacks inválidos - retornar null
  return null;
}

// Solo configurar VAPID si no estamos generando claves y tenemos claves válidas
if (process.argv[2] !== 'generate-keys') {
  // Configuración VAPID
  const vapidKeys = loadVapidKeys();

  // Verificar que tenemos claves válidas
  if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    console.error('❌ Error: Claves VAPID no configuradas.');
    console.log('📋 Opciones para configurar claves VAPID:');
    console.log('   1. Variables de entorno: VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY');
    console.log('   2. Archivo local: scripts/vapid-config.json');
    console.log('   3. Generar nuevas: node push-notifications.js generate-keys');
    
    if (process.argv[2] !== undefined) {
      process.exit(1);
    }
  } else {
    try {
      webpush.setVapidDetails(
        'mailto:contacto@mundodolphins.es',
        vapidKeys.publicKey,
        vapidKeys.privateKey
      );
    } catch (error) {
      console.error('❌ Error configurando claves VAPID:', error.message);
      console.log('💡 Ejecuta "node push-notifications.js generate-keys" para generar claves válidas');
      process.exit(1);
    }
  }
}

// Base de datos simple con archivos JSON 
// ⚠️ ADVERTENCIA: Este almacenamiento basado en archivos NO es adecuado para producción
// TODO: Implementar base de datos real con operaciones atómicas y bloqueo de archivos
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');

// Cargar suscripciones con advertencia de concurrencia
function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('❌ Error cargando suscripciones:', error);
    console.warn('⚠️  ADVERTENCIA: Almacenamiento en archivo puede perder datos en acceso concurrente');
  }
  return [];
}

// Guardar suscripciones
function saveSubscriptions(subscriptions) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
    return true;
  } catch (error) {
    console.error('Error guardando suscripciones:', error);
    return false;
  }
}

// Añadir nueva suscripción
function addSubscription(subscription) {
  const subscriptions = loadSubscriptions();
  
  // Evitar duplicados
  const exists = subscriptions.find(sub => 
    sub.endpoint === subscription.endpoint
  );
  
  if (!exists) {
    subscriptions.push({
      ...subscription,
      createdAt: new Date().toISOString()
    });
    saveSubscriptions(subscriptions);
    console.log('Nueva suscripción añadida');
  } else {
    console.log('Suscripción ya existe');
  }
}

// Remover suscripción
function removeSubscription(subscriptionToRemove) {
  const subscriptions = loadSubscriptions();
  const filteredSubs = subscriptions.filter(sub => 
    sub.endpoint !== subscriptionToRemove.endpoint
  );
  saveSubscriptions(filteredSubs);
  console.log('Suscripción removida');
}

// Enviar notificación a todas las suscripciones
async function sendNotificationToAll(title, body, url = '/') {
  const subscriptions = loadSubscriptions();
  console.log(`Enviando notificación a ${subscriptions.length} suscriptores`);
  
  const payload = JSON.stringify({
    title: title,
    body: body,
    url: url,
    icon: '/favicon-192x192.png',
    badge: '/favicon-96x96.png',
    timestamp: Date.now()
  });

  const promises = subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, payload);
      console.log('Notificación enviada exitosamente');
    } catch (error) {
      console.error('Error enviando notificación:', error);
      
      // Si la suscripción es inválida, removerla
      if (error.statusCode === 410) {
        removeSubscription(subscription);
      }
    }
  });

  await Promise.all(promises);
}

// Ejemplo de uso desde línea de comandos
if (require.main === module) {
  const [,, action, ...args] = process.argv;
  
  switch (action) {
    case 'send':
      const [title, body, url] = args;
      if (!title || !body) {
        console.log('Uso: node push-notifications.js send "Título" "Cuerpo" [url]');
        process.exit(1);
      }
      sendNotificationToAll(title, body, url || '/');
      break;
      
    case 'list':
      const subs = loadSubscriptions();
      console.log(`Total de suscripciones: ${subs.length}`);
      subs.forEach((sub, index) => {
        console.log(`${index + 1}. ${sub.endpoint.substring(0, 50)}... (${sub.createdAt})`);
      });
      break;
      
    case 'generate-keys':
      const keys = webpush.generateVAPIDKeys();
      console.log('Claves VAPID generadas:');
      console.log('Pública:', keys.publicKey);
      console.log('Privada:', keys.privateKey);
      console.log('\nAñade estas claves a tu configuración');
      break;
      
    default:
      console.log('Comandos disponibles:');
      console.log('  send "Título" "Cuerpo" [url] - Enviar notificación');
      console.log('  list - Listar suscripciones');
      console.log('  generate-keys - Generar claves VAPID');
  }
}

module.exports = {
  addSubscription,
  removeSubscription,
  sendNotificationToAll,
  loadSubscriptions
};
