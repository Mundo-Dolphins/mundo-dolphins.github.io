#!/usr/bin/env node
/**
 * Script de ejemplo para enviar notificaciones push
 * Necesitarás instalar: npm install web-push
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

// Cache para configuración VAPID
let vapidKeysCache = null;
let lastConfigLoad = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

// Cargar configuración VAPID con cache (solo si no estamos generando claves)
function loadVapidKeys() {
  const now = Date.now();
  
  // Usar cache si está disponible y no ha expirado
  if (vapidKeysCache && (now - lastConfigLoad) < CONFIG_CACHE_TTL) {
    return vapidKeysCache;
  }
  
  // Priorizar variables de entorno
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeysCache = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY
    };
    lastConfigLoad = now;
    return vapidKeysCache;
  }
  
  // Intentar desde archivo de configuración local (asíncrono no bloqueante)
  const configPath = path.join(__dirname, 'vapid-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = fs.readFileSync(configPath, 'utf8');
      vapidKeysCache = JSON.parse(data);
      lastConfigLoad = now;
      return vapidKeysCache;
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

// Sistema de almacenamiento mejorado con bloqueo básico
// ⚠️ ADVERTENCIA: Este almacenamiento basado en archivos NO es adecuado para producción
// TODO: Implementar base de datos real con operaciones atómicas (PostgreSQL, MongoDB, etc.)
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'subscriptions.json');
const LOCK_FILE = path.join(__dirname, 'subscriptions.lock');

// Implementar bloqueo básico de archivos
class FileLocker {
  constructor(lockFile) {
    this.lockFile = lockFile;
    this.maxRetries = 10;
    this.retryDelay = 100; // ms
  }
  
  async acquireLock() {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        fs.writeFileSync(this.lockFile, process.pid.toString(), { flag: 'wx' });
        return true;
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Lock existe, esperar y reintentar
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('No se pudo adquirir el bloqueo de archivo después de varios intentos');
  }
  
  releaseLock() {
    try {
      fs.unlinkSync(this.lockFile);
    } catch (error) {
      // Ignorar errores al liberar el lock
    }
  }
}

const fileLocker = new FileLocker(LOCK_FILE);

// Cargar suscripciones con bloqueo de archivos
async function loadSubscriptions() {
  try {
    await fileLocker.acquireLock();
    
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
    
    return [];
  } catch (error) {
    console.error('❌ Error cargando suscripciones:', error);
    console.warn('⚠️  ADVERTENCIA: Almacenamiento en archivo puede perder datos en acceso concurrente');
    return [];
  } finally {
    fileLocker.releaseLock();
  }
}

// Guardar suscripciones con bloqueo de archivos
async function saveSubscriptions(subscriptions) {
  try {
    await fileLocker.acquireLock();
    
    // Escritura atómica usando archivo temporal
    const tempFile = SUBSCRIPTIONS_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(subscriptions, null, 2));
    fs.renameSync(tempFile, SUBSCRIPTIONS_FILE);
    
    return true;
  } catch (error) {
    console.error('Error guardando suscripciones:', error);
    return false;
  } finally {
    fileLocker.releaseLock();
  }
}

// Añadir nueva suscripción con operaciones atómicas
async function addSubscription(subscription) {
  const subscriptions = await loadSubscriptions();
  
  // Evitar duplicados
  const exists = subscriptions.find(sub => 
    sub.endpoint === subscription.endpoint
  );
  
  if (!exists) {
    subscriptions.push({
      ...subscription,
      createdAt: new Date().toISOString()
    });
    return await saveSubscriptions(subscriptions);
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

// Enviar notificación a todos los suscriptores con operaciones async
async function sendNotificationToAll(title, body, url) {
  const subscriptions = await loadSubscriptions();
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
