# Contratos de API

Esta carpeta contiene los JSON Schemas canónicos de la API JSON generada por este sitio Hugo.

La app Android consume estos contratos y se sincroniza automáticamente desde este repositorio cuando cambian los schemas en `contracts/schemas/`.

## Qué se valida

La validación se ejecuta contra los ficheros reales generados en `public/` tras construir el sitio.

Los contratos actuales se mapean en [`contracts/api-contracts.yaml`](api-contracts.yaml) y cubren:

- `public/api/articles.json`
- `public/api/feed.json` y `public/api/season_*.json`
- `public/api/videos*.json`
- `public/api/social.json`
- `public/api/seasons.json`
- `public/api/historical/seasons.json`
- `public/api/historical/seasons/*.json`
- `public/api/historical/seasons/*/stats.json`
- `public/api/historical/seasons/*/games.json`

Los archivos HTML/XML de `public/api/` no forman parte del contrato JSON y no se validan con JSON Schema.

## Sincronización con Android

Cuando hay cambios en `contracts/schemas/**` y se hace push a `main`, el workflow [notify-android-api-contracts.yml](../.github/workflows/notify-android-api-contracts.yml) dispara un `repository_dispatch` hacia `Mundo-Dolphins/androidapp` con el tipo `api-contracts-updated`.

Ese workflow también se puede ejecutar manualmente con `workflow_dispatch`.

Payload enviado a Android:

- `source_repo`: `Mundo-Dolphins/mundo-dolphins.github.io`
- `contracts_ref`: commit SHA que disparó la ejecución
- `source_path`: `contracts/schemas`
- `triggering_sha`: commit SHA que disparó la ejecución
- `triggering_run_url`: URL de la ejecución en GitHub Actions

El repositorio Android debe tener un workflow que escuche `repository_dispatch` con `type: api-contracts-updated` para sincronizar y abrir su PR automático con los schemas actualizados.

## Secret requerido para notificación

El workflow de notificación necesita el secret `ANDROID_REPO_DISPATCH_TOKEN` en este repositorio.

Si usas fine-grained personal access token (recomendado):

1. `Resource owner`: `Mundo-Dolphins`.
2. `Repository access`: `Only select repositories` y seleccionar solo `androidapp`.
3. `Repository permissions`: `Contents` con `Read and write`.

Con esa configuración es suficiente para lanzar `repository_dispatch` en Android.

Si usas un PAT clásico:

- Si `Mundo-Dolphins/androidapp` es público: `public_repo`.
- Si `Mundo-Dolphins/androidapp` es privado: `repo`.

Si el secret no está configurado, el workflow falla de forma explícita.

## Cómo ejecutar la validación

Con Make:

```bash
make validate-contracts
```

Ese comando construye el sitio Hugo si es necesario y luego valida los JSON generados contra los schemas.

Si el sitio ya está construido y solo quieres validar lo generado en `public/`:

```bash
SKIP_HUGO_BUILD=1 make validate-contracts
```

También puedes ejecutar el validador directamente:

```bash
go run ./cmd/validate-contracts --root . --config contracts/api-contracts.yaml
```

## Cómo añadir un nuevo endpoint

1. Añade o actualiza el endpoint en Hugo.
2. Añade el schema correspondiente en `contracts/schemas/`.
3. Añade una entrada en [`contracts/api-contracts.yaml`](api-contracts.yaml).
4. Ejecuta `make validate-contracts`.
5. Si pasa, actualiza la documentación del contrato Android si procede.

## Proceso ante breaking changes

- No eliminar campos requeridos usados por Android sin transición.
- No cambiar tipos de campos sin crear versión nueva.
- No cambiar formatos de fechas sin compatibilidad.

Si hay que cambiar el contrato:

1. Añadir un endpoint `v2`.
2. Mantener `v1` durante un tiempo.
3. Actualizar Android para soportar `v2`.
4. Retirar `v1` solo cuando sea seguro.

Si el PR automático de Android falla tras un cambio de schema, tratar el cambio como potencialmente incompatible y aplicar versionado o compatibilidad hacia atrás antes de desplegar.

## Errores comunes

- Campo requerido ausente.
- Campo con tipo incorrecto.
- Fecha con formato inválido.
- `null` no permitido.
- URL inválida.

## Endpoints aún no cubiertos

En este momento solo se validan los contratos definidos en `api-contracts.yaml`. Si se añaden nuevos endpoints JSON, hay que incorporarlos explícitamente a ese fichero para que entren en CI.
