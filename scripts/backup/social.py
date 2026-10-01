#!/usr/bin/env python3
"""GitHub Actions backup of ivoox-scrapper's `checker social`.

The Raspberry Pi adds new Bluesky posts to data/posts_N.json every five
minutes. This script does the same from the public Bluesky RSS feeds so the
website keeps updating if the Pi is down. It only adds posts older than a
grace period, giving the Pi time to add them first.

Instagram is not covered: its proxy is only reachable on the Pi's network.
"""

import argparse
import email.utils
import glob
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gojson  # noqa: E402

# Same profiles as SOCIAL_BSKY_PROFILES on the Raspberry Pi.
DEFAULT_PROFILES = [
    "hugomanero1.mundodolphins.es",
    "mundodolphins.es",
    "undolfan.mundodolphins.es",
    "santoscr.mundodolphins.es",
]
POSTS_PER_FILE = 50
BLUESKY = 0
USER_AGENT = "MundoDolphinsBackup/1.0 (+https://mundodolphins.es)"

_CID_RE = re.compile(r'data-bluesky-cid="([^"]+)"')


def fetch(url: str, attempts: int = 3) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except Exception:
            if attempt == attempts:
                raise
            time.sleep(2 * attempt)
    raise AssertionError("unreachable")


def load_posts(data_dir: str) -> list:
    posts = []
    for path in glob.glob(os.path.join(data_dir, "posts_*.json")):
        posts.extend(gojson.read(path))
    return posts


def save_posts(posts: list, data_dir: str) -> None:
    """Sort and chunk like ivoox-scrapper: newest first, 50 posts per file."""
    posts = sorted(posts, key=lambda p: p["id"])
    posts.sort(key=lambda p: gojson.parse_time(p["PublishedOn"]), reverse=True)
    for path in glob.glob(os.path.join(data_dir, "posts_*.json")):
        os.remove(path)
    for start in range(0, len(posts), POSTS_PER_FILE):
        number = start // POSTS_PER_FILE + 1
        gojson.write(os.path.join(data_dir, f"posts_{number}.json"), posts[start:start + POSTS_PER_FILE])


def display_name(channel_title: str, handle: str) -> str:
    """The feed title is "@handle - Display Name"."""
    prefix = f"@{handle} - "
    if channel_title.startswith(prefix) and channel_title[len(prefix):].strip():
        return channel_title[len(prefix):].strip()
    return handle


def parse_feed(xml_bytes: bytes, handle: str) -> list:
    channel = ET.fromstring(xml_bytes).find("channel")
    if channel is None:
        return []
    name = display_name(channel.findtext("title", ""), handle)
    items = []
    for item in channel.findall("item"):
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or "").strip()
        pub_date = item.findtext("pubDate")
        if not link or not guid or not pub_date:
            continue
        items.append({
            "link": link,
            "uri": guid,
            "description": item.findtext("description") or "",
            "published": email.utils.parsedate_to_datetime(pub_date).astimezone(timezone.utc),
            "profile": name,
        })
    return items


def cid_from_oembed(html: str) -> str:
    match = _CID_RE.search(html)
    return match.group(1) if match else ""


def build_post(item: dict, handle: str, cid: str) -> dict:
    """Same shape and field values as ivoox-scrapper's Bluesky posts."""
    return {
        "id": item["link"],
        "stype": BLUESKY,
        "PublishedOn": gojson.format_time(item["published"]),
        "BlueSkyPost": {
            "BskyURI": item["uri"],
            "BskyCID": cid,
            "Description": item["description"],
            "BskyProfileURI": f"https://bsky.app/profile/{handle}",
            "BskyProfile": item["profile"],
            "BskyPost": item["link"],
        },
        "InstagramPost": {"URL": "", "Description": "", "SvgPath": ""},
    }


def new_posts(profiles, known_ids, now, grace, fetcher=fetch) -> list:
    added = []
    for handle in profiles:
        try:
            items = parse_feed(fetcher(f"https://bsky.app/profile/{handle}/rss"), handle)
        except Exception as error:  # keep going with the other profiles
            print(f"warning: cannot read {handle} RSS: {error}", file=sys.stderr)
            continue
        for item in items:
            if item["link"] in known_ids or now - item["published"] < grace:
                continue
            try:
                oembed = json.loads(fetcher("https://embed.bsky.app/oembed?url=" + urllib.parse.quote(item["link"], safe="")))
            except Exception as error:
                print(f"warning: cannot read oEmbed for {item['link']}: {error}", file=sys.stderr)
                continue
            cid = cid_from_oembed(oembed.get("html", ""))
            if not cid:
                print(f"warning: no CID for {item['link']}", file=sys.stderr)
                continue
            known_ids.add(item["link"])
            added.append(build_post(item, handle, cid))
    return added


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", default="data")
    parser.add_argument("--grace-minutes", type=int, default=int(os.getenv("BACKUP_GRACE_MINUTES", "30")))
    args = parser.parse_args(argv)

    profiles = [p.strip() for p in os.getenv("BSKY_PROFILES", ",".join(DEFAULT_PROFILES)).split(",") if p.strip()]
    posts = load_posts(args.data)
    known = {post["id"] for post in posts}
    added = new_posts(profiles, known, datetime.now(timezone.utc), timedelta(minutes=args.grace_minutes))
    if not added:
        print("no new social posts")
        return 0
    save_posts(posts + added, args.data)
    print(f"added {len(added)} social posts: " + ", ".join(post["id"] for post in added))
    return 0


if __name__ == "__main__":
    sys.exit(main())
