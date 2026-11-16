# Actualización automática de partidos de Miami (estadísticas + gamebook)

Fecha: 2026-11-16

## Intención

Hoy la ficha de cada partido de la temporada en curso (`data/historical/games/<año>/<id>.json`),
el gamebook oficial y los agregados de temporada/rivales se actualizan ejecutando a mano
`phins-stats` (repo privado, fuentes PFR/FootballDB). Depende de que Javi se acuerde y a menudo
llega días tarde (p. ej. el miércoles por un partido del domingo). A 2026-11-16 los partidos del
1, 8 y 15 de noviembre siguen en `"Estado": "scheduled"` y sin gamebook.

Queremos **inmediatez**: el mismo día del partido, en cuanto termine, la web debe mostrar el
resultado y las estadísticas que ofrecen ESPN (API no oficial) y NFL.com, y el gamebook en cuanto
la NFL lo publique. Todo sin intervención: workflow → PR → validaciones → merge automático.

La versión automática es **provisional por diseño**: Javi seguirá lanzando `phins-stats`
manualmente después, que sobrescribe la ficha, la temporada y los rivales con los datos completos
(snaps, puntos esperados, series, etc.).

## Objetivos

1. Detectar automáticamente que un partido de Miami ha terminado (`STATUS_FINAL` en ESPN).
2. **Pasada 1 – estadísticas:** rellenar la ficha del partido con los datos de ESPN/NFL.com,
   actualizar `seasons/<año>.json` y `rivals/index.json`, abrir PR con etiqueta `automerge`.
3. **Pasada 2 – gamebook:** cuando el PDF esté publicado en NFL.com (puede tardar horas),
   descargarlo a `assets/gamebooks/<año>/<id>.pdf`, enlazarlo en la ficha y abrir otra PR.
   Si al hacer la pasada 1 el gamebook ya está disponible, se incluye en la misma PR.
4. Añadir un workflow de validación en PRs que garantice que la web sigue compilando y que los
   datos mantienen su estructura; el merge automático solo ocurre si pasa.
5. Ponerse al día con los partidos atrasados (1, 8 y 15 nov 2026) en la primera ejecución.

## No objetivos

- Reemplazar `phins-stats` ni replicar las secciones que solo da PFR/FootballDB:
  `Conteo de snaps`, `Estadísticas avanzadas`, `Series ofensivas` quedan vacías (como en una
  ficha `scheduled`).
- Actualizar `season_stats/<año>.json` (estadísticas acumuladas de jugadores): lo hará la pasada
  manual.
- Recalcular en `seasons/<año>.json` la posición en la división ni los rankings de liga
  ("30º de 32 equipos"). Se mantiene el texto de ranking existente si no se puede calcular; solo se
  actualizan las cifras (decisión del diseñador, ver más abajo).
- Vídeos del partido (ya los gestiona otro workflow / `phins-stats`).
- Cloudflare Worker: descartado. Todo vive en GitHub y el patrón PR + automerge ya existe
  (`update-youtube-videos.yml`).

## Anti-objetivos (sería un fracaso aunque "funcione")

- Que la automatización **pise datos ya completados** por `phins-stats`. Solo actúa sobre fichas
  en `"Estado": "scheduled"` (pasada 1) o fichas `final` sin `Gamebook oficial` (pasada 2).
- Que se **cuente dos veces** un partido en `rivals/index.json` o en el récord de temporada.
- Que se fusione una PR que rompa el build de Hugo o deje JSON inválido.
- Que se enlace un gamebook de **otro partido** (la página de NFL.com trae los PDF de toda la
  jornada).
- Ruido: abrir PRs vacías o duplicadas en cada ejecución del cron.

## Restricciones y hechos verificados

- **Repo público**, minutos de Actions gratuitos. `main` recibe commits directos del CMS de
  noticias. *Corrección (2026-11-16, tras el despliegue):* `main` **sí está protegida** por la
  ruleset "Main" (id 4210217; la API de protección clásica devuelve 404 y no la muestra): exige
  PR con squash y un check obligatorio, con la rama al día (`strict`). El CMS (integración 85455)
  y el rol de repositorio 4 están en su lista de bypass. El check obligatorio era `automerge`
  (el job del `automerge.yml` antiguo); se ha cambiado a `validate` (job de `pr-checks`).
- Secreto `PUSH` (PAT) ya usado para crear PRs que sí disparan workflows; reutilizarlo.
- Patrón existente a imitar: `.github/workflows/update-youtube-videos.yml` +
  `.github/scripts/update_videos.py` (Python 3.11, `requests`,
  `peter-evans/create-pull-request@v8`, label `automerge`).
- `hugo.yaml` (deploy) solo corre en push a `main`; Hugo 0.158.0 extended,
  `hugo --gc --buildFuture`; `make validate-contracts` (Go, `tools/validate-contracts`,
  `contracts/api-contracts.yaml`).
- **ESPN calendario:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/mia/schedule?season=<año>`
  da por evento: id ESPN, fecha UTC, semana, `status.type.name` (`STATUS_FINAL`,
  `STATUS_SCHEDULED`), equipos. Para preseason/playoffs hay que pasar `seasontype=1|3`.
- **ESPN detalle:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=<id>`
  (boxscore de equipo y jugadores, linescore, scoringPlays, gameInfo con estadio/asistencia/clima,
  oficiales). Comprobar en el build qué campos existen realmente.
- **NFL.com página de partido:** `https://www.nfl.com/games/{visitante}-at-{local}-{año}-{reg|pre|post}-{semana}`
  con apodos en minúsculas (`dolphins-at-colts-2026-reg-10`, `lions-at-dolphins-2026-reg-9`).
  Se descarga con un `curl` normal (200, ~1,2 MB, User-Agent de navegador). El HTML (payload
  de Next.js, comillas escapadas) contiene un `gameSummary` por cada partido de la jornada con
  `gameId`, `phase` (`FINAL`), `attendance`, `weather`, `gameBookUrl`
  (`https://static.www.nfl.com/image/upload/v…/gamecenter/<gameId>.pdf`). Para elegir el de Miami
  hay que asociar cada `gameSummary` a sus equipos (abreviatura `MIA`) — verificado que es posible
  con el partido de la semana 10. Antes de publicarse el gamebook el campo falta o está vacío.
- **IDs de partido** estilo PFR: `YYYYMMDD0<código-pfr-del-local>` (`202611150clt`,
  `202611080mia`). Los ficheros `scheduled` ya existen para toda la temporada: el script los
  **localiza por fecha** (`page.date`) en `data/historical/games/<año>/`, no los crea.
- Códigos PFR ≠ abreviaturas ESPN/NFL (`clt`=IND, `rai`=LV, `oti`=TEN, `htx`=HOU, `crd`=ARI,
  `nwe`=NE, `sfo`=SF, `gnb`=GB, `kan`=KC, `nor`=NO, `tam`=TB, `sdg`=LAC, `ram`=LAR, `rav`=BAL…).
  Se necesita una tabla de equivalencias (abreviatura ESPN ↔ código PFR ↔ apodo NFL.com ↔ nombre
  completo); los rivales en `rivals/index.json` se identifican por código PFR (`"id": "crd"`).

## Formato de salida

Debe ser **idéntico en estructura** a lo que genera `phins-stats` para un partido `final`.
Referencia: `data/historical/games/2026/202610250nyj.json` (completo) frente a
`202611150clt.json` (`scheduled`). Schema `mundodolphins.hugo.sectioned-page` 1.0.0.
Las claves están en español y deben reutilizarse **literalmente** (p. ej. `"Carreras-yardas-TD"`,
`"Comp-Int-Yds-TD-INT"`, `"Conv. en tercer down"`, `"Eficacia en zona roja"`); el constructor
debe extraer el vocabulario de claves de las fichas finales existentes de 2025/2026 y mapear a
ellas los campos de ESPN. Una estadística que ESPN no dé se **omite** (no se inventa ni se pone a
cero).

Secciones a rellenar en la pasada 1:

| Sección | Contenido |
|---|---|
| `Anotaciones.linescore` | Puntos por cuarto (+ OT) y `Final` de ambos equipos |
| `Anotaciones.scoring_summary` | Jugadas de anotación: cuarto, tiempo, equipo, descripción (en el idioma que dé ESPN si no hay traducción mecánica fiable), marcadores visitante/local |
| `Equipos.<equipo>.Puntos` / `Record` | Puntos finales y récord tras el partido |
| `Equipos.<equipo>.Estadísticas` | Estadísticas de equipo mapeadas a las claves existentes |
| `Equipos.<equipo>.Estadísticas por jugador` | `Ofensiva` / `Defensiva` / `Equipos especiales` con las columnas que usan las fichas finales |
| `Información del partido` | `Estado: "final"`, estadio, asistencia, clima, hora de inicio (ET), duración si existe |
| `Oficiales` | Si ESPN/NFL.com los da |
| `Gamebook oficial` (dentro de `Información del partido`) | `assets/gamebooks/<año>/<id>.pdf` (pasada 2 o pasada 1 si ya existe) |

`generated_at` se actualiza. Las secciones no cubiertas se dejan como estaban.

**`seasons/<año>.json`:** en `Partidos de la temporada` y `Partidos de la temporada regular`
(o la sección que corresponda a pretemporada/playoffs) el partido pasa a `"status": "final"`
conservando el resto de campos (y añadiendo marcador si las entradas finales existentes lo tienen).
En `Resumen`: `Récord` y `Head Coach (W-L-T)` recalculados, cifras de `Puntos a favor` /
`Puntos en contra` actualizadas. Solo partidos de temporada regular cuentan para el récord.

**`rivals/index.json`:** sumar el partido al rival (summary + `by_season` del año, creando la
entrada si no existe) y a `data.totals`; actualizar `last_game`, `range.to_season`,
`generated_at`. Distinguir `regular_season_games` / `playoff_games` según el tipo. Los partidos de
pretemporada **no** cuentan (comprobar cómo los trata hoy el índice antes de decidir; si los
cuenta, seguir el mismo criterio).

Criterio a replicar: `phins-stats` **regenera** `rivals/index.json` desde cero
(`internal/hugodata/rival_index.go`, `BuildFromDir`), así que lo provisional nunca se cuenta dos
veces tras la pasada manual. El script automático debe imitar exactamente su clasificación
(`gameTypeFromWeek` → `regular_season` / `playoff` / `unknown`; hoy la pretemporada cae en
`unknown_games`) y su identificador de rival (el índice actual usa ids distintos para algunos
rivales en pretemporada, p. ej. `tb` vs `tam`: tomar el id del mismo modo que lo hace
`rival_index.go`, leyéndolo antes de implementar).

## Cómo funciona

### Disparo

Workflow `.github/workflows/update-game-stats.yml`:
- `schedule`: cada 30 min todos los días (cron UTC). Cada ejecución sale en segundos si no hay
  nada que hacer, así que no se restringe a franjas horarias: cubre jueves, sábados de diciembre,
  partidos internacionales matinales y cambios de horario por flex.
- `workflow_dispatch` con input opcional `game_id` (forzar un partido) y `season`.
- `concurrency` por workflow, sin cancelar en curso.

### Lógica por ejecución (idempotente, basada en el estado de `main`)

Para cada partido de Miami de la temporada actual con fecha ≤ ahora:

1. **Pasada 1** si la ficha local tiene `Estado: scheduled` **y** ESPN dice `STATUS_FINAL`:
   generar ficha + temporada + rivales; si el gamebook ya está publicado, incluirlo.
   Rama `auto/game-<id>`, PR "feat: estadísticas automáticas <id>", label `automerge`.
2. **Pasada 2** si la ficha en `main` está `final` **y** no tiene `Gamebook oficial` **y** el
   PDF está publicado: descargar, validar que es un PDF (cabecera `%PDF`, tamaño razonable),
   guardar y enlazar. Rama `auto/gamebook-<id>`, PR "feat: gamebook <id>", label `automerge`.
   Solo se buscan gamebooks de partidos de los últimos 14 días (evita consultar NFL.com por
   partidos antiguos a los que `phins-stats` nunca puso gamebook).
3. Si ya hay una PR abierta para esa rama, se actualiza en lugar de duplicar
   (`create-pull-request` con rama fija lo hace).

Varios partidos atrasados pueden ir en la misma PR (caso del arranque con 1, 8 y 15 nov) — es
decisión del constructor si agrupar o separar; separar facilita revertir.

### Validación de PRs

Nuevo workflow `.github/workflows/pr-checks.yml` en `pull_request` a `main`:
- Instalar Hugo 0.158.0 extended (mismo método/cache que `hugo.yaml`), `hugo mod tidy`,
  `hugo --gc --buildFuture --panicOnWarning` (si `panicOnWarning` rompe el build actual, quitarlo).
- `make validate-contracts SKIP_HUGO_BUILD=1` tras el build.
- Validación de datos: todos los JSON de `data/` parsean; las fichas de partido modificadas
  tienen `schema.name/version` esperados y las secciones obligatorias; todo
  `Gamebook oficial` apunta a un fichero existente; `rivals/index.json` cuadra (suma de rivales =
  totales).
- Tests del script (pytest con fixtures de respuestas ESPN/NFL.com guardadas; sin red).

Alcance de la validación: el build de Hugo y `validate-contracts` sobre todo el sitio; las
comprobaciones de estructura de datos solo sobre los ficheros modificados en la PR (más la
coherencia de `rivals/index.json` si se toca). `--panicOnWarning` solo si `main` actual compila
limpio con él; arreglar contenido existente no es parte de este trabajo.

Guarda anti-pisado (solo en PRs de ramas `auto/*`): el check compara contra el `main` actual y
falla si alguna ficha que la PR pasa a `final` ya está `final` en `main` (o si la pasada 2 añade
gamebook a una ficha que ya lo tiene). Así, si Javi publica la salida de `phins-stats` mientras
una PR automática espera, esta no se fusiona y no pisa los datos completos. El workflow del cron,
al ver que la ficha ya no está `scheduled`, cierra la PR obsoleta.

**Auto-merge:** la ruleset "Main" exige el check `validate` (ver Restricciones), así que GitHub
no deja fusionar nada que no haya pasado la validación; el CMS sigue publicando por bypass. El
merge lo dispara el propio resultado de la validación: `automerge.yml` pasa a ejecutarse en `workflow_run` de
`pr-checks` (`completed`), y solo si `conclusion == success` y la PR tiene label `automerge`
hace `gh pr merge --squash --delete-branch` (sin `--auto`) con el token `PUSH`. Se elimina el
`sleep 30` y la consulta a la API de *statuses*. Las PRs de vídeos/posts existentes pasan también
por la validación antes de fusionarse, que es lo deseado.

## Fallos

- ESPN/NFL.com caídos o cambio de formato: el job falla, sin PR. GitHub notifica por email el
  fallo de un workflow programado; la siguiente ejecución reintenta sola.
- Gamebook nunca publicado: se deja de buscar a los 14 días, sin error.
- Datos parciales de ESPN: se rellena lo que haya; no bloquea.

## Decisiones tomadas por Javi

- GitHub Actions (no Cloudflare Worker).
- Fuentes: NFL.com y API no oficial de ESPN; aceptar que no estén todas las estadísticas.
- `phins-stats` seguirá lanzándose manualmente después y sobrescribirá.
- Actualizar también temporada y rivales con lo disponible.
- Comprobar que el gamebook está publicado además de `STATUS_FINAL`; dos pasadas (estadísticas
  primero, gamebook después).
- PR con merge automático tras pasar validaciones; añadir validaciones en PRs para no romper la web.
- URL NFL.com: `{visitante}-at-{local}-{año}-reg-{semana}`; el PDF sale del enlace
  "Download Game Book (PDF)".

## Decisiones del diseñador (revisables)

- Python 3.11 en `.github/scripts/`, como `update_videos.py`.
- Cron cada 30 min todo el día en vez de franjas horarias.
- Si el gamebook ya está al hacer la pasada 1, va en la misma PR.
- Ventana de 14 días para buscar gamebooks.
- No se toca `season_stats`, rankings de liga ni posición en división.
- Descripciones de anotaciones: se intenta el formato español existente
  ("X pase de N yardas de Y (Z kick)") con plantillas para los tipos comunes; si no se reconoce
  el patrón, se deja el texto original de ESPN.
- El merge lo dispara el éxito de `pr-checks` (`workflow_run`); la ruleset "Main" exige `validate`.
- Guarda anti-pisado en `pr-checks` para PRs `auto/*` y cierre de PRs obsoletas.
- Validación de datos solo sobre ficheros modificados; no se arregla contenido existente.
- Se soportan pretemporada (`pre`) y playoffs (`post`) además de temporada regular, verificando el
  patrón de URL de NFL.com para ellos en la construcción.

## Queda a criterio del constructor

- Estructura interna del script, tests y fixtures.
- Mapeo exacto ESPN → claves en español (a partir de las fichas existentes).
- Agrupar o no varios partidos atrasados en una PR.
- Cómo extraer el `gameSummary` de Miami del HTML de NFL.com de forma robusta.
