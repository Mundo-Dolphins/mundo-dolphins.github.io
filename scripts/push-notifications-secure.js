#!/usr/bin/env node
/**
 * Script mejorado para gestión segura de notificaciones push
 * Implementa almacenamiento más seguro y configuración dinámica
 */

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuración de seguridad
const SECURITY_CONFIG = {
  maxSubscriptions: 10000,
  subscriptionTTL: 30 * 24 * 60 * 60 * 1000, // 30 días en ms
  rateLimitWindow: 60 * 1000, // 1 minuto
  maxRequestsPerWindow: 10
};

// Cache de límite de tasa con limpieza automática
class RateLimitCache {
  constructor() {
    this.cache = new Map();
    this.cleanupInterval = 5 * 60 * 1000; // Limpiar cada 5 minutos
    this.startCleanupTimer();
  }
  
  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }
  
  cleanup() {
    const now = Date.now();
    const windowStart = now - SECURITY_CONFIG.rateLimitWindow;
    
    for (const [identifier, requests] of this.cache.entries()) {
      const recentRequests = requests.filter(time => time > windowStart);
      
      if (recentRequests.length === 0) {
        this.cache.delete(identifier);
      } else {
        this.cache.set(identifier, recentRequests);
      }
    }
    
    console.log(`🧹 Rate limit cache limpiado. Entradas activas: ${this.cache.size}`);
  }
  
  has(identifier) {
    return this.cache.has(identifier);
  }
  
  get(identifier) {
    return this.cache.get(identifier) || [];
  }
  
  set(identifier, value) {
    this.cache.set(identifier, value);
  }
}

const rateLimitCache = new RateLimitCache();

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
  
  return null;
}

// Verificación de límite de tasa
function checkRateLimit(identifier) {
  const now = Date.now();
  const windowStart = now - SECURITY_CONFIG.rateLimitWindow;
  
  if (!rateLimitCache.has(identifier)) {
    rateLimitCache.set(identifier, []);
  }
  
  const requests = rateLimitCache.get(identifier);
  // Limpiar requests antiguos
  const recentRequests = requests.filter(time => time > windowStart);
  
  if (recentRequests.length >= SECURITY_CONFIG.maxRequestsPerWindow) {
    return false; // Límite excedido
  }
  
  recentRequests.push(now);
  rateLimitCache.set(identifier, recentRequests);
  return true;
}

// Generar ID seguro para suscripción
function generateSecureId() {
  return crypto.randomBytes(16).toString('hex');
}

// Validar origen de la solicitud con configuración por ambiente
function validateOrigin(origin) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const allowedOrigins = [
    'https://mundo-dolphins.github.io',
    'https://mundodolphins.es'
  ];
  
  // Solo permitir localhost en desarrollo
  if (!isProduction) {
    // Solo HTTPS localhost en desarrollo, HTTP solo para 127.0.0.1
    allowedOrigins.push(
      'https://localhost:1313',
      'https://localhost:1319',
      'http://127.0.0.1:1313',
      'http://127.0.0.1:1319'
    );
  }
  
  const isAllowed = allowedOrigins.includes(origin);
  
  if (!isAllowed) {
    console.warn(`⚠️  Origen no autorizado rechazado: ${origin}`);
  }
  
  return isAllowed;
}

// Almacenamiento mejorado con encriptación básica
class SecureSubscriptionStorage {
  constructor() {
    this.dataDir = path.join(__dirname, 'secure-data');
    this.subscriptionsFile = path.join(this.dataDir, 'subscriptions.enc');
    this.indexFile = path.join(this.dataDir, 'index.json');
    
    // Crear directorio si no existe
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { mode: 0o700 }); // Solo propietario puede acceder
    }
    
    // Clave de encriptación segura con salt aleatorio
    this.salt = process.env.SUBSCRIPTION_SALT || this.generateSecureSalt();
    this.password = process.env.SUBSCRIPTION_PASSWORD || 'mundo-dolphins-default-change-in-production';
    
    if (!process.env.SUBSCRIPTION_SALT || !process.env.SUBSCRIPTION_PASSWORD) {
      console.warn('⚠️  ADVERTENCIA: Usando configuración de encriptación por defecto. Configure SUBSCRIPTION_SALT y SUBSCRIPTION_PASSWORD en producción.');
    }
    
    this.encryptionKey = crypto.scryptSync(this.password, this.salt, 32);
  }
  
  // Generar salt seguro para encriptación
  generateSecureSalt() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  // Encriptar datos
  encrypt(data) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipherGCM('aes-256-gcm', this.encryptionKey);
    cipher.setAAD(Buffer.from('subscription-data'));
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      data: encrypted,
      authTag: authTag.toString('hex')
    };
  }
  
  // Desencriptar datos
  decrypt(encryptedData) {
    try {
      const decipher = crypto.createDecipherGCM('aes-256-gcm', this.encryptionKey);
      decipher.setAAD(Buffer.from('subscription-data'));
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Error desencriptando datos:', error);
      return null;
    }
  }
  
  // Cargar suscripciones
  loadSubscriptions() {
    try {
      if (fs.existsSync(this.subscriptionsFile)) {
        const encryptedData = JSON.parse(fs.readFileSync(this.subscriptionsFile, 'utf8'));
        return this.decrypt(encryptedData) || [];
      }
    } catch (error) {
      console.error('Error cargando suscripciones:', error);
    }
    return [];
  }
  
  // Guardar suscripciones
  saveSubscriptions(subscriptions) {
    try {
      // Limpiar suscripciones expiradas
      const now = Date.now();
      const validSubscriptions = subscriptions.filter(sub => 
        (now - sub.timestamp) < SECURITY_CONFIG.subscriptionTTL
      );
      
      // Limitar número de suscripciones
      if (validSubscriptions.length > SECURITY_CONFIG.maxSubscriptions) {
        validSubscriptions.splice(SECURITY_CONFIG.maxSubscriptions);
      }
      
      const encryptedData = this.encrypt(validSubscriptions);
      fs.writeFileSync(this.subscriptionsFile, JSON.stringify(encryptedData), { mode: 0o600 });
      
      // Actualizar índice (solo IDs para búsqueda rápida)
      const index = validSubscriptions.map(sub => ({
        id: sub.id,
        timestamp: sub.timestamp,
        endpoint: crypto.createHash('sha256').update(sub.subscription.endpoint).digest('hex').substring(0, 16)
      }));
      
      fs.writeFileSync(this.indexFile, JSON.stringify(index), { mode: 0o600 });
      
      return true;
    } catch (error) {
      console.error('Error guardando suscripciones:', error);
      return false;
    }
  }
  
  // Añadir suscripción
  addSubscription(subscriptionData, origin) {
    if (!validateOrigin(origin)) {
      throw new Error('Origen no autorizado');
    }
    
    const subscriptions = this.loadSubscriptions();
    
    // Verificar duplicados por endpoint hash
    const endpointHash = crypto.createHash('sha256').update(subscriptionData.subscription.endpoint).digest('hex');
    const exists = subscriptions.find(sub => 
      crypto.createHash('sha256').update(sub.subscription.endpoint).digest('hex') === endpointHash
    );
    
    if (exists) {
      return exists.id; // Retornar ID existente
    }
    
    const newSubscription = {
      id: generateSecureId(),
      subscription: subscriptionData.subscription,
      timestamp: Date.now(),
      userAgent: subscriptionData.userAgent?.substring(0, 100) || 'unknown',
      origin: origin
    };
    
    subscriptions.push(newSubscription);
    
    if (this.saveSubscriptions(subscriptions)) {
      return newSubscription.id;
    }
    
    throw new Error('Error guardando suscripción');
  }
  
  // Remover suscripción
  removeSubscription(subscriptionData) {
    const subscriptions = this.loadSubscriptions();
    const endpointHash = crypto.createHash('sha256').update(subscriptionData.subscription.endpoint).digest('hex');
    
    const filteredSubscriptions = subscriptions.filter(sub =>
      crypto.createHash('sha256').update(sub.subscription.endpoint).digest('hex') !== endpointHash
    );
    
    return this.saveSubscriptions(filteredSubscriptions);
  }
}

// Instancia global de almacenamiento
const storage = new SecureSubscriptionStorage();

// Solo configurar VAPID si no estamos generando claves y tenemos claves válidas
if (process.argv[2] !== 'generate-keys') {
  const vapidKeys = loadVapidKeys();

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

// Comando para generar claves VAPID
if (process.argv[2] === 'generate-keys') {
  console.log('🔑 Generando claves VAPID...');
  
  try {
    const vapidKeys = webpush.generateVAPIDKeys();
    
    // Guardar en archivo de configuración local
    const configPath = path.join(__dirname, 'vapid-config.json');
    const config = {
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey,
      generated: new Date().toISOString()
    };
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    
    console.log('✅ Claves VAPID generadas y guardadas en vapid-config.json');
    console.log('\n📋 Para uso en producción, configura estas variables de entorno:');
    console.log(`export VAPID_PUBLIC_KEY="${vapidKeys.publicKey}"`);
    console.log(`export VAPID_PRIVATE_KEY="${vapidKeys.privateKey}"`);
    console.log(`export SUBSCRIPTION_ENCRYPTION_KEY="$(openssl rand -hex 32)"`);
    console.log('\n🔐 Clave pública para el frontend:');
    console.log(vapidKeys.publicKey);
    
  } catch (error) {
    console.error('❌ Error generando claves VAPID:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Funciones de API mejoradas con seguridad

// Endpoint de configuración PWA (seguro)
function getPWAConfig(origin) {
  if (!validateOrigin(origin)) {
    throw new Error('Origen no autorizado');
  }
  
  const vapidKeys = loadVapidKeys();
  if (!vapidKeys) {
    throw new Error('Configuración VAPID no disponible');
  }
  
  return {
    vapidPublicKey: vapidKeys.publicKey,
    supportedFeatures: ['push', 'notifications'],
    maxMessageSize: 4096
  };
}

// API para suscribirse (mejorada)
function subscribe(subscriptionData, clientInfo = {}) {
  const clientId = clientInfo.ip || 'unknown';
  
  if (!checkRateLimit(clientId)) {
    throw new Error('Límite de solicitudes excedido');
  }
  
  try {
    const subscriptionId = storage.addSubscription(subscriptionData, clientInfo.origin);
    console.log(`✅ Nueva suscripción añadida: ${subscriptionId}`);
    return { subscriptionId, success: true };
  } catch (error) {
    console.error('❌ Error añadiendo suscripción:', error);
    throw error;
  }
}

// API para desuscribirse (mejorada)
function unsubscribe(subscriptionData, clientInfo = {}) {
  const clientId = clientInfo.ip || 'unknown';
  
  if (!checkRateLimit(clientId)) {
    throw new Error('Límite de solicitudes excedido');
  }
  
  try {
    storage.removeSubscription(subscriptionData);
    console.log('✅ Suscripción removida');
    return { success: true };
  } catch (error) {
    console.error('❌ Error removiendo suscripción:', error);
    throw error;
  }
}

// Enviar notificación a todas las suscripciones (mejorado)
async function sendNotificationToAll(title, body, icon = '/assets/Mundo_Dolphins.jpg', url = '/') {
  const subscriptions = storage.loadSubscriptions();
  
  if (subscriptions.length === 0) {
    console.log('📭 No hay suscripciones activas');
    return { sent: 0, failed: 0 };
  }

  const payload = JSON.stringify({
    title,
    body,
    icon,
    badge: '/assets/logos/badge-96x96.png',
    url,
    timestamp: Date.now(),
    tag: 'mundo-dolphins-notification'
  });

  let sent = 0;
  let failed = 0;
  const failedSubscriptions = [];

  console.log(`📤 Enviando notificación a ${subscriptions.length} suscripciones...`);

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
      sent++;
    } catch (error) {
      failed++;
      console.error(`❌ Error enviando a suscripción ${sub.id}:`, error.message);
      failedSubscriptions.push(sub);
    }
  }

  // Limpiar suscripciones que fallaron permanentemente
  if (failedSubscriptions.length > 0) {
    const validSubscriptions = subscriptions.filter(sub => 
      !failedSubscriptions.find(failed => failed.id === sub.id)
    );
    storage.saveSubscriptions(validSubscriptions);
  }

  console.log(`✅ Notificación enviada: ${sent} exitosas, ${failed} fallidas`);
  return { sent, failed };
}

// Exportar funciones para uso como módulo
module.exports = {
  getPWAConfig,
  subscribe,
  unsubscribe,
  sendNotificationToAll,
  storage
};

// CLI - Enviar notificación de prueba
if (process.argv[2] === 'test') {
  const title = process.argv[3] || '🐬 Nuevo episodio disponible!';
  const body = process.argv[4] || 'Ya puedes escuchar el último episodio del podcast de Mundo Dolphins';
  const url = process.argv[5] || '/podcast/';
  
  sendNotificationToAll(title, body, '/assets/Mundo_Dolphins.jpg', url)
    .then(result => {
      console.log('📊 Resultado:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Error enviando notificación:', error);
      process.exit(1);
    });
}
