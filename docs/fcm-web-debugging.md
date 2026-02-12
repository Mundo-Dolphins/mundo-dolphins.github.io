# Guía de Debugging: Notificaciones Push Web FCM

## Checklist de Verificación

### 1. En el navegador console (DevTools)

Abre `F12 > Console` y verifica estos logs:

```javascript
// Busca estos logs en orden:
"🔥 Firebase Config loaded: production"  // o "development"
"✅ Firebase configuration loaded from environment variables"  // o "Using demo values"
"🔥 FCMNotificationManager iniciado"
"🔥 Soporte: true"  // Debe ser true
"🔥 Iniciando FCM..."
"🔄 Registrando Service Worker FCM..."
"✅ Service Worker listo"
"🔥 Token FCM obtenido: <token>"  // Largo string
"✅ Notificaciones activas"
```

**Si ves "Using demo values":** Las env vars de Firebase no se inyectaron.

### 2. Verificar Service Worker

En DevTools:
- Ir a: `Application > Service Workers`
- Debe haber un SW con scope `/`
- Estado debe ser "activated and running"

Si no aparece:
```javascript
console.log(await navigator.serviceWorker.getRegistration('/'));
```

### 3. Verificar VAPID key

En console:
```javascript
console.log(window.FCM_CONFIG.vapidKey);  // Debe ser un string largo, no vacío
```

Si está vacío: Agregar `FCM_VAPID_KEY` a GitHub Secrets en workflow Hugo.

### 4. Verificar Subscribe button

Cuando hagas clic en "Activar notificaciones":
- Debe pedir permisos del navegador
- Después de aceptar, debe mostrar log: `"✅ Token FCM obtenido: ..."`
- El button debe cambiar a "Desactivar"

### 5. Enviar notificación de prueba

En console, ejecuta:
```javascript
// Solo funciona si SW está activo
if (window.fcmManager && window.fcmManager.messaging) {
  window.fcmManager.showLocalNotification(
    "Test Notification",
    "This is a test"
  );
}
```

Debe mostrar notificación en esquina del navegador.

## Debugging del Workflow Web

### Verificar que las env vars llegan al workflow

En `.github/workflows/notify-new-articles.yml`, agrega debugging:

```yaml
- name: 🔔 Send Web FCM notifications
  env:
    FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
    FIREBASE_PRIVATE_KEY: ${{ secrets.FIREBASE_PRIVATE_KEY }}
    FIREBASE_CLIENT_EMAIL: ${{ secrets.FIREBASE_CLIENT_EMAIL }}
    FCM_TOPIC: ${{ secrets.FCM_TOPIC || 'mundo-dolphins-news' }}
    NOTIFICATION_DELAY_MS: ${{ vars.NOTIFICATION_DELAY_MS || '1000' }}
  run: |
    echo "Project ID: $FIREBASE_PROJECT_ID" | head -c 50
    echo "..."
    node scripts/notify/send_notification.js 2>&1 | head -20
```

### Verificar que notifications.json se genera

Agrega step en workflow:

```yaml
- name: Debug notifications file
  run: |
    if [ -f scripts/notify/notifications.json ]; then
      echo "✅ notifications.json exists"
      cat scripts/notify/notifications.json | jq '.' | head -30
    else
      echo "❌ notifications.json not found"
    fi
```

### Manualmente disparar test

En GitHub:
1. Ve a workflow `notify-new-articles.yml`
2. Click en "Run workflow"
3. Mantén default y "Run workflow"
4. Espera que termine
5. Abre el output
6. Busca errores de Firebase

## Errores Comunes

### ❌ "Credentials_invalid" o "PERMISSION_DENIED"

**Causa**: Firebase credentials (private key, email) son inválidos.

**Solución**:
```bash
# En Google Cloud Console:
# 1. Ve a IAM
# 2. Crea nueva service account con nombre descriptivo
# 3. Agrega role: "Firebase Cloud Messaging API Admin"
# 4. Crea JSON key
# 5. Copia el JSON completo al secret FIREBASE_PRIVATE_KEY
```

### ❌ "Topic name not valid"

**Causa**: El topic tiene caracteres inválidos o está vacío.

**Solución**: Verificar que `FCM_TOPIC` en GitHub Secrets solo contenga `[a-zA-Z0-9_-]`.

### ❌ "Service Worker failed to activate"

**Causa**: El `firebase-messaging-sw.js` tiene error de sintaxis.

**Solución**:
1. Abre DevTools Network tab
2. Filtra por `/firebase-messaging-sw.js`
3. Click en el request
4. Check "Preview" o "Response" por errores JavaScript
5. Ver console del SW: `chrome://serviceworker-internals/`

### ❌ Push recibida pero no aparece notificación

**Causa**: 
- SW activo pero message handler no dispara
- Permiso no otorgado
- `requireInteraction: false` hace que se cierre automáticamente

**Solución**:
1. Cambiar `requireInteraction: true` temporalmente
2. Verificar logs en Service Worker console
3. Verificar que `Notification.permission === 'granted'`

## Test End-to-End

```bash
# 1. Activar notificaciones en web (permitir permisos)
# 2. Abrir DevTools Console
# 3. Ejecutar:

# Ver SW status
console.log('SW:', await navigator.serviceWorker.getRegistration('/'));

# Ver notificaciones locales
window.fcmManager.showLocalNotification("Test", "Is this visible?");

# Ver token
console.log('Token:', window.fcmManager.token);

# 4. En GitHub Actions, disparar manual workflow notify-new-articles.yml
# 5. Si todo está bien, debe llegar la notificación
```
