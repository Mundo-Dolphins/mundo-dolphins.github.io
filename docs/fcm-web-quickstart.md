# Próximos Pasos: Activar FCM Web

## 1️⃣ Verificar Secrets en GitHub

Ve a `Settings > Secrets and variables > Actions > Repository secrets`

Estos deben existir y contener valores **reales** (NO demo):

```
✓ FIREBASE_PROJECT_ID          → "mi-proyecto-firebase"
✓ FIREBASE_PRIVATE_KEY         → "-----BEGIN PRIVATE KEY-----\n..."
✓ FIREBASE_CLIENT_EMAIL        → "firebase-adminsdk-xxx@...iam.gserviceaccount.com"
✓ FCM_TOPIC                    → "mundo-dolphins-news"
✓ FCM_VAPID_KEY                → "BExx..." (clave VAPID de Firebase Console)
```

**⚠️ Importante**: Si alguno falta o dice "demo-...", las notificaciones NO funcionarán.

### Obtener VAPID Key

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto
3. Settings (⚙️) > Project Settings
4. Pestaña "Cloud Messaging"
5. Copia la "Web Push certificates" (Key Pair)

## 2️⃣ Verificar que Hugo Workflow pasa VAPID

En `.github/workflows/hugo.yaml`, busca la sección "Build with Hugo" y verifica que tiene:

```yaml
env:
  # ... otros env vars ...
  FCM_VAPID_KEY: ${{ secrets.FCM_VAPID_KEY }}
```

Si no está, agregarla.

## 3️⃣ Verifica los cambios en Web

Los siguientes archivos fueron corregidos:

| Archivo | Cambio |
|---------|--------|
| [scripts/notify/send_notification.js](scripts/notify/send_notification.js) | Payload data-only en vez de notification + data |
| [assets/firebase-messaging-sw.js](assets/firebase-messaging-sw.js) | SW extrae datos de payload.data |
| [static/js/fcm-notifications.js](static/js/fcm-notifications.js) | Mejor handling de permisos y clicks |

## 4️⃣ Test Local en Browser

1. Abre https://mundodolphins.es
2. Abre DevTools (F12)
3. En Console, ejecuta:
   ```javascript
   console.log(window.FCM_CONFIG);  // Debe mostrar config con keys reales
   ```

4. Click en "Activar notificaciones"
5. Acepta permisos del navegador
6. Verifica logs:
   ```
   ✅ Firebase configuration loaded from environment variables
   🔥 Token FCM obtenido: <token_largo>
   ```

Si ves:
- ❌ "Using demo values" → Secrets no pasaron correctamente
- ❌ "Permission denied" → User rechazó permisos
- ❌ "Token not obtained" → Problema con VAPID key

## 5️⃣ Test del Workflow

1. Ve a GitHub > Actions
2. Abre workflow "Notify New Articles via FCM"
3. Click "Run workflow" > "Run workflow"
4. Espera que termine (~2 min)
5. Abre los logs
6. Busca:
   ```
   ✅ Sent notification to topic "mundo-dolphins-news": <message_id>
   ```

Si ves errores:
- `PERMISSION_DENIED` → Service account sin permisos (agregar "FCM API Admin")
- `SENDER_ID_MISMATCH` → El proyecto ID no coincide
- `INVALID_ARGUMENT: Invalid topic name` → Topic tiene caracteres especiales

## 6️⃣ Test Real: Crear Artículo o Episodio

1. Haz commit a rama local con:
   - Nuevo articulo en `content/noticias/test.md`
   - O nuevo episodio en `data/season_*.json`

2. Pushea a GitHub

3. Espera que se dispare:
   - Workflow "Deploy Hugo site to Pages"
   - Cuando termina, se dispara "Notify New Articles via FCM"

4. Debe llegar notificación push en navegador con web abierta

---

## Checklist de Validación

- [ ] FIREBASE_PROJECT_ID tiene valor real
- [ ] FIREBASE_PRIVATE_KEY es el JSON completo (no truncado)
- [ ] FIREBASE_CLIENT_EMAIL correcta
- [ ] FCM_TOPIC contiene solo [a-zA-Z0-9_-]
- [ ] FCM_VAPID_KEY existe en Firebase Console
- [ ] Hugo workflow envía FCM_VAPID_KEY en env
- [ ] En browser: `FCM_CONFIG.hasKeys === true`
- [ ] En browser: Token FCM se obtiene correctamente
- [ ] Workflow manual disparado y logs muestran ✅

---

## Debugging Final

Si aún no funciona, ejecuta en console:

```javascript
// Ver status completo:
{
  config: window.FCM_CONFIG,
  sw: navigator.serviceWorker && await navigator.serviceWorker.getRegistration('/'),
  messaging: window.fcmManager && window.fcmManager.messaging,
  token: window.fcmManager && window.fcmManager.token,
  permission: Notification.permission
}
```

Revisa [docs/fcm-web-debugging.md](docs/fcm-web-debugging.md) para más detalles.
