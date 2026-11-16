import gzip
import json
import shutil
from datetime import date

import pytest
import requests

from game_stats.jsonio import dumps
from update_game_stats import run

from .conftest import DATA, FIXTURES, load

PDF = b"%PDF-1.7\n" + b"0" * 20000
PAGES = {
    "https://www.nfl.com/games/dolphins-at-colts-2026-reg-10": "nfl_week10.html.gz",
    "https://www.nfl.com/games/lions-at-dolphins-2026-reg-9": "nfl_week9.html.gz",
}
SUMMARIES = {"401873059": "espn_summary_401873059.json", "401873042": "espn_summary_401873042.json"}
TODAY = date(2026, 11, 16)


class FakeResponse:
    def __init__(self, status=200, payload=None, content=b""):
        self.status_code, self._payload, self.content = status, payload, content
        self.text = content.decode("utf-8", "replace")

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code != 200:
            raise requests.HTTPError(str(self.status_code))


class FakeSession:
    def __init__(self, pdf=True):
        self.pdf = pdf
        self.calls = []

    def get(self, url, params=None, **kwargs):
        self.calls.append((url, params))
        if url.endswith("/teams/mia/schedule"):
            events = load("espn_schedule_2026.json") if params["seasontype"] == 2 else {"events": []}
            return FakeResponse(payload=events)
        if url.endswith("/summary"):
            name = SUMMARIES.get(params["event"])
            if name is None:
                raise requests.ConnectionError("sin fixture")
            return FakeResponse(payload=load(name))
        if url in PAGES:
            return FakeResponse(content=gzip.decompress((FIXTURES / PAGES[url]).read_bytes()))
        if url.startswith("https://static.www.nfl.com/") and url.endswith(".pdf"):
            return FakeResponse(content=PDF if self.pdf else b"<html>todavia no</html>")
        return FakeResponse(status=404)


@pytest.fixture
def repo_copy(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(DATA / "games" / "2026", root / "data/historical/games/2026")
    (root / "data/historical/seasons").mkdir(parents=True)
    (root / "data/historical/rivals").mkdir(parents=True)
    shutil.copy(DATA / "seasons/2026.json", root / "data/historical/seasons/2026.json")
    shutil.copy(DATA / "rivals/index.json", root / "data/historical/rivals/index.json")
    return root


def read(root, rel):
    return json.loads((root / "data/historical" / rel).read_text(encoding="utf-8"))


def snapshot(root):
    return {p: p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_dumps_matches_go_format():
    raw = (DATA / "seasons/2026.json").read_text(encoding="utf-8")
    assert "\\u0026" in raw
    assert dumps(json.loads(raw)) == raw


def test_stats_fills_pending(repo_copy):
    changed = run("stats", repo_copy, 2026, TODAY, FakeSession())
    assert changed == ["202611080mia", "202611150clt"]
    page = read(repo_copy, "games/2026/202611150clt.json")
    assert page["sections"]["Información del partido"]["Estado"] == "final"
    assert page["sections"]["Información del partido"]["Gamebook oficial"] == "assets/gamebooks/2026/202611150clt.pdf"
    assert (repo_copy / "assets/gamebooks/2026/202611150clt.pdf").read_bytes() == PDF
    assert read(repo_copy, "games/2026/202611220buf.json")["sections"]["Información del partido"]["Estado"] == "scheduled"
    assert read(repo_copy, "games/2026/202611010mia.json")["sections"]["Información del partido"]["Estado"] == "scheduled"
    rivals = read(repo_copy, "rivals/index.json")
    assert any(g["game_id"] == "202611150clt" for r in rivals["data"]["rivals"] for g in r["latest_games"])
    season = read(repo_copy, "seasons/2026.json")
    assert season["sections"]["Resumen"]["Récord"] == "1-7-0"


def test_stats_idempotent(repo_copy):
    run("stats", repo_copy, 2026, TODAY, FakeSession(), game_id="202611150clt")
    before = snapshot(repo_copy)
    assert run("stats", repo_copy, 2026, TODAY, FakeSession(), game_id="202611150clt") == []
    assert snapshot(repo_copy) == before


def test_does_not_touch_final(repo_copy):
    before = snapshot(repo_copy)
    session = FakeSession()
    assert run("stats", repo_copy, 2026, TODAY, session, game_id="202610250nyj") == []
    assert snapshot(repo_copy) == before
    assert not any(url.endswith("/summary") for url, _ in session.calls)


def test_future_games_ignored(repo_copy):
    assert run("stats", repo_copy, 2026, date(2026, 11, 14), FakeSession()) == ["202611080mia"]


def test_all_failures_raise(repo_copy):
    with pytest.raises(RuntimeError):
        run("stats", repo_copy, 2026, TODAY, FakeSession(), game_id="202611010mia")


def test_stats_without_gamebook_yet(repo_copy):
    run("stats", repo_copy, 2026, TODAY, FakeSession(pdf=False))
    info = read(repo_copy, "games/2026/202611150clt.json")["sections"]["Información del partido"]
    assert "Gamebook oficial" not in info
    assert not (repo_copy / "assets/gamebooks/2026/202611150clt.pdf").exists()


def test_gamebook_mode_only_adds_link(repo_copy):
    run("stats", repo_copy, 2026, TODAY, FakeSession(pdf=False))
    before = read(repo_copy, "games/2026/202611150clt.json")
    assert run("gamebook", repo_copy, 2026, TODAY, FakeSession()) == ["202611080mia", "202611150clt"]
    after = read(repo_copy, "games/2026/202611150clt.json")
    assert after["sections"]["Información del partido"].pop("Gamebook oficial") == "assets/gamebooks/2026/202611150clt.pdf"
    assert after == before
    assert (repo_copy / "assets/gamebooks/2026/202611150clt.pdf").exists()


def test_gamebook_mode_skips_scheduled(repo_copy):
    assert run("gamebook", repo_copy, 2026, TODAY, FakeSession()) == []


def test_gamebook_window(repo_copy):
    run("stats", repo_copy, 2026, TODAY, FakeSession(pdf=False))
    assert run("gamebook", repo_copy, 2026, date(2026, 12, 15), FakeSession()) == []


class NflDownSession(FakeSession):
    def get(self, url, params=None, **kwargs):
        if "nfl.com" in url:
            raise requests.ConnectionError("nfl.com caído")
        return super().get(url, params=params, **kwargs)


def test_nflcom_failure_keeps_espn_stats(repo_copy):
    assert run("stats", repo_copy, 2026, TODAY, NflDownSession(), game_id="202611150clt") == ["202611150clt"]
    info = read(repo_copy, "games/2026/202611150clt.json")["sections"]["Información del partido"]
    assert info["Estado"] == "final" and "Gamebook oficial" not in info
