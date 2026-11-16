"""Equivalencias entre ESPN, Pro-Football-Reference y NFL.com para los 32 equipos."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Team:
    espn: str
    pfr: str
    nfl_slug: str
    name: str
    nfl_abbr: str


ALL: tuple[Team, ...] = (
    Team("ARI", "crd", "cardinals", "Arizona Cardinals", "AZ"),
    Team("ATL", "atl", "falcons", "Atlanta Falcons", "ATL"),
    Team("BAL", "rav", "ravens", "Baltimore Ravens", "BAL"),
    Team("BUF", "buf", "bills", "Buffalo Bills", "BUF"),
    Team("CAR", "car", "panthers", "Carolina Panthers", "CAR"),
    Team("CHI", "chi", "bears", "Chicago Bears", "CHI"),
    Team("CIN", "cin", "bengals", "Cincinnati Bengals", "CIN"),
    Team("CLE", "cle", "browns", "Cleveland Browns", "CLE"),
    Team("DAL", "dal", "cowboys", "Dallas Cowboys", "DAL"),
    Team("DEN", "den", "broncos", "Denver Broncos", "DEN"),
    Team("DET", "det", "lions", "Detroit Lions", "DET"),
    Team("GB", "gnb", "packers", "Green Bay Packers", "GB"),
    Team("HOU", "htx", "texans", "Houston Texans", "HOU"),
    Team("IND", "clt", "colts", "Indianapolis Colts", "IND"),
    Team("JAX", "jax", "jaguars", "Jacksonville Jaguars", "JAX"),
    Team("KC", "kan", "chiefs", "Kansas City Chiefs", "KC"),
    Team("LV", "rai", "raiders", "Las Vegas Raiders", "LV"),
    Team("LAC", "sdg", "chargers", "Los Angeles Chargers", "LAC"),
    Team("LAR", "ram", "rams", "Los Angeles Rams", "LAR"),
    Team("MIA", "mia", "dolphins", "Miami Dolphins", "MIA"),
    Team("MIN", "min", "vikings", "Minnesota Vikings", "MIN"),
    Team("NE", "nwe", "patriots", "New England Patriots", "NE"),
    Team("NO", "nor", "saints", "New Orleans Saints", "NO"),
    Team("NYG", "nyg", "giants", "New York Giants", "NYG"),
    Team("NYJ", "nyj", "jets", "New York Jets", "NYJ"),
    Team("PHI", "phi", "eagles", "Philadelphia Eagles", "PHI"),
    Team("PIT", "pit", "steelers", "Pittsburgh Steelers", "PIT"),
    Team("SF", "sfo", "49ers", "San Francisco 49ers", "SF"),
    Team("SEA", "sea", "seahawks", "Seattle Seahawks", "SEA"),
    Team("TB", "tam", "buccaneers", "Tampa Bay Buccaneers", "TB"),
    Team("TEN", "oti", "titans", "Tennessee Titans", "TEN"),
    Team("WSH", "was", "commanders", "Washington Commanders", "WAS"),
)

_BY_ESPN = {t.espn: t for t in ALL}

MIAMI = _BY_ESPN["MIA"]


def by_espn(abbr: str) -> Team:
    return _BY_ESPN[abbr]
