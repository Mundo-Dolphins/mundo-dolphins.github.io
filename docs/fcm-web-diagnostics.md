# Diagnóstico: Notificaciones Push Web FCM

## Problemas Detectados

### 1. **Firebase Admin SDK envia datos incompletos**
El workflow web usa `send_notification.js` con Firebase Admin SDK, que actualmente envía:
```json
{
  "notification": {
    "title": "...",
    "body": "..."
  },
  "data": {
    "title": "...",
    "body": "...",
    "url": "...",
    "type": "...",
    "episode_id": "...",
    "article_published_timestamp": "..."
  }
}
```

**Problema**: HTTP v1 con `notification` + `data` combined puede causar que el navegador ignore `data` payload. Firebase Web SDK solo procesa `notification` en foreground si ambos están presentes.

**Solución**: Usar solo `data` payload sin `notification`, dejando que la app maneje todo.

### 2. **Service Worker no se activa correctamente**
- El SW se carga desde `{{ $fcmSw.RelPermalink }}` (prefetch), pero sin garantía.
- FCM depende de SW activo para recibir background messages.
- Si SW no está registrado, las notificaciones background se pierden.

### 3. **Suscripción a topic solo local**
En `fcm-topic-manager.js`:
```javascript
// No server-side subscription implementado aún
```
La suscripción se guarda localmente en localStorage pero **nunca se envía al servidor**. Firebase requiere un endpoint backend que llame a `admin.messaging().subscribeToTopic(token, topic)`.

### 4. **Enviando a topic sin tokens activos**
- El workflow envia a topic genericado, pero si no hay dispositivos suscritos (y la suscripción local no sincroniza con firebase), nunca llega.

### 5. **Notificación foreground configurable**
El code sí tiene `messaging.onMessage()` pero puede no mostrarse si:
- `requireInteraction: false` hace que se cierre automáticamente.
- No hay fallback si `Notification.permission === 'default'` sin request previo.

## Recomendaciones inmediatas

1. **Cambiar payload a data-only en send_notification.js**
2. **Implementar endpoint backend para sincronizar suscripciones**
3. **Mejorar inicialización del Service Worker** con retry logic
4. **Agregar requestPermission antes de mostrar notificaciones**
5. **Logs mejorados en browser console para debuggear**
