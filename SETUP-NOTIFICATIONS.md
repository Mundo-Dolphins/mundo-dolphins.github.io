# Configuración de Secrets para Notificaciones Push

Para que el sistema de notificaciones push funcione correctamente, necesitas configurar los siguientes secrets en tu repositorio de GitHub.

## 🔑 Secrets requeridos

Ve a: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

### 1. VAPID_PUBLIC_KEY
- **Nombre**: `VAPID_PUBLIC_KEY`
- **Valor**: Tu clave pública VAPID (la obtienes ejecutando el comando de abajo)

### 2. VAPID_PRIVATE_KEY
- **Nombre**: `VAPID_PRIVATE_KEY`
- **Valor**: Tu clave privada VAPID (la obtienes ejecutando el comando de abajo)

## 🔧 Generar claves VAPID

Ejecuta estos comandos para generar las claves:

```bash
cd scripts/
npm install
node push-notifications.js generate-keys
```

Esto te dará una salida como:
```
Claves VAPID generadas:
Pública: BNVHEdU6MquHk0FNf5rMSLiGqN-4HjueaGeDztf-rCjaJHaM-3bmGJ6Lxj-2QfRgZygiioAwJp9yjgsKhEW9IZ0
Privada: 4681eFQdfmv8s7Br-DnT7MDl9m3dI5GnKQRh74sjdag

Añade estas claves a tu configuración
```

## 📋 Pasos para configurar

1. **Genera las claves VAPID** (comando de arriba)
   - **⚠️ Importante**: Cada vez que ejecutes `generate-keys` se crean claves nuevas
   - Usa las claves generadas la primera vez para mantener consistencia

2. **Añade los secrets en GitHub**:
   - Ve a tu repositorio en GitHub
   - Settings → Secrets and variables → Actions
   - New repository secret
   - Añade `VAPID_PUBLIC_KEY` con la clave pública: `BNVHEdU6MquHk0FNf5rMSLiGqN-4HjueaGeDztf-rCjaJHaM-3bmGJ6Lxj-2QfRgZygiioAwJp9yjgsKhEW9IZ0`
   - Añade `VAPID_PRIVATE_KEY` con la clave privada: `4681eFQdfmv8s7Br-DnT7MDl9m3dI5GnKQRh74sjdag`

3. **Actualiza la clave pública en el frontend**:
   - Edita `/static/js/push-notifications.js`
   - Reemplaza `TU_CLAVE_VAPID_PUBLICA_AQUI` con tu clave pública
   - **Ya está actualizado** con: `BNVHEdU6MquHk0FNf5rMSLiGqN-4HjueaGeDztf-rCjaJHaM-3bmGJ6Lxj-2QfRgZygiioAwJp9yjgsKhEW9IZ0`

4. **Prueba el sistema**:
   - Haz commit de un cambio en `/content/`
   - El workflow debería ejecutarse automáticamente
   - O ejecuta manualmente desde Actions

## ✅ Verificación

Para verificar que todo funciona:

1. **Ejecuta el workflow manualmente**:
   - Ve a Actions → Send Push Notifications
   - Run workflow
   - Añade un título y mensaje de prueba

2. **Verifica en tu sitio**:
   - Ve a tu sitio web
   - Busca el componente de notificaciones
   - Haz clic en "Activar notificaciones"
   - Haz clic en "Probar notificación"

## 🔒 Seguridad

- **NUNCA** commits las claves privadas en el código
- **SIEMPRE** usa GitHub Secrets para las claves
- Las claves públicas sí pueden ir en el código (van en el frontend)
- Regenera las claves si se comprometen

## 🐛 Troubleshooting

### Error: "Context access might be invalid"
- Significa que los secrets no están configurados
- Sigue los pasos de arriba para añadirlos

### Error: "VAPID key not found"
- Verifica que los secrets estén bien nombrados
- Asegúrate de que las claves sean válidas

### Las notificaciones no llegan
- Verifica que el usuario haya dado permiso
- Comprueba que el service worker esté registrado
- Revisa los logs del workflow en GitHub Actions
