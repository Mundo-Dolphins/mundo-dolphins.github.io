"""Resultado de un partido ya rellenado y su reflejo en seasons/<año>.json."""

import re
from dataclasses import dataclass

from .espn import ScheduledGame
from .rivals import game_type_from_week
from .teams import MIAMI, Team

REGULAR_GAMES = "Partidos de la temporada regular"


@dataclass(frozen=True)
class GameResult:
    game_id: str
    date: str
    week: str
    game_type: str
    home: bool
    opponent: Team
    points_for: int
    points_against: int
    path: str


def result_from(page: dict, game: ScheduledGame) -> GameResult:
    teams = page["sections"]["Equipos"]
    home = game.home == MIAMI
    opponent = game.away if home else game.home
    week = page["sections"]["Información del partido"]["Semana"]
    return GameResult(
        game_id=page["page"]["params"]["game_id"],
        date=page["page"]["date"],
        week=week,
        game_type=game_type_from_week(week),
        home=home,
        opponent=opponent,
        points_for=int(teams[MIAMI.name]["Puntos"]),
        points_against=int(teams[opponent.name]["Puntos"]),
        path=page["page"]["path"],
    )


def update_season(season: dict, result: GameResult, scores: dict[str, tuple[int, int]]) -> dict:
    """`scores` tiene los puntos (a favor, en contra) de cada partido final, incluido `result`."""
    sections = season["sections"]
    for items in sections.values():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and item.get("game_id") == result.game_id:
                    item["status"] = "final"

    if result.game_type != "regular_season":
        return season

    finals = [i["game_id"] for i in sections.get(REGULAR_GAMES, []) if i.get("status") == "final"]
    wins = losses = ties = points_for = points_against = 0
    for game_id in finals:
        pf, pa = scores[game_id]
        points_for += pf
        points_against += pa
        wins += pf > pa
        losses += pf < pa
        ties += pf == pa
    record = f"{wins}-{losses}-{ties}"

    summary = sections["Resumen"]
    summary["Récord"] = record
    if "Head Coach" in summary:
        summary["Head Coach"] = re.sub(r"\(\d+-\d+-\d+\)", f"({record})", summary["Head Coach"])
    for key, value in (("Puntos a favor", points_for), ("Puntos en contra", points_against)):
        if key in summary:
            summary[key] = re.sub(r"^\d+", str(value), summary[key])
    return season
