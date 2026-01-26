const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');

const notificationsPath =
  process.env.NOTIFICATIONS_PATH ||
  path.resolve(__dirname, 'notifications.json');

const topic = process.env.FCM_TOPIC || 'mundo-dolphins-news';
const delayMs = Number(process.env.NOTIFICATION_DELAY_MS || '1000');

function loadNotifications() {
  if (!fs.existsSync(notificationsPath)) {
    console.error(`❌ Notifications file not found: ${notificationsPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(notificationsPath, 'utf8');
  return JSON.parse(raw);
}

function getServiceAccount() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.error('❌ Missing Firebase Admin credentials in environment variables.');
    process.exit(1);
  }

  return {
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n')
  };
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendNotifications(notifications) {
  if (!notifications.length) {
    console.log('✅ No notifications to send');
    return;
  }

  for (const notification of notifications) {
    const payload = {
      topic,
      notification: {
        title: notification.title || 'Mundo Dolphins',
        body: notification.body || 'Nuevo contenido disponible'
      },
      data: {
        url: notification.url || '/',
        type: notification.type || 'content'
      }
    };

    try {
      const response = await admin.messaging().send(payload);
      console.log(`✅ Sent notification to topic "${topic}":`, response);
    } catch (error) {
      console.error('❌ Failed to send notification:', error);
      process.exitCode = 1;
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

function initFirebase() {
  const serviceAccount = getServiceAccount();
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
}

async function main() {
  const notifications = loadNotifications();
  initFirebase();
  await sendNotifications(notifications);
}

main().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
