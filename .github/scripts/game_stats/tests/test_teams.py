from game_stats.teams import ALL, MIAMI, Team, by_espn


def test_lookup():
    assert by_espn("IND") == Team("IND", "clt", "colts", "Indianapolis Colts", "IND")
    assert by_espn("WSH").pfr == "was" and by_espn("WSH").nfl_abbr == "WAS"
    assert by_espn("SF").nfl_slug == "49ers"
    assert MIAMI.pfr == "mia"
    assert len({t.pfr for t in ALL}) == 32


def test_every_existing_game_suffix_is_known():
    from .conftest import DATA

    codes = {t.pfr for t in ALL}
    suffixes = {p.stem[9:] for p in (DATA / "games" / "2026").glob("*.json")}
    assert suffixes <= codes
