"""Cliente de la API no oficial de ESPN (calendario y resumen de partido)."""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from .teams import Team, by_espn

EASTERN = ZoneInfo("America/New_York")
SCHEDULE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/mia/schedule"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"
TIMEOUT = 30


@dataclass(frozen=True)
class ScheduledGame:
    event_id: str
    kickoff_utc: datetime
    season: int
    week: int
    season_type: int
    final: bool
    home: Team
    away: Team

    @property
    def kickoff_et(self) -> datetime:
        return self.kickoff_utc.astimezone(EASTERN)

    @property
    def game_id(self) -> str:
        return f"{self.kickoff_et:%Y%m%d}0{self.home.pfr}"


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_schedule(data: dict) -> list[ScheduledGame]:
    games = []
    for event in data.get("events", []):
        competition = event["competitions"][0]
        teams = {c["homeAway"]: by_espn(c["team"]["abbreviation"]) for c in competition["competitors"]}
        games.append(
            ScheduledGame(
                event_id=str(event["id"]),
                kickoff_utc=_parse_utc(event["date"]),
                season=int(event["season"]["year"]),
                week=int(event["week"]["number"]),
                season_type=int(event["seasonType"]["type"]),
                final=competition["status"]["type"]["name"] == "STATUS_FINAL",
                home=teams["home"],
                away=teams["away"],
            )
        )
    return games


def fetch_schedule(season: int, session) -> list[ScheduledGame]:
    games = []
    for season_type in (1, 2, 3):
        response = session.get(SCHEDULE_URL, params={"season": season, "seasontype": season_type}, timeout=TIMEOUT)
        response.raise_for_status()
        games.extend(parse_schedule(response.json()))
    return games


def fetch_summary(event_id: str, session) -> dict:
    response = session.get(SUMMARY_URL, params={"event": event_id}, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()
