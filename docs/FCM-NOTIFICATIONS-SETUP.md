# 🔔 Configuración de Notificaciones FCM para Nuevos Artículos

Este workflow de GitHub Actions detecta automáticamente nuevos artículos y envía notificaciones push usando Firebase Cloud Messaging (FCM).

## 🚀 Características

- ✅ **Detección automática** de nuevos artículos en `content/noticias/` y `content/podcast/`
- 📱 **Notificaciones push** con Firebase Cloud Messaging
- 🔗 **Enlaces directos** a los artículos nuevos
- 📊 **Resumen detallado** en GitHub Actions
- 🧪 **Modo de prueba** para testing

## ⚙️ Configuración de Secretos de GitHub

Para que el workflow funcione, necesitas configurar estos secretos en tu repositorio de GitHub:

### 1. Crear Cuenta de Servicio en Firebase

1. Ve a [Firebase Console](https://console.firebase.google.com)
2. Selecciona tu proyecto
3. Ve a **Configuración del Proyecto** ⚙️ > **Cuentas de Servicio**
4. Haz clic en **"Generar nueva clave privada"**
5. Descarga el archivo JSON

### 2. Configurar Secretos en GitHub

Ve a tu repositorio en GitHub > **Configuración** > **Secretos y variables** > **Acciones** y añade:

| Secreto                 | Descripción              | Valor                                                                                                                                                                                                            |
|-------------------------|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `FIREBASE_PROJECT_ID`   | ID del proyecto Firebase | Valor del campo `project_id` del JSON                                                                                                                                                                            |
| `FIREBASE_PRIVATE_KEY`  | Clave privada            | Valor completo del campo `private_key` del JSON. Debe incluir los delimitadores `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`. Si tienes problemas con los saltos de línea, reemplázalos por `\n`. |
| `FIREBASE_CLIENT_EMAIL` | Email del cliente        | Valor del campo `client_email` del JSON. Es obligatorio para que el workflow funcione.                                                                                                                           |
| `FCM_TOPIC`             | Tema FCM (opcional)      | `mundo-dolphins-news` (por defecto)                                                                                                                                                                              |

#### Variables de Configuración (Opcionales)

También puedes configurar estas variables en **Configuración** > **Secretos y variables** > **Variables**:

| Variable                | Descripción                                  | Valor por Defecto |
|-------------------------|----------------------------------------------|-------------------|
| `NOTIFICATION_DELAY_MS` | Retraso entre notificaciones en milisegundos | `1000`            |

### 3. Configurar Tema FCM

En tu aplicación web, suscribe a los usuarios al tema:

```javascript
// En tu código FCM
import { getMessaging, getToken } from 'firebase/messaging';

const messaging = getMessaging();

// Suscribir al tema después de obtener el token
getToken(messaging, { vapidKey: 'tu-vapid-key' }).then((token) => {
  // Enviar token al servidor para suscribir al tema
  fetch('/api/subscribe-to-topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      token: token, 
      topic: 'mundo-dolphins-news' 
    })
  });
});
```

## 🔄 Funcionamiento del Workflow

### Activación

- **Automática**: Se ejecuta cuando se hace push a `main` con nuevos archivos `.md` en las carpetas de contenido
- **Manual**: Se puede ejecutar manualmente desde GitHub Actions

### Proceso

1. **Detección**: Compara commits para encontrar archivos nuevos
2. **Extracción**: Lee el frontmatter (título, autor, fecha) de cada artículo
3. **Generación**: Crea URLs basadas en la estructura del sitio
4. **Notificación**: Envía notificaciones FCM con enlace al artículo

### Estructura de Notificación

```json
{
  "notification": {
    "title": "🐬 Nuevo en Mundo Dolphins",
    "body": "Título del artículo"
  },
  "data": {
    "url": "https://mundodolphins.es/noticias/articulo/",
    "title": "Título del artículo",
    "author": "Autor",
    "section": "noticias",
    "timestamp": "2025-08-13T10:00:00.000Z"
  }
}
```

## 🧪 Testing

### Ejecutar en Modo de Prueba

1. Ve a **Acciones** en tu repositorio
2. Selecciona **"🔔 Notify New Articles via FCM"**
3. Haz clic en **"Ejecutar workflow"**
4. Marca **"Ejecutar en modo de prueba"**
5. Ejecuta

### Debug

- Revisa los logs en Acciones de GitHub
- Comprueba que los secretos estén configurados
- Verifica que los usuarios estén suscritos al tema FCM

## 📝 Formatos de Archivo Soportados

El workflow detecta archivos con este frontmatter:

```yaml
---
title: 'Título del Artículo'
date: 2025-08-13T10:00:00+02:00
author: Nombre del Autor
authorLink: https://ejemplo.com/perfil
---
```

## 🔧 Personalización

### Cambiar el Tema FCM

Modifica el secreto `FCM_TOPIC` o edita el workflow:

```yaml
env:
  FCM_TOPIC: ${{ secrets.FCM_TOPIC || 'tu-tema-personalizado' }}
```

### Añadir Más Secciones

Edita las rutas monitoreadas en el workflow:

```yaml
on:
  push:
    paths:
      - 'content/noticias/**/*.md'
      - 'content/podcast/**/*.md'
      - 'content/nueva-seccion/**/*.md'  # Nueva sección
```

## ❗ Troubleshooting

### Error: "Service account object must contain a string 'client_email' property."

- El secreto `FIREBASE_CLIENT_EMAIL` es obligatorio. Asegúrate de copiar el valor exacto del campo `client_email` del JSON de la cuenta de servicio y añadirlo como secreto en GitHub.

### Error: "Invalid private key"

- Asegúrate de que `FIREBASE_PRIVATE_KEY` incluye `-----BEGIN PRIVATE KEY-----` y `-----END PRIVATE KEY-----`.
- Si tienes problemas con los saltos de línea, reemplázalos por `\n`.

### Error: "Topic not found"

- Verifica que el tema existe y tiene suscriptores.
- Los temas se crean automáticamente cuando el primer usuario se suscribe.

### No se envían notificaciones

- Comprueba que hay usuarios suscritos al tema.
- Verifica los permisos de la cuenta de servicio Firebase.
- Revisa los logs del workflow en Acciones de GitHub.

## 📊 Monitoreo

- **Acciones de GitHub**: Logs detallados y resumen en cada ejecución
- **Consola Firebase**: Estadísticas de mensajes enviados
- **Analytics**: Tracking de clicks y engagement en las notificaciones
