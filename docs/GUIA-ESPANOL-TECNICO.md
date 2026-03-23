# Guía de Español Técnico para Desarrollo

## Concordancia de Género en Términos Técnicos

### APIs y Funciones (Femenino)
- ✅ **Correcto**: "La API está obsoleta"
- ❌ **Incorrecto**: "La API está obsoleto"

- ✅ **Correcto**: "La función fue descontinuada"
- ❌ **Incorrecto**: "La función fue descontinuado"

### Métodos y Procedimientos (Masculino)
- ✅ **Correcto**: "El método está obsoleto"
- ✅ **Correcto**: "El procedimiento fue descontinuado"

### Términos Específicos del Proyecto

#### document.execCommand()
- ✅ **Correcto**: "fue declarada obsoleta" (refiriéndose a la función)
- ✅ **Correcto**: "función obsoleta" (concordancia femenina)
- ❌ **Incorrecto**: "fue obsoleto", "método obsoleto" (cuando se refiere a la función)

#### Clipboard API
- ✅ **Correcto**: "La API moderna de Clipboard"
- ✅ **Correcto**: "API obsoleta"

## Términos Técnicos Recomendados

### En lugar de anglicismos:
- **"deprecated"** → **"obsoleta/obsoleto"** o **"descontinuada/descontinuado"**
- **"legacy"** → **"heredado/a"** o **"antiguo/a"**
- **"fallback"** → **"respaldo"** o **"alternativa"**

### Ejemplos en contexto:
```javascript
/**
 * NOTA: Esta función fue declarada obsoleta en 2020
 * La API moderna de Clipboard es la alternativa recomendada
 * Este método heredado se mantiene como respaldo
 */
```

## Aplicación en el Proyecto

### Comentarios corregidos:
```javascript
// Antes (incorrecto)
console.warn('Usando execCommand fallback (obsoleto)');

// Después (correcto)
console.warn('Usando execCommand fallback (función obsoleta)');
```

### Documentación corregida:
```markdown
<!-- Antes -->
- APIs deprecadas explicadas

<!-- Después -->
- APIs obsoletas explicadas
```

## Beneficios

1. **Profesionalismo**: Código más pulido y profesional
2. **Claridad**: Mejor comprensión para desarrolladores hispanohablantes
3. **Estándares**: Cumplimiento con normas del español técnico
4. **Mantenibilidad**: Documentación más clara y precisa
