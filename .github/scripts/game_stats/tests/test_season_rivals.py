import copy
import json

from game_stats.rivals import game_type_from_week, update_rivals
from game_stats.season import GameResult, update_season
from game_stats.teams import by_espn

from .conftest import DATA

# Partidos final de temporada regular 2026 en el repo: (puntos a favor, en contra).
FINAL_2026 = {
    "202609130rai": (13, 27), "202609200sfo": (13, 35), "202609270mia": (10, 24),
    "202610040min": (10, 15), "202610110mia": (24, 31), "202610250nyj": (28, 25),
}


def load_repo(path):
    return json.loads((DATA / path).read_text(encoding="utf-8"))


def result(game_id, opp, pf, pa, week, home=False, date=None):
    date = date or f"{game_id[:4]}-{game_id[4:6]}-{game_id[6:8]}"
    return GameResult(
        game_id=game_id, date=date, week=week, game_type=game_type_from_week(week), home=home,
        opponent=by_espn(opp), points_for=pf, points_against=pa, path=f"historia/partidos/{game_id}",
    )


def rival(index, pfr):
    return next(r for r in index["data"]["rivals"] if r["opponent"]["id"] == pfr)


def test_rivals_adds_week10():
    before = load_repo("rivals/index.json")
    out = update_rivals(copy.deepcopy(before), result("202611150clt", "IND", 22, 24, "10"), "2026-11-15T18:00:00Z")
    clt, clt0 = rival(out, "clt"), rival(before, "clt")
    assert clt["summary"]["games"] == clt0["summary"]["games"] + 1
    assert clt["summary"]["losses"] == clt0["summary"]["losses"] + 1
    assert clt["summary"]["last_game"] == "2026-11-15"
    assert clt["by_season"][-1]["season"] == 2026 and clt["by_season"][-1]["games"] == 1
    latest = clt["latest_games"][0]
    assert latest["game_id"] == "202611150clt" and len(clt["latest_games"]) <= 5
    assert (latest["result"], latest["home_away"], latest["margin"], latest["opponent_id"]) == ("L", "away", -2, "clt")
    t, t0 = out["data"]["totals"], before["data"]["totals"]
    assert (t["games"], t["losses"], t["regular_season_games"]) == (t0["games"] + 1, t0["losses"] + 1,
                                                                   t0["regular_season_games"] + 1)
    assert t["point_differential"] == t["points_for"] - t["points_against"]
    assert out["generated_at"] == "2026-11-15T18:00:00Z"


def test_rivals_idempotent():
    index = load_repo("rivals/index.json")
    assert update_rivals(copy.deepcopy(index), result("202610250nyj", "NYJ", 28, 25, "7"), "x") == index


def test_rivals_tie_and_totals_consistent():
    out = update_rivals(load_repo("rivals/index.json"), result("202611150clt", "IND", 20, 20, "10"), "s")
    assert rival(out, "clt")["latest_games"][0]["result"] == "T"
    assert rival(out, "clt")["summary"]["ties"] == rival(load_repo("rivals/index.json"), "clt")["summary"]["ties"] + 1
    totals = out["data"]["totals"]
    for key in ("games", "wins", "losses", "ties", "points_for", "points_against"):
        assert totals[key] == sum(r["summary"][key] for r in out["data"]["rivals"]), key


def test_rivals_new_opponent():
    index = load_repo("rivals/index.json")
    index["data"]["rivals"] = [r for r in index["data"]["rivals"] if r["opponent"]["id"] != "clt"]
    opponents = index["data"]["totals"]["opponents"]
    out = update_rivals(index, result("202611150clt", "IND", 22, 24, "10"), "s")
    clt = rival(out, "clt")
    assert clt["summary"]["first_game"] == "2026-11-15" and clt["summary"]["games"] == 1
    assert out["data"]["totals"]["opponents"] == opponents + 1
    names = [r["opponent"]["name"] for r in out["data"]["rivals"]]
    assert names == sorted(names)


def test_game_type_from_week():
    assert [game_type_from_week(w) for w in ("10", "Wild Card", "Preseason 1", "")] == \
        ["regular_season", "playoffs", "unknown", "unknown"]


def test_season_marks_final_and_record():
    season = load_repo("seasons/2026.json")
    scores = dict(FINAL_2026, **{"202611010mia": (10, 20)})
    out = update_season(season, result("202611010mia", "NE", 10, 20, "8", home=True), scores)
    for section in ("Partidos de la temporada", "Partidos de la temporada regular"):
        item = next(i for i in out["sections"][section] if i["game_id"] == "202611010mia")
        assert item["status"] == "final"
    summary = out["sections"]["Resumen"]
    assert summary["Récord"] == "1-6-0"
    assert summary["Head Coach"] == "Jeff Hafley (1-6-0)"
    assert summary["Puntos a favor"] == "108 puntos. 30º de 32 equipos"
    assert summary["Puntos en contra"] == "177 puntos. 25º de 32 equipos"


def test_season_preseason_does_not_touch_record():
    season = load_repo("seasons/2026.json")
    out = update_season(copy.deepcopy(season), result("202608140was", "WSH", 3, 30, "Preseason 1"), FINAL_2026)
    assert out["sections"]["Resumen"] == season["sections"]["Resumen"]
