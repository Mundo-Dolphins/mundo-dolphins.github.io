#!/usr/bin/env node
const admin = require('firebase-admin');
const fs = require('fs');

const DEFAULT_NOTIFICATION_DELAY_MS = 1000;
const BASE64_REGEX = /^[A-Za-z0-9+/=\s\r\n]+$/;

const VALIDATION_CONSTANTS = {
  HARD_MIN_PRIVATE_KEY_LENGTH: 344,
  MIN_PRIVATE_KEY_LENGTH: 344
};

const NOTIFICATION_CONFIG = {
  NOTIFICATION_DELAY_MS: parseInt(process.env.NOTIFICATION_DELAY_MS, 10) || DEFAULT_NOTIFICATION_DELAY_MS
};

function validateAndProcessPrivateKey(privateKey) {
  if (!privateKey) {
    throw new Error('FIREBASE_PRIVATE_KEY environment variable is not set');
  }
  let processedKey = privateKey.includes('\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  if (!processedKey.includes('-----BEGIN PRIVATE KEY-----') || !processedKey.includes('-----END PRIVATE KEY-----')) {
    throw new Error('Invalid private key format. Key must include BEGIN and END markers.');
  }
  const keyContent = processedKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
  if (keyContent.length < VALIDATION_CONSTANTS.MIN_PRIVATE_KEY_LENGTH) {
    throw new Error('Private key appears to be too short or malformed');
  }
  try {
    if (!BASE64_REGEX.test(keyContent)) {
      throw new Error('Private key content does not appear to be valid base64');
    }
    Buffer.from(keyContent, 'base64');
  } catch (base64Error) {
    throw new Error('Private key base64 validation failed: ' + base64Error.message);
  }
  return processedKey;
}

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: validateAndProcessPrivateKey(process.env.FIREBASE_PRIVATE_KEY),
  client_email: process.env.FIREBASE_CLIENT_EMAIL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID
});

async function sendNotifications() {
  try {
    const articles = JSON.parse(fs.readFileSync('articles.json', 'utf8'));
    const topic = process.env.FCM_TOPIC;
    console.log(`📤 Sending notifications for ${articles.length} article(s) to topic: ${topic}`);
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const message = {
        topic: topic,
        notification: {
          title: '🐬 Nuevo en Mundo Dolphins',
          body: article.title
        },
        data: {
          url: article.url,
          title: article.title,
          author: article.author,
          section: article.section,
          timestamp: new Date().toISOString()
        },
        android: {
          notification: {
            icon: 'ic_notification',
            color: '#008B8B',
            clickAction: article.url
          }
        },
        webpush: {
          notification: {
            icon: '/favicon-192x192.png',
            badge: '/favicon-96x96.png',
            tag: 'mundo-dolphins-article',
            requireInteraction: true,
            actions: [
              {
                action: 'read',
                title: 'Leer artículo',
                icon: '/favicon-96x96.png'
              }
            ]
          },
          fcmOptions: {
            link: article.url
          }
        }
      };
      console.log(`📨 Sending notification for: "${article.title}"`);
      console.log(`🔗 URL: ${article.url}`);
      const response = await admin.messaging().send(message);
      console.log(`✅ Notification sent successfully: ${response}`);
      if (i < articles.length - 1 && NOTIFICATION_CONFIG.NOTIFICATION_DELAY_MS > 0) {
        await new Promise(resolve => setTimeout(resolve, NOTIFICATION_CONFIG.NOTIFICATION_DELAY_MS));
      }
    }
    console.log('🎉 All notifications sent successfully!');
  } catch (error) {
    console.error('❌ Error sending notifications:', error);
    process.exit(1);
  }
}

sendNotifications();
