"""Suma un partido al índice de rivales con los mismos criterios que phins-stats
(internal/hugodata/rival_index.go), que lo regenera completo en la pasada manual."""

LATEST_GAMES = 5
PLAYOFF_MARKERS = ("playoff", "wild card", "division", "conference", "super bowl", "championship")
TYPE_COUNTERS = {"regular_season": "regular_season_games", "playoffs": "playoff_games"}


def game_type_from_week(week: str) -> str:
    value = week.strip().lower()
    if not value:
        return "unknown"
    if value.isdigit():
        return "regular_season"
    if any(marker in value for marker in PLAYOFF_MARKERS):
        return "playoffs"
    return "unknown"


def _result(points_for: int, points_against: int) -> str:
    if points_for > points_against:
        return "W"
    if points_for < points_against:
        return "L"
    return "T"


def _accumulate(summary: dict, game: dict) -> None:
    summary["games"] += 1
    summary["points_for"] += game["points_for"]
    summary["points_against"] += game["points_against"]
    summary["point_differential"] = summary["points_for"] - summary["points_against"]
    summary[{"W": "wins", "L": "losses", "T": "ties"}[game["result"]]] += 1
    counter = TYPE_COUNTERS.get(game["game_type"], "unknown_games")
    summary[counter] = summary.get(counter, 0) + 1


def _empty_summary() -> dict:
    return {"games": 0, "wins": 0, "losses": 0, "ties": 0, "points_for": 0, "points_against": 0,
            "point_differential": 0, "regular_season_games": 0, "playoff_games": 0}


def update_rivals(index: dict, result, stamp: str) -> dict:
    data = index["data"]
    if any(g["game_id"] == result.game_id for r in data["rivals"] for g in r["latest_games"]):
        return index

    season = int(result.game_id[:4])
    game = {
        "game_id": result.game_id,
        "season": season,
        "date": result.date,
        "week": result.week,
        "game_type": result.game_type,
        "home_away": "home" if result.home else "away",
        "opponent_id": result.opponent.pfr,
        "opponent_name": result.opponent.name,
        "points_for": result.points_for,
        "points_against": result.points_against,
        "result": _result(result.points_for, result.points_against),
        "margin": result.points_for - result.points_against,
        "path": result.path,
    }

    rival = next((r for r in data["rivals"] if r["opponent"]["id"] == result.opponent.pfr), None)
    if rival is None:
        rival = {
            "opponent": {"id": result.opponent.pfr, "name": result.opponent.name},
            "summary": dict(_empty_summary(), first_game=result.date, last_game=result.date),
            "by_season": [],
            "latest_games": [],
        }
        data["rivals"].append(rival)
        data["rivals"].sort(key=lambda r: r["opponent"]["name"])
        data["totals"]["opponents"] += 1

    _accumulate(rival["summary"], game)
    rival["summary"]["last_game"] = max(rival["summary"]["last_game"], result.date)

    by_season = next((s for s in rival["by_season"] if s["season"] == season), None)
    if by_season is None:
        by_season = dict({"season": season}, **_empty_summary())
        rival["by_season"].append(by_season)
        rival["by_season"].sort(key=lambda s: s["season"])
    _accumulate(by_season, game)

    rival["latest_games"] = sorted([game] + rival["latest_games"], key=lambda g: g["date"],
                                   reverse=True)[:LATEST_GAMES]

    _accumulate(data["totals"], game)
    data["range"]["to_season"] = max(data["range"]["to_season"], season)
    index["generated_at"] = stamp
    return index
