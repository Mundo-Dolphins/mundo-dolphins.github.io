# Resumen de Correcciones: Notificaciones Push Web FCM

## Problemas Encontrados y Corregidos

### ✅ 1. Payload incorrecto en Firebase Admin SDK
**Antes**: Se enviaba `notification` + `data` combinados, lo que causa que Firebase ignore `data`.
```json
{"notification": {...}, "data": {...}}  // Problema
```

**Después**: Se envía solo `data` payload, permitiendo que la app maneje todo.
```json
{"data": {"title": "...", "body": "...", ...}}  // Correcto
```

**Archivo corregido**: [scripts/notify/send_notification.js](scripts/notify/send_notification.js#L49-L60)

### ✅ 2. Service Worker no procesaba data-only payloads
**Antes**: SW esperaba `payload.notification` que no viene en data-only.

**Después**: SW extrae todo de `payload.data`.

**Archivo corregido**: [assets/firebase-messaging-sw.js](assets/firebase-messaging-sw.js#L19-L42)

### ✅ 3. Notificaciones foreground no se mostraban correctamente
**Antes**: No verificaba permisos ni manejaba eventos de click.

**Después**: Verifica permisos, maneja clicks, y navega a URLs correctas.

**Archivo corregido**: [static/js/fcm-notifications.js](static/js/fcm-notifications.js#L350-L390)

## Archivos Creados

1. **[docs/fcm-web-diagnostics.md](docs/fcm-web-diagnostics.md)**
   - Diagnóstico detallado de problemas identificados
   - Explicación técnica de por qué no funcionaba

2. **[docs/fcm-web-debugging.md](docs/fcm-web-debugging.md)**
   - Guía completa de debugging paso a paso
   - Verificaciones en DevTools
   - Troubleshooting de errores comunes
   - Test end-to-end

3. **[scripts/notify/fcm-subscribe-backend-stub.js](scripts/notify/fcm-subscribe-backend-stub.js)**
   - Documentación sobre Backend endpoint faltante
   - TODO: Implementar en tu backend real

## Próximos Pasos

### 1. Priority: Verificar que los secrets están correctos
```bash
# En GitHub Secrets (Settings > Secrets and variables):
# Verificar que existen:
- FIREBASE_PROJECT_ID       ✓
- FIREBASE_PRIVATE_KEY      ✓ (completo, sin truncar)
- FIREBASE_CLIENT_EMAIL     ✓
- FCM_TOPIC                 ✓ (solo caracteres [a-zA-Z0-9_-])
- FCM_VAPID_KEY             ✓ (obtenerlo de Firebase Console)
```

### 2. Verificar que VAPID key está en Hugo workflow
El workflow `hugo.yaml` debe tener en `env`:
```yaml
FCM_VAPID_KEY: ${{ secrets.FCM_VAPID_KEY }}
```

### 3. Testing en local
```javascript
// En console del navegador:
window.fcmManager.showLocalNotification("Test", "Si ves esto, FCM funciona");
```

### 4. Testing end-to-end
1. Ir a la web mundodolphins.es
2. Activa notificaciones (click en "Activar notificaciones")
3. Acepta permisos del navegador
4. Vigila logs en console (F12)
5. En GitHub, ve a workflow `Notify New Articles via FCM`
6. Click "Run workflow"
7. Espera que termine
8. Debe llegar notificación push

### 5. **IMPORTANTE**: Backend endpoint para suscripciones server-side
Actualmente las suscripciones son **solo local** (localStorage). Para que Firebase realmente envíe a topic, necesitas:

**BackendImplement en tu servidor (Node.js ejemplo)**:
```javascript
// POST /api/fcm/subscribe
const admin = require('firebase-admin');

app.post('/api/fcm/subscribe', async (req, res) => {
  const { token, topic } = req.body;
  
  try {
    const response = await admin.messaging().subscribeToTopic([token], topic);
    res.json({ success: true, response });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
```

**Frontend (actualizar fcm-topic-manager.js)**:
```javascript
async subscribeToTopic(topic) {
  // Ya existe la llamada local
  // Agregar:
  const response = await fetch('/api/fcm/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: this.fcmManager.token, topic })
  });
  // ...
}
```

## Verificación Rápida
```bash
# 1. Ejecuta en browser console:
testFCMLocal()

# Debe mostrar:
# 1. Browser APIs: ✓ todos true
# 2. Firebase: ✓ disponible
# 3. FCM_CONFIG: ✓ tiene keys
# 4. fcmManager: ✓ inicializado

# 2. Si todo ✓, ya están listos los JS. 
# Ahora necesitas verificar GitHub secrets y testear workflow.
```

## Soporte
Si aún no funciona tras estos pasos:
1. Revisar [fcm-web-debugging.md](docs/fcm-web-debugging.md)
2. Verificar output del workflow en GitHub Actions
3. Ejecutar test end-to-end del documento de debugging
