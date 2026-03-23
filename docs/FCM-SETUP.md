# Configuración de Firebase Cloud Messaging

## Pasos para configurar FCM:

### 1. Crear proyecto en Firebase Console
1. Ve a https://console.firebase.google.com/
2. Crea un nuevo proyecto: "mundo-dolphins-push"
3. En Project Settings > General > Your apps
4. Añade una Web App: "mundo-dolphins-web"
5. Copia la configuración de Firebase

### 2. Generar certificado VAPID
1. En Project Settings > Cloud Messaging
2. En "Web configuration" > Generate key pair
3. Copia la clave pública VAPID

### 3. Configurar GitHub Secrets
Añade estos secrets en GitHub:
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FCM_VAPID_KEY` (clave pública VAPID de FCM)

### 4. Archivos que se crearán:
- `static/js/firebase-config.js` - Configuración de Firebase
- `static/firebase-messaging-sw.js` - Service Worker de FCM
- `static/js/fcm-notifications.js` - Manager de notificaciones FCM
- `layouts/partials/fcm-config.html` - Configuración desde GitHub Secrets

### 5. Para enviar notificaciones:
Puedes usar:
- Firebase Console > Cloud Messaging > Send test message
- API REST de FCM desde cualquier script/aplicación
- Funciones de Firebase para automatizar

## Ventajas de FCM:
- ✅ Completamente gratuito
- ✅ Funciona con sitios estáticos
- ✅ SDK oficial de Google
- ✅ Soporte cross-platform
- ✅ Analytics integrado
- ✅ Entrega garantizada
