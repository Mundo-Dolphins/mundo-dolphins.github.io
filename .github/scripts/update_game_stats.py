#!/usr/bin/env python3
"""Actualiza automáticamente las fichas de los partidos de Miami ya terminados.

--mode stats     rellena fichas `scheduled` de partidos finalizados (ESPN), la temporada y los
                 rivales, e incluye el gamebook si NFL.com ya lo ha publicado.
--mode gamebook  añade el gamebook a fichas `final` recientes que todavía no lo tienen.

Escribe en $GITHUB_OUTPUT `changed=<game_ids separados por comas>`.
"""

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal

import requests

from game_stats.espn import EASTERN, ScheduledGame, fetch_schedule, fetch_summary
from game_stats.game_page import fill_game_page
from game_stats.jsonio import read_json, write_json
from game_stats.nflcom import download_gamebook, fetch_page, find_gamebook_url, game_url
from game_stats.rivals import update_rivals
from game_stats.season import result_from, update_season
from game_stats.teams import MIAMI

GAMEBOOK_WINDOW = timedelta(days=14)
INFO = "Información del partido"


def _gamebook_path(season: int, game_id: str) -> str:
    return f"assets/gamebooks/{season}/{game_id}.pdf"


def _try_gamebook(root: Path, game: ScheduledGame, session) -> str | None:
    """Descarga el gamebook si ya está publicado y devuelve su ruta relativa."""
    url = game_url(game)
    html = fetch_page(url, session)
    pdf_url = find_gamebook_url(html, url) if html else None
    if not pdf_url:
        return None
    relative = _gamebook_path(game.season, game.game_id)
    return relative if download_gamebook(pdf_url, root / relative, session) else None


def _season_scores(games_dir: Path) -> dict[str, tuple[int, int]]:
    scores = {}
    for path in games_dir.glob("*.json"):
        page = read_json(path)
        if page["sections"][INFO].get("Estado") != "final":
            continue
        teams = page["sections"]["Equipos"]
        opponent = next(name for name in teams if name != MIAMI.name)
        scores[page["page"]["params"]["game_id"]] = (int(teams[MIAMI.name]["Puntos"]), int(teams[opponent]["Puntos"]))
    return scores


def _run_stats(root: Path, games: list[ScheduledGame], games_dir: Path, session) -> list[str]:
    changed, failures = [], 0
    season_path = root / "data/historical/seasons" / f"{games[0].season}.json" if games else None
    rivals_path = root / "data/historical/rivals/index.json"
    for game in games:
        path = games_dir / f"{game.game_id}.json"
        if not path.exists():
            print(f"::warning::No existe la ficha {path}", file=sys.stderr)
            continue
        page = read_json(path)
        if page["sections"][INFO].get("Estado") != "scheduled":
            continue
        try:
            filled = fill_game_page(page, fetch_summary(game.event_id, session), game)
        except requests.RequestException as error:
            failures += 1
            print(f"::warning::{game.game_id}: {error}", file=sys.stderr)
            continue
        try:
            gamebook = _try_gamebook(root, game, session)
        except requests.RequestException as error:
            # El gamebook es opcional: llegará en la pasada de gamebook.
            print(f"::warning::{game.game_id}: gamebook no disponible ({error})", file=sys.stderr)
            gamebook = None
        if gamebook:
            filled["sections"][INFO]["Gamebook oficial"] = gamebook
        write_json(path, filled)

        result = result_from(filled, game)
        if season_path.exists():
            write_json(season_path, update_season(read_json(season_path), result, _season_scores(games_dir)))
        if rivals_path.exists():
            write_json(rivals_path, update_rivals(read_json(rivals_path), result, filled["generated_at"]))
        changed.append(game.game_id)
    if failures and not changed:
        raise RuntimeError(f"No se pudo actualizar ningún partido ({failures} errores)")
    return changed


def _run_gamebook(root: Path, games: list[ScheduledGame], games_dir: Path, today: date, session) -> list[str]:
    changed = []
    for game in games:
        if game.kickoff_et.date() < today - GAMEBOOK_WINDOW:
            continue
        path = games_dir / f"{game.game_id}.json"
        if not path.exists():
            continue
        page = read_json(path)
        info = page["sections"][INFO]
        if info.get("Estado") != "final" or info.get("Gamebook oficial"):
            continue
        try:
            gamebook = _try_gamebook(root, game, session)
        except requests.RequestException as error:
            print(f"::warning::{game.game_id}: {error}", file=sys.stderr)
            continue
        if gamebook:
            info["Gamebook oficial"] = gamebook
            write_json(path, page)
            changed.append(game.game_id)
    return changed


def run(mode: Literal["stats", "gamebook"], root: Path, season: int, today: date, session,
        game_id: str | None = None) -> list[str]:
    games = [
        g for g in fetch_schedule(season, session)
        if g.final and g.kickoff_et.date() <= today and (game_id is None or g.game_id == game_id)
    ]
    games.sort(key=lambda g: g.kickoff_utc)
    games_dir = root / "data/historical/games" / str(season)
    if mode == "stats":
        return _run_stats(root, games, games_dir, session)
    return _run_gamebook(root, games, games_dir, today, session)


def _default_season(today: date) -> int:
    return today.year - 1 if today.month <= 2 else today.year


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", choices=("stats", "gamebook"), required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--season", type=int)
    parser.add_argument("--game-id")
    args = parser.parse_args()

    today = datetime.now(EASTERN).date()
    session = requests.Session()
    changed = run(args.mode, args.root, args.season or _default_season(today), today, session, args.game_id)
    print(f"{args.mode}: {', '.join(changed) or 'sin cambios'}")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as fh:
            fh.write(f"changed={','.join(changed)}\n")


if __name__ == "__main__":
    main()
