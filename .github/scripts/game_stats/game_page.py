"""Rellena una ficha de partido `scheduled` con los datos del resumen de ESPN.

Las claves de salida son las que genera phins-stats (ver
data/historical/games/2026/202610250nyj.json); lo que ESPN no ofrece se omite.
"""

import copy
import re
from decimal import ROUND_HALF_UP, Decimal

from .espn import ScheduledGame, _parse_utc
from .teams import by_espn

# Estadística de equipo de ESPN -> claves de la ficha que reciben su valor tal cual.
DIRECT_TEAM_STATS = {
    "firstDowns": ("Primeros downs", "Primeros downs totales"),
    "firstDownsPassing": ("Por pase",),
    "firstDownsRushing": ("Por carrera",),
    "firstDownsPenalty": ("Por penalización",),
    "thirdDownEff": ("Conv. en tercer down",),
    "fourthDownEff": ("Conv. en cuarto down",),
    "totalOffensivePlays": ("Jugadas ofensivas totales (incluye sacks)",),
    "totalYards": ("Yardas totales", "Yardas netas totales"),
    "yardsPerPlay": ("Promedio por jugada ofensiva",),
    "netPassingYards": ("Yardas netas de pase", "Yardas netas por pase"),
    "yardsPerPass": ("Promedio por jugada de pase (incluye sacks)",),
    "sacksYardsLost": ("Sacks-yardas perdidas", "Sacks recibidos-yardas perdidas al pasar"),
    "rushingYards": ("Yardas netas de carrera",),
    "rushingAttempts": ("Jugadas de carrera totales",),
    "yardsPerRushAttempt": ("Promedio por carrera",),
    "totalPenaltiesYards": ("Penalizaciones-yardas", "Penalizaciones: número y yardas"),
    "turnovers": ("Pérdidas de balón",),
    "possessionTime": ("Tiempo de posesión",),
}

OFFENSE_COLUMNS = (
    "Nombre", "Equipo", "Comp", "Intentos", "Yds pase", "TD pase", "INT", "Largo pase", "Capturas recibidas",
    "Yds perdidas capturas", "Rating", "Carreras", "Yds carrera", "TD carrera", "Largo carrera", "Rec",
    "Objetivos", "Yds recepción", "TD recepción", "Largo recepción", "Fumbles", "Fumbles perdidos",
)
DEFENSE_COLUMNS = (
    "Nombre", "Equipo", "Tackles", "Solo", "Asist", "Capturas", "TFL", "Golpes QB", "Pases defendidos", "INT",
    "Yds INT", "TD INT", "INT largo", "FF", "FR", "Yds FR", "TD FR",
)
SPECIAL_COLUMNS = (
    "Nombre", "Equipo", "FGm", "FGa", "FG largo", "XPm", "XPa", "Punts", "Yds punt", "Prom punt", "Largo punt",
)
# Columnas que ESPN no ofrece: se dejan vacías en lugar de ponerlas a cero.
UNAVAILABLE = {"Largo pase", "INT largo", "FF", "Yds FR", "TD FR"}


def _split(value: str, sep: str) -> tuple[str, str]:
    left, _, right = value.partition(sep)
    return left, right


def _player_stats_by_group(team_players: dict) -> dict[str, list[tuple[dict, dict[str, str]]]]:
    groups = {}
    for group in team_players.get("statistics", []):
        rows = []
        for athlete in group.get("athletes", []):
            rows.append((athlete["athlete"], dict(zip(group["labels"], athlete["stats"]))))
        groups[group["name"]] = rows
    return groups


def _offense_values(group: str, s: dict[str, str]) -> dict[str, str]:
    if group == "passing":
        comp, att = _split(s["C/ATT"], "/")
        sacks, sack_yards = _split(s["SACKS"], "-")
        return {"Comp": comp, "Intentos": att, "Yds pase": s["YDS"], "TD pase": s["TD"], "INT": s["INT"],
                "Capturas recibidas": sacks, "Yds perdidas capturas": sack_yards, "Rating": s["RTG"]}
    if group == "rushing":
        return {"Carreras": s["CAR"], "Yds carrera": s["YDS"], "TD carrera": s["TD"], "Largo carrera": s["LONG"]}
    if group == "receiving":
        return {"Rec": s["REC"], "Objetivos": s["TGTS"], "Yds recepción": s["YDS"], "TD recepción": s["TD"],
                "Largo recepción": s["LONG"]}
    if group == "fumbles":
        return {"Fumbles": s["FUM"], "Fumbles perdidos": s["LOST"]}
    return {}


def _defense_values(group: str, s: dict[str, str]) -> dict[str, str]:
    if group == "defensive":
        tackles, solo = s["TOT"], s["SOLO"]
        return {"Tackles": tackles, "Solo": solo, "Asist": str(int(tackles) - int(solo)), "Capturas": s["SACKS"],
                "TFL": s["TFL"], "Golpes QB": s["QB HTS"], "Pases defendidos": s["PD"]}
    if group == "interceptions":
        return {"INT": s["INT"], "Yds INT": s["YDS"], "TD INT": s["TD"]}
    if group == "fumbles":
        return {"FR": s["REC"]}
    return {}


def _special_values(group: str, s: dict[str, str]) -> dict[str, str]:
    if group == "kicking":
        fgm, fga = _split(s["FG"], "/")
        xpm, xpa = _split(s["XP"], "/")
        return {"FGm": fgm, "FGa": fga, "FG largo": s["LONG"], "XPm": xpm, "XPa": xpa}
    if group == "punting":
        return {"Punts": s["NO"], "Yds punt": s["YDS"], "Prom punt": s["AVG"], "Largo punt": s["LONG"]}
    return {}


def _player_rows(groups, abbr: str, columns, groups_used, extract) -> list[dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    for group in groups_used:
        for athlete, stats in groups.get(group, []):
            values = extract(group, stats)
            if not values:
                continue
            row = rows.get(athlete["id"])
            if row is None:
                row = {c: ("" if c in UNAVAILABLE else "0") for c in columns}
                row["Nombre"] = athlete["displayName"]
                row["Equipo"] = abbr
                rows[athlete["id"]] = row
            row.update(values)
    return list(rows.values())


def _sum(groups, group: str, label: str) -> int:
    return sum(int(stats[label]) for _, stats in groups.get(group, []))


def _round1(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _pct(made: int, attempts: int, decimals: int) -> str:
    if attempts == 0:
        return "0%"
    value = made * 100 / attempts
    return f"{value:.{decimals}f}%" if decimals else f"{round(value)}%"


def _team_stats(stats: dict[str, str], groups, points: int, touchdowns: int) -> dict[str, str]:
    out = {}
    for name, keys in DIRECT_TEAM_STATS.items():
        if name in stats:
            for key in keys:
                out[key] = stats[name]
    for name, key in (("thirdDownEff", "Eficacia en tercer down"), ("fourthDownEff", "Eficacia en cuarto down")):
        if name in stats:
            made, att = _split(stats[name], "-")
            out[key] = f"{stats[name]}-{_pct(int(made), int(att), 1)}"
    if "redZoneAttempts" in stats:
        made, att = _split(stats["redZoneAttempts"], "-")
        out["Eficacia en zona roja"] = f"{stats['redZoneAttempts']}-{_pct(int(made), int(att), 0)}"
    if "completionAttempts" in stats and "interceptions" in stats:
        comp, att = _split(stats["completionAttempts"], "/")
        out["Pases intentados-completados-interceptados"] = f"{att}-{comp}-{stats['interceptions']}"

    if "rushing" in groups:
        out["Carreras-yardas-TD"] = "-".join(str(_sum(groups, "rushing", k)) for k in ("CAR", "YDS", "TD"))
    if "passing" in groups:
        passing = [stats for _, stats in groups["passing"]]
        comp = sum(int(_split(s["C/ATT"], "/")[0]) for s in passing)
        att = sum(int(_split(s["C/ATT"], "/")[1]) for s in passing)
        yards = _sum(groups, "passing", "YDS")
        out["Comp-Int-Yds-TD-INT"] = f"{comp}-{att}-{yards}-{_sum(groups, 'passing', 'TD')}-{_sum(groups, 'passing', 'INT')}"
        out["Yardas brutas de pase"] = str(yards)
    if "kicking" in groups:
        kicking = [stats for _, stats in groups["kicking"]]
        for label, key in (("FG", "Goles de campo anotados-intentados"), ("XP", "Puntos extra anotados-intentados")):
            made = sum(int(_split(s[label], "/")[0]) for s in kicking)
            att = sum(int(_split(s[label], "/")[1]) for s in kicking)
            out[key] = f"{made}-{att}"
    if groups.get("punting"):
        number = _sum(groups, "punting", "NO")
        yards = _sum(groups, "punting", "YDS")
        out["Despejes: número y promedio"] = f"{number}-{_round1(yards / Decimal(number))}" if number else "0-0"
    out["Touchdowns"] = str(touchdowns)
    out["Resultado final"] = str(points)
    return out


_EXTRA = [
    (re.compile(r"^(.+?) Kick$"), r"\1 kick"),
    (re.compile(r"^(.+?) PAT Failed$"), r"\1 kick failed"),
    (re.compile(r"^Two-Point (Pass|Run) Conversion Failed$"), "conversión fallida"),
]
_PLAYS = [
    (re.compile(r"^(.+?) (\d+) Yd pass from (.+?)$"), lambda m: f"{m[1]} pase de {m[2]} yardas de {m[3]}"),
    (re.compile(r"^(.+?) (\d+) Yd Rush$"), lambda m: f"{m[1]} carrera de {m[2]} {'yarda' if m[2] == '1' else 'yardas'}"),
    (re.compile(r"^(.+?) (\d+) Yd Field Goal$"), lambda m: f"{m[1]} field goal de {m[2]} yardas"),
    (re.compile(r"^(.+?) (\d+) Yd Interception Return$"), lambda m: f"{m[1]} {m[2]} yardas retorno de interception"),
    (re.compile(r"^(.+?) (\d+) Yd Kickoff Return$"), lambda m: f"{m[1]} {m[2]} yardas retorno de kickoff"),
    (re.compile(r"^(.+?) (\d+) Yd Punt Return$"), lambda m: f"{m[1]} {m[2]} yardas punt return"),
]


def translate_scoring(text: str) -> str:
    text = text.strip()
    match = re.match(r"^(.*?)(?: \((.*)\))?$", text)
    play, extra = match[1], match[2]
    for pattern, render in _PLAYS:
        m = pattern.match(play)
        if m:
            break
    else:
        return text
    result = render(m)
    if extra is not None:
        for pattern, replacement in _EXTRA:
            if pattern.match(extra):
                extra = pattern.sub(replacement, extra)
                break
        result += f" ({extra})"
    return result


def _period(number: int) -> str:
    return str(number) if number <= 4 else "OT"


def _format_kickoff(game: ScheduledGame) -> str:
    kickoff = game.kickoff_et
    return f"{kickoff.hour % 12 or 12}:{kickoff:%M %p} {kickoff.tzname()}"


def fill_game_page(page: dict, summary: dict, game: ScheduledGame) -> dict:
    page = copy.deepcopy(page)
    sections = page["sections"]
    competition = summary["header"]["competitions"][0]
    competitors = {c["homeAway"]: c for c in competition["competitors"]}
    ordered = [competitors["away"], competitors["home"]]
    name_of = {c["team"]["abbreviation"]: by_espn(c["team"]["abbreviation"]).name for c in ordered}

    linescore = []
    for c in ordered:
        row = {"Equipo": name_of[c["team"]["abbreviation"]]}
        for index, quarter in enumerate(c.get("linescores", []), start=1):
            row[_period(index)] = quarter["displayValue"]
        row["Final"] = str(c["score"])
        linescore.append(row)
    scoring = [
        {
            "Cuarto": _period(play["period"]["number"]),
            "Tiempo": play["clock"]["displayValue"],
            "Equipo": by_espn(play["team"]["abbreviation"]).name,
            "Descripción": translate_scoring(play["text"]),
            "Marcador visitante": str(play["awayScore"]),
            "Marcador local": str(play["homeScore"]),
        }
        for play in summary.get("scoringPlays", [])
    ]
    sections["Anotaciones"] = {"linescore": linescore, "scoring_summary": scoring}

    team_stats = {t["team"]["abbreviation"]: {s["name"]: s["displayValue"] for s in t["statistics"]}
                  for t in summary["boxscore"].get("teams", [])}
    players = {p["team"]["abbreviation"]: _player_stats_by_group(p) for p in summary["boxscore"].get("players", [])}
    for c in ordered:
        abbr = c["team"]["abbreviation"]
        team = sections["Equipos"][name_of[abbr]]
        points = int(c["score"])
        groups = players.get(abbr, {})
        touchdowns = sum(1 for p in summary.get("scoringPlays", [])
                         if p["team"]["abbreviation"] == abbr and p["type"].get("abbreviation") == "TD")
        team["Puntos"] = points
        record = next((r["summary"] for r in c.get("record", []) if r.get("type") == "total"), None)
        if record:
            team["Record"] = record
        team["Estadísticas"] = _team_stats(team_stats.get(abbr, {}), groups, points, touchdowns)
        team["Estadísticas por jugador"] = {
            "Defensiva": _player_rows(groups, abbr, DEFENSE_COLUMNS, ("defensive", "interceptions", "fumbles"),
                                      _defense_values),
            "Equipos especiales": _player_rows(groups, abbr, SPECIAL_COLUMNS, ("kicking", "punting"), _special_values),
            "Ofensiva": _player_rows(groups, abbr, OFFENSE_COLUMNS, ("passing", "rushing", "receiving", "fumbles"),
                                     _offense_values),
        }

    info = sections["Información del partido"]
    info["Estado"] = "final"
    game_info = summary.get("gameInfo", {})
    venue = game_info.get("venue", {})
    if "grass" in venue:
        info["Superficie de juego"] = "Césped natural" if venue["grass"] else "Césped artificial"
    weather = game_info.get("weather")
    if weather and weather.get("temperature") is not None:
        info["Clima"] = f"{weather['temperature']} grados"
    info["Hora de inicio"] = _format_kickoff(game)
    if game_info.get("attendance"):
        info["Asistencia"] = f"{int(game_info['attendance']):,}"

    officials = sorted(game_info.get("officials", []), key=lambda o: o.get("order", 0))
    if officials:
        sections["Oficiales"] = [{"Nombre": o["fullName"], "Posición": o["position"]["displayName"]} for o in officials]

    page["generated_at"] = _parse_utc(competition["date"]).strftime("%Y-%m-%dT%H:%M:%SZ")
    return page
