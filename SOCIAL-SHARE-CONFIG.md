# Configuración de Botones de Compartir en Redes Sociales

## Configuración en hugo.yaml

```yaml
params:
  socialShare:
    enabled: true              # Habilitar/deshabilitar sistema completo
    autoLoadScript: true       # Cargar script automáticamente
    contentTypes:              # Tipos de contenido que incluyen botones
      - noticias
      - podcast  
      - historia
```

## Uso en Contenido

### Habilitar en Página Específica
```yaml
---
title: "Mi Artículo"
socialShare: true
---
```

### Deshabilitar en Página Específica
```yaml
---
title: "Mi Artículo"
socialShare: false
---
```

## Uso en Templates

### Mostrar Botones de Compartir
```html
<!-- Automático: se muestra según configuración -->
{{ partial "social-share.html" . }}

<!-- Manual: siempre se muestra -->
<div class="social-share">
  <!-- contenido del partial -->
</div>
```

### Cargar Script de Funcionalidad
```html
<!-- Automático: se carga según configuración -->
{{ partial "social-share-script.html" . }}

<!-- Manual: siempre se carga -->
<script src="{{ "js/social-share.js" | relURL }}" defer></script>
```

## Personalización Avanzada

### Añadir Nuevo Tipo de Contenido
```yaml
params:
  socialShare:
    contentTypes:
      - noticias
      - podcast
      - historia
      - eventos        # nuevo tipo
```

### Deshabilitar Carga Automática
```yaml
params:
  socialShare:
    enabled: true
    autoLoadScript: false     # cargar manualmente
```

## Verificar Configuración

Usar el helper para verificar si debe mostrarse:
```html
{{- $shouldShow := partial "should-show-social-share.html" . -}}
{{- if $shouldShow -}}
  <!-- Mostrar botones -->
{{- end -}}
```

## Monitoreo y Mantenimiento

### Console Warnings
El sistema emite warnings cuando usa métodos obsoletos:
```
Usando execCommand fallback (función obsoleta). Considerar actualizar navegador o habilitar HTTPS.
```

### Plan de Migración
- **2026**: Revisar soporte de navegadores antiguos
- **Futuro**: Considerar remover fallback execCommand si ya no es necesario

## Estructura de Archivos

```
layouts/partials/
├── social-share.html                    # Componente principal
├── social-share-script.html            # Carga de script
└── should-show-social-share.html       # Lógica de detección

static/js/
└── social-share.js                      # Funcionalidad JavaScript

hugo.yaml                               # Configuración principal
```
