#!/usr/bin/env python3
"""GitHub Actions backup of ivoox-scrapper's `checker rss`.

The Raspberry Pi adds new podcast episodes from the iVoox feed to
data/season_N.json. This script does the same so the website keeps updating
if the Pi is down. It only adds episodes older than a grace period, giving
the Pi time to add them first, and only episodes newer than the latest one
already stored (like the checker's default --since).
"""

import argparse
import email.utils
import glob
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gojson  # noqa: E402
from social import fetch  # noqa: E402

DEFAULT_FEED_URL = "https://feeds.ivoox.com/feed_fg_f1601076_filtro_1.xml"
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
DATE_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# Same NFL new league year dates as ivoox-scrapper's storage package: an
# episode belongs to the season whose new year started before it.
_NEW_YORK = ZoneInfo("America/New_York")
NFL_NEW_YEAR = {
    9: datetime(2026, 3, 11, 16, tzinfo=_NEW_YORK),
    8: datetime(2025, 3, 12, 16, tzinfo=_NEW_YORK),
    7: datetime(2024, 3, 13, 16, tzinfo=_NEW_YORK),
    6: datetime(2023, 3, 15, 16, tzinfo=_NEW_YORK),
    5: datetime(2022, 3, 16, 16, tzinfo=_NEW_YORK),
    4: datetime(2021, 3, 10, 16, tzinfo=_NEW_YORK),
    3: datetime(2020, 3, 18, 16, tzinfo=_NEW_YORK),
    2: datetime(2019, 3, 13, 16, tzinfo=_NEW_YORK),
    1: datetime(2018, 3, 14, 16, tzinfo=_NEW_YORK),
}

# Go's XML parser keeps "\r\n" inside CDATA; Python's normalizes it to "\n".
# Protect carriage returns so descriptions match the checker's output.
_CR_PLACEHOLDER = ""


def season_for(published: datetime) -> int:
    started = [season for season, date in NFL_NEW_YEAR.items() if published > date]
    return max(started) if started else 1


def _text(element, path: str) -> str:
    return (element.findtext(path) or "").replace(_CR_PLACEHOLDER, "\r")


def parse_feed(xml_bytes: bytes) -> list:
    text = xml_bytes.decode("utf-8").replace("\r", _CR_PLACEHOLDER)
    channel = ET.fromstring(text).find("channel")
    episodes = []
    for item in channel.findall("item") if channel is not None else []:
        pub_date = item.findtext("pubDate")
        enclosure = item.find("enclosure")
        if not pub_date or enclosure is None or not enclosure.get("url"):
            continue
        image = item.find(ITUNES + "image")
        published = email.utils.parsedate_to_datetime(pub_date).astimezone(timezone.utc)
        episodes.append({
            "imgMain": image.get("href", "") if image is not None else "",
            "title": _text(item, "title"),
            "description": _text(item, "description"),
            "dateAndTime": published.strftime(DATE_FORMAT),
            "link": _text(item, "link"),
            "audio": enclosure.get("url"),
            "len": _text(item, ITUNES + "duration"),
        })
    return episodes


def _published(episode: dict) -> datetime:
    return datetime.strptime(episode["dateAndTime"], DATE_FORMAT).replace(tzinfo=timezone.utc)


def load_seasons(data_dir: str) -> dict:
    seasons = {}
    for path in glob.glob(os.path.join(data_dir, "season_*.json")):
        match = re.search(r"season_(\d+)\.json$", path)
        if match:
            seasons[int(match.group(1))] = gojson.read(path)
    return seasons


def merge(seasons: dict, feed_episodes: list, now: datetime, grace: timedelta) -> dict:
    """Return the seasons that changed, with the new episodes merged by link."""
    stored = [episode for episodes in seasons.values() for episode in episodes]
    latest = max((_published(e) for e in stored), default=None)
    known = {episode["link"] for episode in stored}

    changed = {}
    for episode in feed_episodes:
        published = _published(episode)
        if episode["link"] in known or (latest and published <= latest) or now - published < grace:
            continue
        season = season_for(published)
        merged = changed.setdefault(season, list(seasons.get(season, [])))
        merged.append(episode)
        known.add(episode["link"])

    for episodes in changed.values():
        episodes.sort(key=_published, reverse=True)
    return changed


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default="data")
    parser.add_argument("--feed", default=os.getenv("RSS_FEED_URL", DEFAULT_FEED_URL))
    parser.add_argument("--grace-minutes", type=int, default=int(os.getenv("BACKUP_GRACE_MINUTES", "60")))
    args = parser.parse_args(argv)

    changed = merge(load_seasons(args.data), parse_feed(fetch(args.feed)),
                    datetime.now(timezone.utc), timedelta(minutes=args.grace_minutes))
    if not changed:
        print("no new podcast episodes")
        return 0
    for season, episodes in changed.items():
        gojson.write(os.path.join(args.data, f"season_{season}.json"), episodes)
        print(f"season {season}: {len(episodes)} episodes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
