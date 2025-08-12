# Sistema de Notificaciones Push para Mundo Dolphins

Este sistema permite enviar notificaciones push a los usuarios cuando se publican nuevos artículos o episodios del podcast **DE FORMA AUTOMÁTICA**.

## 🚀 Configuración Inicial

### 1. Generar claves VAPID

```bash
cd scripts/
npm install web-push
node push-notifications.js generate-keys
```

### 2. Configurar GitHub Secrets

Ve a **Settings** → **Secrets and variables** → **Actions** y añade:
- `VAPID_PUBLIC_KEY`: Tu clave pública VAPID
- `VAPID_PRIVATE_KEY`: Tu clave privada VAPID

### 3. Configurar frontend

Edita `/static/js/push-notifications.js` y reemplaza:
```javascript
this.vapidPublicKey = 'TU_CLAVE_VAPID_PUBLICA_AQUI';
```
Con tu clave pública real.

### 4. Incluir en tu sitio

Añade al `<head>` de tu layout:
```html
{{ partial "pwa-head.html" . }}
```

Y donde quieras mostrar las opciones de notificaciones:
```html
{{ partial "push-notifications.html" . }}
```

## 🤖 Automatización Completa

### Notificaciones automáticas se envían cuando:

1. **📝 Nuevo contenido** - Cualquier archivo `.md` en `/content/`
2. **🎧 Nuevos episodios** - Archivos en `/content/podcast/`
3. **📰 Nuevas noticias** - Archivos en `/content/noticias/`
4. **📱 Contenido social** - Cuando el workflow de posts sociales encuentra contenido nuevo

### Workflows configurados:

- **`push-notifications.yml`** - Se ejecuta automáticamente cuando hay cambios en contenido
- **`posts.yml`** - Modificado para disparar notificaciones de contenido social

## 📱 Experiencia del Usuario

### Panel de control intuitivo:
- ✅ **Activar notificaciones** - Un clic para suscribirse
- ❌ **Desactivar** - Desuscripción fácil
- 🧪 **Probar** - Botón para verificar que funciona
- 📊 **Estado visual** - Indica claramente si están activas

### Notificaciones inteligentes:
- **🎧 Episodios**: "Nuevo episodio disponible - [Título]"
- **📰 Noticias**: "Nueva noticia - [Título]"
- **📱 Social**: "Nuevo contenido social - Publicaciones añadidas"
- **🐬 General**: "Nuevo contenido - [Título]"

## 🛠️ Gestión Manual

### Enviar notificación inmediata:
```bash
node scripts/push-notifications.js send "Título" "Mensaje" "/url-opcional"
```

### Workflow manual:
1. Ve a **Actions** → **Send Push Notifications**
2. **Run workflow**
3. Completa el formulario
4. Envío inmediato a todos los suscriptores

### Ver estadísticas:
```bash
node scripts/push-notifications.js list
```

## � Integración con tu Workflow Existente

### Evitar notificaciones para commits específicos:
```bash
git commit -m "Actualización menor [skip notifications]"
```

### El sistema detecta automáticamente:
- **Archivos nuevos** vs **modificados**
- **Tipo de contenido** (podcast, noticias, social)
- **Metadatos** (título, descripción) del frontmatter
- **URLs correctas** para cada tipo de contenido

## 📊 Monitoreo y Analytics

### Logs automáticos incluyen:
- Número de suscriptores activos
- Notificaciones enviadas exitosamente
- Errores de entrega (suscripciones inválidas se limpian automáticamente)
- Timestamps y metadatos

### GitHub Actions Summary:
Cada ejecución genera un resumen con:
- Trigger del evento
- Contenido detectado
- Notificaciones enviadas
- Estado de entrega

## 🔒 Seguridad y Privacidad

### Cumplimiento GDPR:
- ✅ **Opt-in explícito** - Los usuarios deben activar conscientemente
- ✅ **Fácil opt-out** - Desuscripción con un clic
- ✅ **Datos mínimos** - Solo se almacena la suscripción push
- ✅ **Transparencia** - Los usuarios ven claramente el estado

### Seguridad técnica:
- ✅ **HTTPS requerido** - Las notificaciones push requieren conexión segura
- ✅ **Claves VAPID** - Identificación segura del servidor
- ✅ **Service Worker** - Ejecución en contexto seguro
- ✅ **Secrets management** - Claves privadas en GitHub Secrets

## 🌐 Compatibilidad

### Navegadores soportados:
- ✅ **Chrome 50+** (Desktop y Android)
- ✅ **Firefox 44+** (Desktop y Android)
- ✅ **Safari 16+** (macOS y iOS 16.4+)
- ✅ **Edge 17+**
- ✅ **Opera 37+**

### Funcionalidades PWA:
- ✅ **Manifest.json** configurado
- ✅ **Service Worker** con cache inteligente
- ✅ **Iconos optimizados** para todas las plataformas
- ✅ **Meta tags** completos para PWA

## 🆘 Troubleshooting

### Problema: "No se muestran notificaciones"
**Solución:**
1. Verifica que los secrets estén configurados en GitHub
2. Comprueba que la clave pública esté en el frontend
3. Asegúrate de que el sitio use HTTPS

### Problema: "Service Worker no se registra"
**Solución:**
1. Verifica que `/sw.js` sea accesible
2. Comprueba permisos de archivos
3. Revisa la consola del navegador (F12)

### Problema: "Workflow no se ejecuta"
**Solución:**
1. Verifica que los cambios estén en la rama `main`
2. Comprueba que el path incluya archivos de contenido
3. Revisa que no uses `[skip notifications]` en el commit

## 📞 Soporte

Para más ayuda:
1. Revisa `SETUP-NOTIFICATIONS.md` para configuración paso a paso
2. Verifica logs en **Actions** → **Send Push Notifications**
3. Usa la consola del navegador (F12) para debugging frontend

## 🎯 Próximas Mejoras

### Funcionalidades planeadas:
- [ ] **Segmentación** - Notificaciones por tipo de contenido
- [ ] **Programación** - Envío en horarios óptimos
- [ ] **A/B Testing** - Diferentes mensajes para diferentes usuarios
- [ ] **Analytics avanzados** - Métricas de engagement
- [ ] **Push notifications rich** - Con imágenes y botones personalizados
