from game_stats.espn import parse_schedule

from .conftest import load


def games():
    return parse_schedule(load("espn_schedule_2026.json"))


def by_week(week):
    return next(g for g in games() if g.week == week)


def test_schedule_week10():
    g = by_week(10)
    assert g.final and g.away.pfr == "mia" and g.home.pfr == "clt"
    assert g.game_id == "202611150clt"
    assert g.season_type == 2 and g.season == 2026


def test_home_game_id():
    assert by_week(9).game_id == "202611080mia"


def test_scheduled_not_final():
    assert not by_week(11).final


def test_late_kickoff_uses_eastern_date():
    # 8:20 PM ET del domingo es lunes en UTC; el id debe usar la fecha ET.
    data = load("espn_schedule_2026.json")
    data["events"][0]["date"] = "2026-09-14T00:20Z"
    g = parse_schedule(data)[0]
    assert g.game_id.startswith("20260913")
