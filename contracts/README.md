# Contratos de API

Esta carpeta contiene copias versionadas de los JSON Schemas que definen el contrato que la app Android espera actualmente de la API JSON generada por este sitio Hugo.

La fuente de verdad de esos schemas vive en el repositorio Android. Aquí se guardan copias sincronizadas para que este servicio web pueda validar en CI que los JSON reales que genera siguen cumpliendo el contrato.

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

## Cómo sincronizar los schemas

1. Cambia el contrato en el repositorio Android.
2. Regenera o exporta los schemas en Android dentro de `contracts/schemas/`.
3. Copia esos schemas a este repositorio.
4. Ajusta [`contracts/api-contracts.yaml`](api-contracts.yaml) si cambian rutas o si aparece un nuevo endpoint.
5. Ejecuta la validación localmente antes de subir cambios.

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

## Proceso recomendado para cambios de contrato

- Si el servicio web necesita añadir un campo nuevo opcional, puede hacerlo y el contrato debería seguir pasando.
- Si necesita eliminar o cambiar un campo requerido, primero hay que actualizar la app Android.
- Una vez la app Android soporte el nuevo contrato, actualizar los schemas.
- Después actualizar el servicio web.
- Nunca romper directamente un contrato consumido por una app publicada.

## Errores comunes

- Campo requerido ausente.
- Campo con tipo incorrecto.
- Fecha con formato inválido.
- `null` no permitido.
- URL inválida.

## Endpoints aún no cubiertos

En este momento solo se validan los contratos definidos en `api-contracts.yaml`. Si se añaden nuevos endpoints JSON, hay que incorporarlos explícitamente a ese fichero para que entren en CI.
