# 🔐 Configuración de GitHub Secrets para PWA

## ¿Qué son los GitHub Secrets?

GitHub Secrets permite almacenar información sensible de forma segura y usarla en workflows de GitHub Actions sin exponerla en el código.

## 🎯 Problema Resuelto

**Antes**: Las claves VAPID estaban hardcodeadas en el código JavaScript
**Ahora**: Las claves se inyectan de forma segura desde GitHub Secrets durante el build

## 📋 Configuración Paso a Paso

### 1. Generar Claves VAPID

```bash
cd scripts
node push-notifications-secure.js generate-keys
```

Esto generará algo como:
```
🔐 Clave pública para el frontend:
BP5wWQkaOIO1SEymue5i1GNYpC2uETmTN487aoVkauyZvcIIQH1oqGQ9X6FMy5ID_7_7YXOXSApW4apzzPJxA8I

🚀 Para uso en producción, configura estos secrets:
export VAPID_PUBLIC_KEY="BP5wWQkaOIO1SEymue5i1GNYpC2uETmTN487aoVkauyZvcIIQH1oqGQ9X6FMy5ID_7_7YXOXSApW4apzzPJxA8I"
export VAPID_PRIVATE_KEY="jxRKGsRsUCBkQpF65UX7PjntFxBQm83yOgf5tIjr1gc"
```

### 2. Configurar Secrets en GitHub

1. Ve a tu repositorio en GitHub
2. Click en **Settings** (Configuración)
3. En el menú lateral, click en **Secrets and variables** → **Actions**
4. Click en **New repository secret**
5. Añade estos secrets:

| Secret Name | Value | Descripción |
|-------------|-------|-------------|
| `VAPID_PUBLIC_KEY` | `BP5wWQkaOIO...` | Clave pública VAPID |
| `VAPID_PRIVATE_KEY` | `jxRKGsRsUCB...` | Clave privada VAPID |
| `SUBSCRIPTION_ENCRYPTION_KEY` | `$(openssl rand -hex 32)` | Opcional: Clave para encriptar suscripciones |

### 3. Verificar la Configuración

El workflow `.github/workflows/hugo.yaml` ya está configurado para usar estos secrets:

```yaml
- name: Build with Hugo
  env:
    VAPID_PUBLIC_KEY: ${{ secrets.VAPID_PUBLIC_KEY }}
  run: |
    hugo --gc --minify --buildFuture
```

## 🔧 Desarrollo Local

Para desarrollo local, usar el script de configuración:

```bash
cd scripts
source setup-dev-env.sh
hugo server --port 1319
```

Esto cargará las claves desde `vapid-config.json` de forma segura.

## 🛡️ Seguridad

### ✅ Ventajas del Sistema Actual

1. **Sin claves hardcodeadas**: Ninguna clave sensible en el código
2. **Inyección en build time**: Las claves solo se inyectan durante el build en GitHub
3. **Fallbacks seguros**: Sistema de múltiples niveles para desarrollo
4. **Separación de entornos**: Desarrollo vs. Producción claramente separados
5. **Auditoría**: GitHub registra quién accede a los secrets

### 🔒 Flujo de Seguridad

```
GitHub Secrets → GitHub Actions → Hugo Build → JavaScript Final
     ↓              ↓               ↓              ↓
  Encriptado    Variable Env    Template Hugo   Código Inyectado
```

## 🧪 Verificación

### Verificar que Funciona

1. **En producción**: La consola mostrará:
   ```
   🔐 VAPID key cargada desde GitHub Secrets de forma segura
   ✅ VAPID key cargada desde GitHub Secrets de forma segura
   ```

2. **En desarrollo**: La consola mostrará:
   ```
   🔧 Modo desarrollo - VAPID key se cargará dinámicamente
   ✅ VAPID key cargada desde meta tag de desarrollo
   ```

### Verificar que NO hay Claves Hardcodeadas

```bash
# Este comando NO debe devolver resultados
grep -r "BNVHEdU6MquHk0FNf5rMSLiGqN" static/js/
```

## 🚀 Beneficios

1. **Seguridad**: Las claves nunca aparecen en el código fuente
2. **Rotación fácil**: Cambiar secrets en GitHub y redeployar
3. **Auditoría**: GitHub registra el uso de secrets
4. **Colaboración**: Los colaboradores no necesitan las claves para desarrollar
5. **CI/CD**: Builds completamente automatizados y seguros

## 📝 Notas Importantes

- Los secrets solo están disponibles durante el build en GitHub Actions
- En desarrollo local, se usan las claves del archivo `vapid-config.json`
- El sistema tiene múltiples fallbacks para máxima compatibilidad
- Las claves se inyectan solo en tiempo de build, nunca se almacenan en el sitio final

## 🔄 Rotación de Claves

Para rotar las claves VAPID:

1. Genera nuevas claves: `node push-notifications-secure.js generate-keys`
2. Actualiza los secrets en GitHub
3. Haz un nuevo deploy (push al repo)
4. Las nuevas claves se inyectarán automáticamente

¡El sistema está completamente configurado y es seguro! 🎉
