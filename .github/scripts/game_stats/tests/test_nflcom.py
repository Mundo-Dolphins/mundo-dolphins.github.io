import gzip
import re
from dataclasses import replace

from game_stats.espn import parse_schedule
from game_stats.nflcom import download_gamebook, find_gamebook_url, game_url
from game_stats.teams import MIAMI, by_espn

from .conftest import FIXTURES, load

HTML = gzip.decompress((FIXTURES / "nfl_week10.html.gz").read_bytes()).decode("utf-8")
SCHEDULE = {g.week: g for g in parse_schedule(load("espn_schedule_2026.json"))}
MIAMI_PDF = "ab789365-4feb-11f1-abca-2c54536568a9.pdf"


class FakeResponse:
    def __init__(self, status, content):
        self.status_code, self.content = status, content


class FakeSession:
    def __init__(self, status, content):
        self.response = FakeResponse(status, content)

    def get(self, url, **kwargs):
        return self.response


def test_url_away():
    assert game_url(SCHEDULE[10]) == "https://www.nfl.com/games/dolphins-at-colts-2026-reg-10"


def test_url_home():
    assert game_url(SCHEDULE[9]) == "https://www.nfl.com/games/lions-at-dolphins-2026-reg-9"


def test_url_preseason_week_is_shifted():
    # ESPN numera la pretemporada desde el Hall of Fame Game: su semana 2 es la "pre-1" de NFL.com.
    game = replace(SCHEDULE[1], season_type=1, week=2, home=by_espn("WSH"), away=MIAMI)
    assert game_url(game) == "https://www.nfl.com/games/dolphins-at-commanders-2026-pre-1"


PAGE_URL = "https://www.nfl.com/games/dolphins-at-colts-2026-reg-10"


def test_finds_miami_pdf():
    url = find_gamebook_url(HTML, PAGE_URL)
    assert url.startswith("https://static.www.nfl.com/") and url.endswith("/gamecenter/" + MIAMI_PDF)


def test_no_other_games_pdf():
    blanked = re.sub(r"https://static\.www\.nfl\.com/[^\"\\]*" + re.escape(MIAMI_PDF), "", HTML)
    assert find_gamebook_url(blanked, PAGE_URL) is None


def test_rejects_page_for_other_game():
    assert find_gamebook_url(HTML, "https://www.nfl.com/games/lions-at-dolphins-2026-reg-9") is None


def test_rejects_html_download(tmp_path):
    dest = tmp_path / "x.pdf"
    assert download_gamebook("u", dest, FakeSession(200, b"<html>nope</html>")) is False
    assert not dest.exists()


def test_rejects_tiny_pdf(tmp_path):
    assert download_gamebook("u", tmp_path / "x.pdf", FakeSession(200, b"%PDF-1.7")) is False


def test_rejects_error_status(tmp_path):
    assert download_gamebook("u", tmp_path / "x.pdf", FakeSession(404, b"%PDF-1.7" + b"0" * 20000)) is False


def test_accepts_pdf(tmp_path):
    dest = tmp_path / "sub" / "x.pdf"
    assert download_gamebook("u", dest, FakeSession(200, b"%PDF-1.7" + b"0" * 20000)) is True
    assert dest.read_bytes().startswith(b"%PDF")


HTML_WEEK9 = gzip.decompress((FIXTURES / "nfl_week9.html.gz").read_bytes()).decode("utf-8")


def test_finds_own_pdf_when_scoreboard_is_another_week():
    # La página de la semana 9 trae el marcador de la semana 10; su gamebook está en el enlace de descarga.
    url = find_gamebook_url(HTML_WEEK9, "https://www.nfl.com/games/lions-at-dolphins-2026-reg-9")
    assert url.endswith("/gamecenter/ab381a59-4feb-11f1-abca-2c54536568a9.pdf")
