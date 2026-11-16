# Actualización automática de partidos – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un workflow programado que, al terminar un partido de Miami, rellena su ficha con datos de ESPN, actualiza temporada y rivales, descarga el gamebook de NFL.com cuando esté publicado, y lo fusiona vía PR solo si pasa una nueva validación de PRs.

**Architecture:** Paquete Python `.github/scripts/game_stats/` con módulos puros (mapeo ESPN → JSON existente) probados con fixtures reales guardadas, más un CLI `update_game_stats.py --mode stats|gamebook` que lee/escribe el checkout. Workflow `update-game-stats.yml` (cron 30 min) ejecuta ambos modos y crea dos PRs de rama fija con `peter-evans/create-pull-request`. `pr-checks.yml` compila Hugo, valida contratos y datos; `automerge.yml` pasa a dispararse por `workflow_run` de `pr-checks`.

**Tech Stack:** Python 3.11 (`requests`, `pytest`, stdlib `zoneinfo`), GitHub Actions, Hugo 0.158.0 extended, Go (validate-contracts existente).

**Spec:** `docs/superpowers/specs/2026-11-16-auto-game-stats-design.md`

## Global Constraints

- Solo se actúa sobre fichas con `"Estado": "scheduled"` (pasada stats) o `final` sin `"Gamebook oficial"` (pasada gamebook), y nunca sobre partidos con `page.date` > hoy.
- Claves de salida en español, **literalmente** las de `data/historical/games/2026/202610250nyj.json`. Estadística de equipo que ESPN no da → se omite la clave. En filas de jugadores, columna sin dato → `""`.
- JSON escritos con `json.dump(..., ensure_ascii=False, indent=2)` + `\n` final (comprobar el formato de los ficheros existentes con `head -c 300` y replicarlo exactamente para que el diff sea mínimo).
- `generated_at` estable: la hora de inicio ESPN del partido (`header.competitions[0].date`, formato `YYYY-MM-DDTHH:MM:SSZ`), para que re-ejecuciones del cron no generen diffs.
- Gamebook en `assets/gamebooks/<año>/<game_id>.pdf`; enlace `"Gamebook oficial": "assets/gamebooks/<año>/<game_id>.pdf"` dentro de `Información del partido`.
- Gamebooks solo se buscan para partidos con fecha ≥ hoy − 14 días.
- PRs: ramas fijas `auto/game-stats` y `auto/gamebook`, label `automerge`, token `secrets.PUSH`.
- Rivals: replicar `phins-stats/internal/hugodata/rival_index.go` (`gameTypeFromWeek`: semana numérica → `regular_season`, contiene playoff/wild card/division/conference/super bowl/championship → `playoffs`, otro → `unknown`; `latest_games` máx. 5, más reciente primero). Un partido ya presente en `latest_games` de algún rival no se vuelve a sumar.
- No proteger `main`; no tocar `season_stats/`.

## Review Focus

- Partido con prórroga (OT): `linescore` debe incluir columna `"OT"` y `Final` correcto; empate (resultado `T`) en rivales y récord `W-L-T`.
- Partido de Miami como local vs visitante: `Marcador visitante/local`, `home_away`, y URL NFL.com `{visitante}-at-{local}` invertidos correctamente.
- Página NFL.com con `gameBookUrl` vacío o ausente para Miami pero presente para otros partidos de la jornada: no debe devolver el PDF de otro partido.
- Descarga del PDF que devuelve HTML (error/redirect) o 0 bytes: no se guarda ni se enlaza.
- Re-ejecución tras merge (ficha ya `final`, rival ya en `latest_games`): cero cambios en disco.

---

### Task 0: Rama y fixtures

**Files:**
- Create: `.github/scripts/game_stats/__init__.py` (vacío), `.github/scripts/game_stats/tests/__init__.py` (vacío)
- Create: `.github/scripts/game_stats/tests/fixtures/espn_schedule_2026.json`, `espn_summary_401873059.json` (MIA @ IND, sem. 10), `espn_summary_401873015.json` (MIA @ NYJ, sem. 7, ficha completa existente para comparar), `espn_summary_401873042.json` (DET @ MIA, local), `nfl_week10.html.gz`
- Create: `.github/scripts/requirements.txt` (`requests`, `pytest`)

- [ ] **Step 1:** `git checkout -b feat/auto-game-stats` y commitear el spec y este plan.
- [ ] **Step 2:** Descargar fixtures:

```bash
F=.github/scripts/game_stats/tests/fixtures; mkdir -p $F
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/mia/schedule?season=2026" > $F/espn_schedule_2026.json
for e in 401873059 401873015 401873042; do curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=$e" > $F/espn_summary_$e.json; done
curl -sL -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36" "https://www.nfl.com/games/dolphins-at-colts-2026-reg-10?tab=recap" | gzip > $F/nfl_week10.html.gz
```

Expected: todos no vacíos; `zcat $F/nfl_week10.html.gz | grep -c gameBookUrl` ≥ 1.
- [ ] **Step 3:** Commit `chore: fixtures para game_stats`.

---

### Task 1: Tabla de equipos

**Files:**
- Create: `.github/scripts/game_stats/teams.py`
- Test: `.github/scripts/game_stats/tests/test_teams.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) Team(espn: str, pfr: str, nfl_slug: str, name: str, nfl_abbr: str)`; `by_espn(abbr: str) -> Team` (KeyError si desconocido); `MIAMI: Team`; `ALL: tuple[Team, ...]`.

`nfl_abbr` = abreviatura que usa NFL.com en su payload; igual a la de ESPN salvo `WSH` → `WAS` (verificado en el HTML de la semana 10; revisar el resto contra el fixture).

Tabla completa de los 32 equipos. Códigos PFR (los que usa `rivals/index.json` en temporada regular y los sufijos de `game_id`): ARI→crd, ATL→atl, BAL→rav, BUF→buf, CAR→car, CHI→chi, CIN→cin, CLE→cle, DAL→dal, DEN→den, DET→det, GB→gnb, HOU→htx, IND→clt, JAX→jax, KC→kan, LV→rai, LAC→sdg, LAR→ram, MIA→mia, MIN→min, NE→nwe, NO→nor, NYG→nyg, NYJ→nyj, PHI→phi, PIT→pit, SF→sfo, SEA→sea, TB→tam, TEN→oti, WSH→was. `nfl_slug` = apodo en minúsculas con guiones (`49ers`, `commanders`, `dolphins`). `name` = nombre completo como en las fichas (`"Indianapolis Colts"`).

- [ ] **Step 1: Test**

```python
def test_lookup():
    assert by_espn("IND") == Team("IND", "clt", "colts", "Indianapolis Colts", "IND")
    assert by_espn("WSH").pfr == "was" and by_espn("WSH").nfl_abbr == "WAS"
    assert by_espn("SF").nfl_slug == "49ers"
    assert MIAMI.pfr == "mia"
    assert len({t.pfr for t in ALL}) == 32
```

- [ ] **Step 2:** `cd .github/scripts && python -m pytest game_stats/tests/test_teams.py -v` → FAIL (import).
- [ ] **Step 3:** Implementar `teams.py` (`ALL: tuple[Team, ...]`).
- [ ] **Step 4:** Mismo comando → PASS.
- [ ] **Step 5:** Commit `feat(game_stats): tabla de equipos`.

---

### Task 2: Cliente ESPN y modelo de partido

**Files:**
- Create: `.github/scripts/game_stats/espn.py`
- Test: `.github/scripts/game_stats/tests/test_espn.py`

**Interfaces:**
- Consumes: `teams.by_espn`
- Produces:
  - `@dataclass ScheduledGame(event_id: str, kickoff_utc: datetime, week: int, season_type: int, final: bool, home: Team, away: Team)` con propiedad `game_id -> str` = `f"{kickoff_et:%Y%m%d}0{home.pfr}"` (fecha en America/New_York).
  - `parse_schedule(data: dict) -> list[ScheduledGame]`
  - `fetch_schedule(season: int, session) -> list[ScheduledGame]` (pide `seasontype=1,2,3` y concatena).
  - `fetch_summary(event_id: str, session) -> dict`

- [ ] **Step 1: Tests** (con fixture de calendario)

```python
def test_schedule_week10():
    g = next(g for g in parse_schedule(load("espn_schedule_2026.json")) if g.week == 10)
    assert g.final and g.away.pfr == "mia" and g.home.pfr == "clt"
    assert g.game_id == "202611150clt"
def test_home_game_id():
    g = next(g for g in parse_schedule(load("espn_schedule_2026.json")) if g.week == 9)
    assert g.game_id == "202611080mia"
def test_scheduled_not_final():
    g = next(g for g in parse_schedule(load("espn_schedule_2026.json")) if g.week == 11)
    assert not g.final
```

`load(name)` = helper en `tests/conftest.py` que lee de `fixtures/`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementar. `final` = `competitions[0].status.type.name == "STATUS_FINAL"`. `season_type` de `event["seasonType"]["type"]` (1 pre, 2 reg, 3 post).
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(game_stats): calendario ESPN`.

---

### Task 3: Construcción de la ficha del partido

**Files:**
- Create: `.github/scripts/game_stats/game_page.py`
- Test: `.github/scripts/game_stats/tests/test_game_page.py`

**Interfaces:**
- Consumes: `ScheduledGame`, `teams`
- Produces: `fill_game_page(page: dict, summary: dict, game: ScheduledGame) -> dict` — recibe la ficha `scheduled` existente (dict), devuelve copia con secciones rellenas, `Estado: "final"`, `generated_at` = kickoff ESPN; conserva `Coach`, `Semana`, `Tipo de partido`, `Fecha`, `Estadio`, `Conteo de snaps`, `Estadísticas avanzadas`, `Series ofensivas`, `Videos del partido`, `page`, `schema`. `translate_scoring(text: str) -> str`.

Mapeo de estadísticas de equipo (ESPN `boxscore.teams[i].statistics[name]` → clave; omitir si falta el `name`):

| ESPN | Clave(s) | Valor |
|---|---|---|
| `firstDowns` | `Primeros downs`, `Primeros downs totales` | tal cual |
| `firstDownsPassing` / `firstDownsRushing` / `firstDownsPenalty` | `Por pase` / `Por carrera` / `Por penalización` | tal cual |
| `thirdDownEff` `"5-12"` | `Conv. en tercer down`; `Eficacia en tercer down` | `"5-12"`; `"5-12-41.7%"` (1 decimal; `0-0` → `"0-0-0%"`) |
| `fourthDownEff` | `Conv. en cuarto down`; `Eficacia en cuarto down` | ídem |
| `redZoneAttempts` `"1-2"` | `Eficacia en zona roja` | `"1-2-50%"` (entero) |
| `totalOffensivePlays` | `Jugadas ofensivas totales (incluye sacks)` | |
| `totalYards` | `Yardas totales`, `Yardas netas totales` | |
| `yardsPerPlay` | `Promedio por jugada ofensiva` | |
| `netPassingYards` | `Yardas netas de pase`, `Yardas netas por pase` | |
| `completionAttempts` `"18/33"` + `interceptions` | `Pases intentados-completados-interceptados` | `"33-18-0"` |
| `yardsPerPass` | `Promedio por jugada de pase (incluye sacks)` | |
| `sacksYardsLost` `"3-28"` | `Sacks-yardas perdidas`, `Sacks recibidos-yardas perdidas al pasar` | |
| `rushingYards` / `rushingAttempts` / `yardsPerRushAttempt` | `Yardas netas de carrera` / `Jugadas de carrera totales` / `Promedio por carrera` | |
| `totalPenaltiesYards` | `Penalizaciones-yardas`, `Penalizaciones: número y yardas` | |
| `turnovers` | `Pérdidas de balón` | |
| `possessionTime` | `Tiempo de posesión` | |

Derivadas de jugadores: `Carreras-yardas-TD` = suma rushing CAR-YDS-TD; `Comp-Int-Yds-TD-INT` = `"{comp}-{att}-{yds}-{td}-{int}"` (orden real del ejemplo `14-21-208-2-0`) sumando passing; `Yardas brutas de pase` = suma YDS passing; `Touchdowns` = nº de `scoringPlays` del equipo con `type.abbreviation == "TD"`; `Goles de campo anotados-intentados` / `Puntos extra anotados-intentados` = suma kicking `FG`/`XP` (`"1/3"` → `"1-3"`); `Despejes: número y promedio` = punting `NO-AVG`; `Resultado final` = puntos.

Jugadores — fila por (jugador, grupo), fusionando por `athlete.id` dentro de cada grupo; `Equipo` = abreviatura ESPN del equipo (como `"MIA"` en el ejemplo). Columnas exactas (todas presentes, `""` si no hay dato):
- `Ofensiva` (passing ∪ rushing ∪ receiving ∪ fumbles): `Nombre, Equipo, Comp, Intentos, Yds pase, TD pase, INT, Largo pase(""), Capturas recibidas, Yds perdidas capturas, Rating(RTG), Carreras, Yds carrera, TD carrera, Largo carrera, Rec, Objetivos(TGTS), Yds recepción, TD recepción, Largo recepción, Fumbles(FUM), Fumbles perdidos(LOST)`. Un jugador sin dato en un subgrupo pone `"0"` en sus columnas numéricas (como en el ejemplo: QB con `Rec: "0"`).
- `Defensiva` (defensive ∪ interceptions ∪ fumbles.REC): `Nombre, Equipo, Tackles(TOT), Solo, Asist(TOT−SOLO), Capturas(SACKS), TFL, Golpes QB(QB HTS), Pases defendidos(PD), INT, Yds INT, TD INT, INT largo(""), FF(""), FR(REC), Yds FR(""), TD FR("")`.
- `Equipos especiales` (kicking ∪ punting): `Nombre, Equipo, FGm, FGa, FG largo(LONG), XPm, XPa, Punts(NO), Yds punt, Prom punt(AVG), Largo punt(LONG)`.

Otras secciones:
- `linescore`: fila por equipo `{"Equipo": name, "1".."4", ["OT"], "Final"}` desde `header.competitions[0].competitors[].linescores`; visitante primero.
- `scoring_summary`: `{"Cuarto", "Tiempo", "Equipo"(name), "Descripción": translate_scoring(text), "Marcador visitante", "Marcador local"}`; cuarto 5 → `"OT"`.
- `Equipos.<name>.Puntos` (int), `Record` (= `record[type=total].summary`).
- `Información del partido`: `Estado: "final"`, `Asistencia` (`f"{n:,}"`), `Hora de inicio` (kickoff en America/New_York, `"1:00 PM EST"`, sin cero inicial), `Superficie de juego` (`grass` True→`"Césped natural"`, False→`"Césped artificial"`), `Clima` solo si `gameInfo.weather` existe (`"{temperature} grados"`).
- `Oficiales`: `[{"Nombre": fullName, "Posición": position.displayName}]` en el orden de `order`.

`translate_scoring` (regex, sin coincidencia → texto original, `strip()`):
- `"X N Yd pass from Y (EXTRA)"` → `"X pase de N yardas de Y (EXTRA')"`
- `"X N Yd Rush (EXTRA)"` → `"X carrera de N yarda(s) (EXTRA')"` (`1` → `"1 yarda"`)
- `"X N Yd Field Goal"` → `"X field goal de N yardas"`
- `"X N Yd Interception Return (EXTRA)"` → `"X N yardas retorno de interception (EXTRA')"`; `Kickoff Return` → `retorno de kickoff`; `Punt Return` → `punt return`
- EXTRA': `"K Kick"` → `"K kick"`; `"K PAT Failed"` → `"K kick failed"`; `"Two-Point Pass Conversion Failed"` / `"Two-Point Run Conversion Failed"` → `"conversión fallida"`; resto igual.

- [ ] **Step 1: Tests**

```python
def scheduled(): return json.loads((DATA / "2026/202611150clt.json").read_text())
def test_week10_basic():
    out = fill_game_page(scheduled(), load("espn_summary_401873059.json"), WEEK10)
    s = out["sections"]
    assert s["Información del partido"]["Estado"] == "final"
    assert s["Información del partido"]["Asistencia"] == "64,235"
    assert s["Información del partido"]["Superficie de juego"] == "Césped artificial"
    assert s["Anotaciones"]["linescore"][0] == {"Equipo": "Miami Dolphins", "1": "0", "2": "7", "3": "9", "4": "6", "Final": "22"}
    assert s["Equipos"]["Miami Dolphins"]["Record"] == "1-8"
    assert s["Equipos"]["Indianapolis Colts"]["Coach"] == "Shane Steichen"
    assert s["Series ofensivas"] == {}
    assert "Gamebook oficial" not in s["Información del partido"]
def test_team_stats_match_existing_nyj():
    existing = json.loads((DATA / "2026/202610250nyj.json").read_text())["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas"]
    out = fill_game_page(scheduled_copy_of_nyj(), load("espn_summary_401873015.json"), WEEK7)
    got = out["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas"]
    for k in ["Carreras-yardas-TD", "Comp-Int-Yds-TD-INT", "Conv. en tercer down", "Eficacia en tercer down",
              "Conv. en cuarto down", "Primeros downs", "Tiempo de posesión", "Resultado final", "Yardas netas de carrera"]:
        assert got[k] == existing[k], k
    assert set(got) <= set(existing)
def test_player_columns_match_existing():
    existing = json.loads((DATA / "2026/202610250nyj.json").read_text())["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas por jugador"]
    out = fill_game_page(scheduled_copy_of_nyj(), load("espn_summary_401873015.json"), WEEK7)
    got = out["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas por jugador"]
    for grp in ("Ofensiva", "Defensiva", "Equipos especiales"):
        assert set(got[grp][0]) == set(existing[grp][0]), grp
def test_home_game_scores():  # DET @ MIA
    out = fill_game_page(json.loads((DATA / "2026/202611080mia.json").read_text()), load("espn_summary_401873042.json"), WEEK9)
    last = out["sections"]["Anotaciones"]["scoring_summary"][-1]
    lines = out["sections"]["Anotaciones"]["linescore"]
    assert lines[0]["Equipo"] == "Detroit Lions"
    assert last["Marcador visitante"] == lines[0]["Final"] and last["Marcador local"] == lines[1]["Final"]
def test_overtime_linescore():
    summary = load("espn_summary_401873059.json")
    for c in summary["header"]["competitions"][0]["competitors"]:
        c["linescores"].append({"displayValue": "3" if c["homeAway"] == "home" else "0"})
    lines = fill_game_page(scheduled(), summary, WEEK10)["sections"]["Anotaciones"]["linescore"]
    assert lines[1]["OT"] == "3" and lines[1]["Final"] == str(sum(int(lines[1][q]) for q in ("1","2","3","4","OT")))
@pytest.mark.parametrize("src,dst", [
    ("Seth McGowan 4 Yd Rush (Spencer Shrader Kick)", "Seth McGowan carrera de 4 yardas (Spencer Shrader kick)"),
    ("Laquon Treadwell 7 Yd pass from Daniel Jones (Spencer Shrader Kick)", "Laquon Treadwell pase de 7 yardas de Daniel Jones (Spencer Shrader kick)"),
    ("Zane Gonzalez 53 Yd Field Goal ", "Zane Gonzalez field goal de 53 yardas"),
    ("Kyle McCord 1 Yd Rush (Two-Point Pass Conversion Failed)", "Kyle McCord carrera de 1 yarda (conversión fallida)"),
    ("Chris Johnson 59 Yd Interception Return (Zane Gonzalez PAT Failed)", "Chris Johnson 59 yardas retorno de interception (Zane Gonzalez kick failed)"),
    ("Adetomiwa Adebawore Fumble Recovery in End Zone (Spencer Shrader Kick)", "Adetomiwa Adebawore Fumble Recovery in End Zone (Spencer Shrader Kick)"),
])
def test_translate_scoring(src, dst): assert translate_scoring(src) == dst
```

`DATA` = `Path(__file__).parents[4] / "data/historical/games"`. `scheduled_copy_of_nyj()` = la ficha nyj con secciones vaciadas como una `scheduled` (copiar estructura de `202611150clt.json`). `WEEK7/9/10` = `ScheduledGame` sacados del fixture de calendario. Si alguna clave de `test_team_stats_match_existing_nyj` difiere por diferencias reales ESPN vs PFR, quitarla de la lista y anotarlo en el commit (no forzar el mapeo).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementar `game_page.py` (deepcopy de entrada; funciones privadas por sección).
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(game_stats): ficha de partido desde ESPN`.

---

### Task 4: Temporada y rivales

**Files:**
- Create: `.github/scripts/game_stats/season.py`, `.github/scripts/game_stats/rivals.py`
- Test: `.github/scripts/game_stats/tests/test_season.py`, `test_rivals.py`

**Interfaces:**
- Consumes: `ScheduledGame`, `teams.MIAMI`
- Produces:
  - `@dataclass GameResult(game_id: str, date: str, week: str, game_type: str, home: bool, opponent: Team, points_for: int, points_against: int, path: str)`; `result_from(page: dict, game: ScheduledGame) -> GameResult` (de la ficha ya rellenada; `week`/`game_type` de `Información del partido` y `gameTypeFromWeek`; `path` = `page.page.path`).
  - `update_season(season: dict, result: GameResult) -> dict`: en todas las listas de `sections` cuyo item tenga `game_id == result.game_id`, `status = "final"`. Recalcula `Resumen.Récord` y el `(W-L-T)` de `Head Coach` contando las entradas `final` de `Partidos de la temporada regular` con los puntos de sus fichas (pasar un `scores: dict[game_id, (pf, pa)]` como argumento extra: `update_season(season, result, scores)`). `Puntos a favor`/`Puntos en contra`: sustituye solo el número inicial (`re.sub(r"^\d+", ...)`), conservando el resto del texto. Solo si `game_type == "regular_season"` cambian récord y puntos.
  - `update_rivals(index: dict, result: GameResult, stamp: str) -> dict`: no-op si `game_id` ya está en algún `latest_games`. Si no: suma a `summary`, al `by_season` del año (crear con ceros si no existe, mantener orden ascendente), a `data.totals`; inserta en `latest_games` al principio y recorta a 5; `last_game = max(...)`; `range.to_season = max(...)`; rival nuevo → crear entrada (`opponents` += 1, `first_game` = fecha) y mantener `rivals` ordenado por `opponent.name`; `generated_at = stamp`. `point_differential` recalculado. `unknown_games` solo se suma si la clave existe o el tipo es `unknown`.

- [ ] **Step 1: Tests**

```python
def test_rivals_adds_week10():
    idx = load_repo("data/historical/rivals/index.json")
    before = deepcopy(idx); r = result(game_id="202611150clt", opp="IND", pf=22, pa=24, week="10")
    out = update_rivals(idx, r, "2026-11-15T18:00:00Z")
    clt = rival(out, "clt"); t, t0 = out["data"]["totals"], before["data"]["totals"]
    assert clt["summary"]["games"] == rival(before, "clt")["summary"]["games"] + 1
    assert clt["summary"]["last_game"] == "2026-11-15"
    assert clt["latest_games"][0]["game_id"] == "202611150clt" and len(clt["latest_games"]) <= 5
    assert clt["latest_games"][0]["result"] == "L" and clt["latest_games"][0]["home_away"] == "away"
    assert (t["games"], t["losses"], t["regular_season_games"]) == (t0["games"] + 1, t0["losses"] + 1, t0["regular_season_games"] + 1)
def test_rivals_idempotent():
    idx = load_repo("data/historical/rivals/index.json"); r = result(game_id="202610250nyj", opp="NYJ", pf=28, pa=25, week="7")
    assert update_rivals(deepcopy(idx), r, "x") == idx
def test_rivals_tie_and_totals_consistent():
    out = update_rivals(load_repo(...), result(game_id="202611150clt", opp="IND", pf=20, pa=20, week="10"), "s")
    assert rival(out, "clt")["latest_games"][0]["result"] == "T"
    assert out["data"]["totals"]["games"] == sum(r["summary"]["games"] for r in out["data"]["rivals"])
def test_game_type_from_week():
    assert [game_type_from_week(w) for w in ("10", "Wild Card", "Preseason 1", "")] == ["regular_season", "playoffs", "unknown", "unknown"]
def test_season_marks_final_and_record():
    season = load_repo("data/historical/seasons/2026.json")
    out = update_season(season, result(game_id="202611010mia", opp="NE", pf=10, pa=20, week="8"), SCORES_THROUGH_WEEK8)
    items = [i for i in out["sections"]["Partidos de la temporada regular"] if i["game_id"] == "202611010mia"]
    assert items[0]["status"] == "final"
    assert out["sections"]["Resumen"]["Récord"] == EXPECTED_RECORD
    assert out["sections"]["Resumen"]["Puntos a favor"].endswith(" puntos. 30º de 32 equipos")
```

`SCORES_THROUGH_WEEK8`/`EXPECTED_RECORD`: construir desde las fichas `final` de 2026 del repo + el partido de prueba, y calcular el récord esperado a mano en el test (W-L-T con guiones, p. ej. `"1-6-0"`).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementar ambos módulos.
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(game_stats): temporada y rivales`.

---

### Task 5: Gamebook de NFL.com

**Files:**
- Create: `.github/scripts/game_stats/nflcom.py`
- Test: `.github/scripts/game_stats/tests/test_nflcom.py`

**Interfaces:**
- Consumes: `ScheduledGame`, `Team`
- Produces: `game_url(game: ScheduledGame) -> str`; `find_gamebook_url(html: str, home: Team, away: Team) -> str | None`; `download_gamebook(url: str, dest: Path, session) -> bool`.

`game_url`: `https://www.nfl.com/games/{away.nfl_slug}-at-{home.nfl_slug}-{season}-{reg|pre|post}-{week}` (`season_type` 1/2/3). `find_gamebook_url`: desescapar `\"` → `"`; para cada `"gameSummary":{…"gameBookUrl":"…"}` buscar en la ventana anterior (≤3000 caracteres, igual que el spike) las dos últimas `"abbreviation":"XXX"` y aceptar solo si el conjunto == `{home.nfl_abbr, away.nfl_abbr}`. URL vacía → `None`. `download_gamebook`: GET con User-Agent de navegador, aceptar solo si `status 200`, contenido empieza por `b"%PDF"` y > 10 KB; escribir y devolver `True`, si no `False` sin crear fichero.

- [ ] **Step 1: Tests**

```python
HTML = gzip.decompress((FIX / "nfl_week10.html.gz").read_bytes()).decode()
def test_url(): assert game_url(WEEK10) == "https://www.nfl.com/games/dolphins-at-colts-2026-reg-10"
def test_url_home(): assert game_url(WEEK9) == "https://www.nfl.com/games/lions-at-dolphins-2026-reg-9"
def test_finds_miami_pdf():
    assert find_gamebook_url(HTML, by_espn("IND"), MIAMI).endswith("/gamecenter/ab789365-4feb-11f1-abca-2c54536568a9.pdf")
def test_no_other_games_pdf():
    blanked = re.sub(r'(ab789365[^"\\]*\.pdf)', "", HTML)
    assert find_gamebook_url(blanked, by_espn("IND"), MIAMI) is None
def test_rejects_html_download(tmp_path):
    s = FakeSession(200, b"<html>nope</html>")
    assert download_gamebook("u", tmp_path / "x.pdf", s) is False and not (tmp_path / "x.pdf").exists()
def test_accepts_pdf(tmp_path):
    assert download_gamebook("u", tmp_path / "x.pdf", FakeSession(200, b"%PDF-1.7" + b"0" * 20000))
```

(Si el MIA de la semana 10 resulta ser otro UUID al verificar con el fixture, actualizar la aserción con el que corresponda a MIA/IND.)
- [ ] **Step 2:** pytest → FAIL. **Step 3:** implementar. **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(game_stats): gamebook de NFL.com`.

---

### Task 6: CLI orquestador

**Files:**
- Create: `.github/scripts/update_game_stats.py`
- Test: `.github/scripts/game_stats/tests/test_cli.py`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `run(mode: Literal["stats","gamebook"], root: Path, season: int, today: date, session, game_id: str | None = None) -> list[str]` (game_ids modificados). `main()` con argparse `--mode`, `--root` (por defecto la raíz del repo, `Path(__file__).parents[2]`), `--season` (por defecto año actual; si mes ≤ 2 → año − 1), `--game-id`; escribe `changed=<ids separados por coma>` en `$GITHUB_OUTPUT` si existe.

Lógica:
- `stats`: para cada `ScheduledGame` `final` de MIA con fecha ≤ today (o solo `game_id` si se pasa): localizar `data/historical/games/<season>/<game_id>.json`; si no existe → aviso y continuar; si `Estado != "scheduled"` → saltar. Si no: `fill_game_page`; intentar gamebook (si `game_url` → `find_gamebook_url` → `download_gamebook` OK, añadir `Gamebook oficial`); escribir ficha; `update_season` (scores de todas las fichas `final` de la temporada en disco, ya incluida la recién escrita) y `update_rivals`. Errores de red de un partido → log + continuar con el siguiente; si todos fallan, salir con código 1.
- `gamebook`: fichas de la temporada con `Estado == "final"`, sin `Gamebook oficial`, fecha ≥ today − 14 días y fecha ≤ today → intentar descarga y añadir enlace (solo ese campo cambia).
- Escritura JSON según Global Constraints.

- [ ] **Step 1: Tests** (sesión falsa que sirve fixtures por URL; `root` = copia en `tmp_path` de `data/historical/{games/2026,seasons/2026.json,rivals/index.json}`)

```python
def test_stats_fills_pending(repo_copy):
    changed = run("stats", repo_copy, 2026, date(2026, 11, 16), fake_session())
    assert "202611150clt" in changed and "202611220buf" not in changed
    assert read(repo_copy, "games/2026/202611150clt.json")["sections"]["Información del partido"]["Estado"] == "final"
def test_stats_idempotent(repo_copy):
    run("stats", repo_copy, 2026, date(2026, 11, 16), fake_session()); snap = snapshot(repo_copy)
    assert run("stats", repo_copy, 2026, date(2026, 11, 16), fake_session()) == [] and snapshot(repo_copy) == snap
def test_does_not_touch_final(repo_copy):
    before = read(repo_copy, "games/2026/202610250nyj.json")
    run("stats", repo_copy, 2026, date(2026, 11, 16), fake_session(), game_id="202610250nyj")
    assert read(repo_copy, "games/2026/202610250nyj.json") == before
def test_gamebook_mode_only_adds_link(repo_copy):
    run("stats", repo_copy, 2026, date(2026, 11, 16), fake_session(pdf=False))
    before = read(repo_copy, "games/2026/202611150clt.json")
    assert run("gamebook", repo_copy, 2026, date(2026, 11, 16), fake_session(pdf=True)) == ["202611150clt"]
    after = read(repo_copy, "games/2026/202611150clt.json")
    after["sections"]["Información del partido"].pop("Gamebook oficial")
    assert after == before and (repo_copy / "assets/gamebooks/2026/202611150clt.pdf").exists()
def test_gamebook_window(repo_copy):
    assert "202611150clt" not in run("gamebook", repo_copy, 2026, date(2026, 12, 15), fake_session(pdf=True))
```

`fake_session(pdf)` sirve el fixture de calendario para la URL de schedule, los summaries para los eventos con fixture (para 401873034 reutilizar el de 401873042 con equipos cambiados, o limitar las aserciones a los partidos con fixture y hacer que el resto devuelva error de red → se comprueba también el “continuar con el siguiente”), el HTML para nfl.com y PDF/HTML para static.www.nfl.com.
- [ ] **Step 2:** pytest → FAIL. **Step 3:** implementar. **Step 4:** pytest (toda la suite) → PASS.
- [ ] **Step 5:** Ejecución real en seco: `cd .github/scripts && python update_game_stats.py --mode stats --season 2026` desde la raíz con `--root` apuntando al repo; revisar `git diff --stat` (deberían cambiar 202611010mia, 202611080mia, 202611150clt, seasons/2026.json, rivals/index.json y, si hay gamebook, 3 PDFs). `hugo --gc --buildFuture` → sin errores; abrir `hugo server` y comprobar visualmente `/historia/partidos/mia-clt-20261115/`. **No** commitear estos cambios de datos (los traerá la primera PR automática): `git checkout -- data assets`.
- [ ] **Step 6:** Commit `feat: CLI update_game_stats`.

---

### Task 7: Validación de datos para PRs

**Files:**
- Create: `.github/scripts/validate_data.py`
- Test: `.github/scripts/game_stats/tests/test_validate_data.py`

**Interfaces:**
- Produces: `validate(root: Path, changed: list[str], base_ref_reader: Callable[[str], str | None], branch: str) -> list[str]` (errores); CLI `--base <ref>` que obtiene `changed` con `git diff --name-only <base>...HEAD` y `base_ref_reader` con `git show <base>:<path>`; exit 1 si hay errores.

Reglas: (1) todo `.json` cambiado bajo `data/` parsea; (2) fichas `data/historical/games/**` cambiadas: `schema == {"name": "mundodolphins.hugo.sectioned-page", "version": "1.0.0"}`, `page.kind == "game"`, `sections` contiene `Anotaciones, Equipos, Información del partido`; (3) todo `Gamebook oficial` en fichas cambiadas existe como fichero y empieza por `%PDF`; (4) si cambia `rivals/index.json`: `totals.games == Σ summary.games` y lo mismo para wins/losses/ties/points_for/points_against; (5) solo si `branch` empieza por `auto/`: para cada ficha cambiada, en base `Estado` debe ser `scheduled` (rama `auto/game-stats`) o la base no debe tener `Gamebook oficial` (rama `auto/gamebook`).

- [ ] **Step 1: Tests** — un test por regla con un repo mínimo en `tmp_path` (un caso válido y uno inválido cada una), incluyendo:

```python
def test_guard_blocks_overwriting_final(tmp_repo):
    errs = validate(tmp_repo, ["data/historical/games/2026/g.json"], lambda p: FINAL_JSON, "auto/game-stats")
    assert any("ya está final" in e for e in errs)
def test_guard_ignored_for_human_branches(tmp_repo):
    assert validate(tmp_repo, ["data/historical/games/2026/g.json"], lambda p: FINAL_JSON, "feat/x") == []
def test_current_rivals_index_is_consistent():
    assert validate(REPO, ["data/historical/rivals/index.json"], lambda p: None, "main") == []
```

- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS. Si `test_current_rivals_index_is_consistent` falla con los datos actuales de `main`, la regla (4) se limita a comparar el delta respecto a base (Δtotals == ΣΔsummary) y se documenta en el commit.
- [ ] **Step 5:** Commit `feat: validación de datos para PRs`.

---

### Task 8: Workflows

**Files:**
- Create: `.github/workflows/pr-checks.yml`, `.github/workflows/update-game-stats.yml`
- Modify: `.github/workflows/automerge.yml` (reescritura completa)

`pr-checks.yml` (`name: PR checks`; `on: pull_request: branches: [main]`; `permissions: contents: read`; un job `validate`):
1. `actions/checkout@v7` con `submodules: recursive`, `fetch-depth: 0`.
2. Setup Go + cache + instalar Hugo 0.158.0 extended + `hugo mod tidy`: copiar los pasos tal cual de `hugo.yaml`.
3. `hugo --gc --buildFuture --minify` (+ `--panicOnWarning` solo si en Step 3 de abajo `main` compila limpio con él).
4. `make validate-contracts SKIP_HUGO_BUILD=1`.
5. `actions/setup-python@v7` 3.11, `pip install -r .github/scripts/requirements.txt`, `cd .github/scripts && python -m pytest -q`.
6. `python .github/scripts/validate_data.py --base origin/${{ github.base_ref }} --branch ${{ github.head_ref }}`.

`update-game-stats.yml`: `on: schedule: cron "*/30 * * * *"` + `workflow_dispatch` (inputs `game_id`, `season`, ambos opcionales); `concurrency: {group: update-game-stats, cancel-in-progress: false}`; `permissions: contents: write, pull-requests: write`. Pasos: checkout (token `PUSH`), setup-python 3.11, pip install; `python .github/scripts/update_game_stats.py --mode stats [--game-id/--season]` (id `stats`); `peter-evans/create-pull-request@v8` con `branch: auto/game-stats`, `title: "feat: estadísticas automáticas ${{ steps.stats.outputs.changed }}"`, `labels: automerge`, `delete-branch: true`, `token: PUSH`, committer/author como en `update-youtube-videos.yml`, `add-paths: data/historical, assets/gamebooks`; luego `python ... --mode gamebook` (id `gamebook`) y un segundo `create-pull-request` con `branch: auto/gamebook`, `title: "feat: gamebook ${{ steps.gamebook.outputs.changed }}"`. (create-pull-request restaura el árbol tras cada uso y cierra/borra la rama fija cuando ya no hay diff con `main`, lo que resuelve las PRs obsoletas.)

`automerge.yml` (`on: workflow_run: workflows: ["PR checks"], types: [completed]`): job con `if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'pull_request'`; paso con `GH_TOKEN: secrets.PUSH`: `PR=$(jq -r '.pull_requests[0].number // empty' <<< '${{ toJSON(github.event.workflow_run) }}')`; si vacío salir; si `gh pr view $PR --json labels,isDraft,headRefOid` tiene label `automerge`, no es draft y `headRefOid == github.event.workflow_run.head_sha` → `gh pr merge $PR --squash --delete-branch`. (Merge con PAT para que el push a `main` dispare el deploy.)

- [ ] **Step 1:** Comprobar el build tal como lo hará CI: `hugo --gc --buildFuture --panicOnWarning` y `make validate-contracts SKIP_HUGO_BUILD=1` en local → anotar si pasan; decidir `--panicOnWarning`.
- [ ] **Step 2:** Escribir los tres workflows. `actionlint` si está disponible (`brew install actionlint` no: usar `docker run --rm -v $PWD:/repo -w /repo rhysd/actionlint:latest` si hay Docker; si no, revisión manual).
- [ ] **Step 3:** Commit `ci: validación de PRs, automerge por workflow_run y actualización automática de partidos`.

---

### Task 9: Verificación end-to-end

- [ ] **Step 1:** `cd .github/scripts && python -m pytest -q` → todo PASS.
- [ ] **Step 2:** Push de la rama y abrir PR (pedir confirmación a Javi antes de hacer push). Comprobar que `PR checks` se ejecuta y pasa en la propia PR; esta PR **no** lleva label `automerge`.
- [ ] **Step 3:** Tras merge (lo hace Javi), lanzar `gh workflow run update-game-stats.yml` y verificar: se crea `auto/game-stats` con los partidos del 1, 8 y 15 nov; `PR checks` pasa; `Automerge` la fusiona; `Deploy Hugo site to Pages` se ejecuta. Si los gamebooks no venían ya incluidos, en una ejecución posterior aparece `auto/gamebook`.
- [ ] **Step 4:** Una ejecución más sin partidos pendientes no abre PR.
