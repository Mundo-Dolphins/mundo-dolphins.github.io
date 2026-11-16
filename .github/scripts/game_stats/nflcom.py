"""Localiza y descarga el gamebook oficial (PDF) desde la página del partido en NFL.com."""

import re
from collections import Counter
from pathlib import Path

from .espn import ScheduledGame

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0 Safari/537.36"
)
SEASON_TYPES = {1: "pre", 2: "reg", 3: "post"}
MIN_PDF_BYTES = 10 * 1024
TIMEOUT = 60

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_GAME_ID = re.compile(rf'"gameI[dD]":"({_UUID})"')
_CANONICAL = re.compile(r'<link rel="canonical" href="([^"]+)"')


def game_url(game: ScheduledGame) -> str:
    week = game.week
    if game.season_type == 1:
        # ESPN cuenta el Hall of Fame Game como semana 1 de pretemporada; NFL.com no.
        week -= 1
    return (
        f"https://www.nfl.com/games/{game.away.nfl_slug}-at-{game.home.nfl_slug}"
        f"-{game.season}-{SEASON_TYPES[game.season_type]}-{week}"
    )


def find_gamebook_url(html: str, page_url: str) -> str | None:
    """Devuelve el gamebook del partido de la página, nunca el de otro partido.

    La página trae también los marcadores de toda una jornada (no siempre la suya), cada uno con
    su `gameBookUrl`. El partido propio es el gameId que más se repite (series, analítica,
    vídeos...) y su PDF se llama `<gameId>.pdf`: se busca en el enlace "Download Game Book" y,
    si no está, en los marcadores.
    """
    canonical = _CANONICAL.search(html)
    if not canonical or canonical[1].rstrip("/") != page_url.rstrip("/"):
        return None
    payload = html.replace('\\"', '"')
    counts = Counter(_GAME_ID.findall(payload))
    if not counts:
        return None
    game_id = counts.most_common(1)[0][0]
    pdf = rf"https://static\.www\.nfl\.com/[^\"\\]*/gamecenter/{game_id}\.pdf"
    for pattern in (rf'"headline":"Download Game Book \(PDF\)","href":"({pdf})"', rf'"gameBookUrl":"({pdf})"'):
        match = re.search(pattern, payload)
        if match:
            return match[1]
    return None


def fetch_page(url: str, session) -> str | None:
    response = session.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    if response.status_code != 200:
        return None
    return response.text


def download_gamebook(url: str, dest: Path, session) -> bool:
    response = session.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    content = response.content
    if response.status_code != 200 or not content.startswith(b"%PDF") or len(content) < MIN_PDF_BYTES:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(content)
    return True
