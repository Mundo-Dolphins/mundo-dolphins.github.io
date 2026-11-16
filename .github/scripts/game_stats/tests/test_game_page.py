import copy
import json

import pytest

from game_stats.espn import parse_schedule
from game_stats.game_page import fill_game_page, translate_scoring

from .conftest import DATA, load

GAMES = DATA / "games" / "2026"
SCHEDULE = {g.week: g for g in parse_schedule(load("espn_schedule_2026.json"))}
WEEK7, WEEK9, WEEK10 = SCHEDULE[7], SCHEDULE[9], SCHEDULE[10]


def read_game(game_id):
    return json.loads((GAMES / f"{game_id}.json").read_text(encoding="utf-8"))


def as_scheduled(page):
    """Vacía una ficha final como la dejaría phins-stats antes del partido."""
    page = copy.deepcopy(page)
    s = page["sections"]
    s["Anotaciones"] = {"linescore": [], "scoring_summary": []}
    for team in s["Equipos"].values():
        team["Estadísticas"] = {}
        team["Estadísticas por jugador"] = {"Defensiva": [], "Equipos especiales": [], "Ofensiva": []}
        team["Puntos"] = 0
    info = s["Información del partido"]
    s["Información del partido"] = {k: info[k] for k in ("Semana", "Tipo de partido", "Fecha", "Estadio")}
    s["Información del partido"]["Estado"] = "scheduled"
    s["Oficiales"] = []
    return page


def week10():
    return fill_game_page(read_game("202611150clt"), load("espn_summary_401873059.json"), WEEK10)


def week7():
    return fill_game_page(as_scheduled(read_game("202610250nyj")), load("espn_summary_401873015.json"), WEEK7)


def test_week10_basic():
    s = week10()["sections"]
    info = s["Información del partido"]
    assert info["Estado"] == "final"
    assert info["Asistencia"] == "64,235"
    assert info["Superficie de juego"] == "Césped artificial"
    assert info["Hora de inicio"] == "1:00 PM EST"
    assert "Gamebook oficial" not in info and "Clima" not in info
    assert s["Anotaciones"]["linescore"][0] == {"Equipo": "Miami Dolphins", "1": "0", "2": "7", "3": "9", "4": "6", "Final": "22"}
    assert s["Equipos"]["Miami Dolphins"]["Record"] == "1-8"
    assert s["Equipos"]["Miami Dolphins"]["Puntos"] == 22
    assert s["Equipos"]["Indianapolis Colts"]["Coach"] == "Shane Steichen"
    assert s["Series ofensivas"] == {} and s["Conteo de snaps"] == {}
    assert s["Oficiales"][0].keys() == {"Nombre", "Posición"}


def test_generated_at_is_kickoff():
    assert week10()["generated_at"] == "2026-11-15T18:00:00Z"


def test_input_not_mutated():
    page = read_game("202611150clt")
    before = copy.deepcopy(page)
    fill_game_page(page, load("espn_summary_401873059.json"), WEEK10)
    assert page == before


def test_team_stats_match_existing_nyj():
    existing = read_game("202610250nyj")["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas"]
    got = week7()["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas"]
    for key in ["Carreras-yardas-TD", "Comp-Int-Yds-TD-INT", "Conv. en tercer down", "Eficacia en tercer down",
                "Conv. en cuarto down", "Primeros downs", "Tiempo de posesión", "Resultado final",
                "Yardas netas de carrera", "Despejes: número y promedio"]:
        assert got[key] == existing[key], key
    assert set(got) <= set(existing)


def test_player_columns_match_existing():
    existing = read_game("202610250nyj")["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas por jugador"]
    got = week7()["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas por jugador"]
    for group in ("Ofensiva", "Defensiva", "Equipos especiales"):
        assert got[group], group
        assert set(got[group][0]) == set(existing[group][0]), group


def test_quarterback_row():
    rows = week7()["sections"]["Equipos"]["Miami Dolphins"]["Estadísticas por jugador"]["Ofensiva"]
    qb = next(r for r in rows if r["Nombre"] == "Malik Willis")
    assert (qb["Comp"], qb["Intentos"], qb["Yds pase"], qb["TD pase"], qb["Equipo"]) == ("14", "21", "208", "2", "MIA")
    assert qb["Rec"] == "0" and qb["Largo pase"] == ""


def test_home_game_scores():
    out = fill_game_page(read_game("202611080mia"), load("espn_summary_401873042.json"), WEEK9)
    lines = out["sections"]["Anotaciones"]["linescore"]
    last = out["sections"]["Anotaciones"]["scoring_summary"][-1]
    assert lines[0]["Equipo"] == "Detroit Lions"
    assert last["Marcador visitante"] == lines[0]["Final"] and last["Marcador local"] == lines[1]["Final"]


def test_overtime_linescore():
    summary = load("espn_summary_401873059.json")
    for c in summary["header"]["competitions"][0]["competitors"]:
        c["linescores"].append({"displayValue": "3" if c["homeAway"] == "home" else "0"})
        c["score"] = str(int(c["score"]) + (3 if c["homeAway"] == "home" else 0))
    lines = fill_game_page(read_game("202611150clt"), summary, WEEK10)["sections"]["Anotaciones"]["linescore"]
    assert lines[1]["OT"] == "3"
    assert lines[1]["Final"] == str(sum(int(lines[1][q]) for q in ("1", "2", "3", "4", "OT")))


def test_overtime_scoring_period():
    summary = load("espn_summary_401873059.json")
    summary["scoringPlays"][-1]["period"]["number"] = 5
    plays = fill_game_page(read_game("202611150clt"), summary, WEEK10)["sections"]["Anotaciones"]["scoring_summary"]
    assert plays[-1]["Cuarto"] == "OT"


@pytest.mark.parametrize("src,dst", [
    ("Seth McGowan 4 Yd Rush (Spencer Shrader Kick)", "Seth McGowan carrera de 4 yardas (Spencer Shrader kick)"),
    ("Laquon Treadwell 7 Yd pass from Daniel Jones (Spencer Shrader Kick)",
     "Laquon Treadwell pase de 7 yardas de Daniel Jones (Spencer Shrader kick)"),
    ("Zane Gonzalez 53 Yd Field Goal ", "Zane Gonzalez field goal de 53 yardas"),
    ("Kyle McCord 1 Yd Rush (Two-Point Pass Conversion Failed)", "Kyle McCord carrera de 1 yarda (conversión fallida)"),
    ("Chris Johnson 59 Yd Interception Return (Zane Gonzalez PAT Failed)",
     "Chris Johnson 59 yardas retorno de interception (Zane Gonzalez kick failed)"),
    ("Adetomiwa Adebawore Fumble Recovery in End Zone (Spencer Shrader Kick)",
     "Adetomiwa Adebawore Fumble Recovery in End Zone (Spencer Shrader Kick)"),
])
def test_translate_scoring(src, dst):
    assert translate_scoring(src) == dst
