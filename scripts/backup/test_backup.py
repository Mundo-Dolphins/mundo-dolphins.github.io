"""Offline tests for the GitHub Actions backup scripts.

Run with: python3 -m unittest discover -s scripts/backup
"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import episodes  # noqa: E402
import gojson  # noqa: E402
import social  # noqa: E402

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)

BLUESKY_RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>@mundodolphins.es - Mundo Dolphins</title>
<link>https://bsky.app/profile/mundodolphins.es</link>
<item><link>https://bsky.app/profile/mundodolphins.es/post/new</link>
<description>Nuevo &lt;post&gt; &amp; m\xc3\xa1s</description>
<pubDate>01 Oct 2026 10:00 +0000</pubDate>
<guid>at://did:plc:abc/app.bsky.feed.post/new</guid></item>
<item><link>https://bsky.app/profile/mundodolphins.es/post/recent</link>
<description>Too recent</description>
<pubDate>01 Oct 2026 11:50 +0000</pubDate>
<guid>at://did:plc:abc/app.bsky.feed.post/recent</guid></item>
<item><link>https://bsky.app/profile/mundodolphins.es/post/known</link>
<description>Known</description>
<pubDate>30 Sep 2026 10:00 +0000</pubDate>
<guid>at://did:plc:abc/app.bsky.feed.post/known</guid></item>
</channel></rss>"""

IVOOX_RSS = (
    b'<?xml version="1.0" encoding="UTF-8"?>\n'
    b'<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>\n'
    b"<item><title>Nuevo episodio</title><link>https://www.ivoox.com/new.html</link>"
    b'<enclosure url="https://www.ivoox.com/new.mp3" type="audio/mpeg"/>'
    b"<description><![CDATA[Linea 1\r\n\r\nLinea 2]]></description>"
    b"<pubDate>Wed, 30 Sep 2026 19:00:00 +0200</pubDate>"
    b"<itunes:duration>01:10:00</itunes:duration>"
    b'<itunes:image href="https://static-1.ivoox.com/img.jpg"/></item>\n'
    b"<item><title>Sin audio</title><link>https://www.ivoox.com/noaudio.html</link>"
    b"<pubDate>Wed, 30 Sep 2026 19:00:00 +0200</pubDate></item>\n"
    b"</channel></rss>"
)


class GoJSONTest(unittest.TestCase):
    def test_matches_go_encoder(self):
        self.assertEqual(gojson.dumps({"a": "<b> & ñ"}), '{\n  "a": "\\u003cb\\u003e \\u0026 ñ"\n}\n')

    def test_time_format(self):
        self.assertEqual(gojson.format_time(datetime(2026, 9, 29, 7, 15, 53, 830000, timezone.utc)), "2026-09-29T07:15:53.83Z")
        self.assertEqual(gojson.format_time(datetime(2026, 9, 29, 7, 15, tzinfo=timezone.utc)), "2026-09-29T07:15:00Z")


class SocialTest(unittest.TestCase):
    def fetcher(self, url):
        if url.endswith("/rss"):
            return BLUESKY_RSS
        return json.dumps({"html": '<blockquote data-bluesky-cid="bafycid">x</blockquote>'}).encode()

    def test_new_posts_skips_known_and_recent(self):
        known = {"https://bsky.app/profile/mundodolphins.es/post/known"}
        added = social.new_posts(["mundodolphins.es"], known, NOW, timedelta(minutes=30), self.fetcher)
        self.assertEqual([p["id"] for p in added], ["https://bsky.app/profile/mundodolphins.es/post/new"])
        post = added[0]
        self.assertEqual(post["PublishedOn"], "2026-10-01T10:00:00Z")
        self.assertEqual(post["BlueSkyPost"], {
            "BskyURI": "at://did:plc:abc/app.bsky.feed.post/new",
            "BskyCID": "bafycid",
            "Description": "Nuevo <post> & más",
            "BskyProfileURI": "https://bsky.app/profile/mundodolphins.es",
            "BskyProfile": "Mundo Dolphins",
            "BskyPost": "https://bsky.app/profile/mundodolphins.es/post/new",
        })

    def test_unreadable_profile_does_not_stop_others(self):
        def failing(url):
            if "broken" in url:
                raise OSError("down")
            return self.fetcher(url)
        added = social.new_posts(["broken.example", "mundodolphins.es"], set(), NOW, timedelta(minutes=30), failing)
        self.assertEqual(len(added), 2)

    def test_save_posts_sorts_and_chunks(self):
        posts = [{"id": f"id{i:03d}", "PublishedOn": gojson.format_time(NOW - timedelta(minutes=i))} for i in range(120)]
        with tempfile.TemporaryDirectory() as data:
            gojson.write(os.path.join(data, "posts_9.json"), [])
            social.save_posts(list(reversed(posts)), data)
            self.assertEqual(sorted(os.listdir(data)), ["posts_1.json", "posts_2.json", "posts_3.json"])
            first = gojson.read(os.path.join(data, "posts_1.json"))
            self.assertEqual(len(first), 50)
            self.assertEqual(first[0]["id"], "id000")


class EpisodesTest(unittest.TestCase):
    def test_parse_feed_keeps_crlf_and_skips_without_audio(self):
        parsed = episodes.parse_feed(IVOOX_RSS)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0], {
            "imgMain": "https://static-1.ivoox.com/img.jpg",
            "title": "Nuevo episodio",
            "description": "Linea 1\r\n\r\nLinea 2",
            "dateAndTime": "2026-09-30T17:00:00Z",
            "link": "https://www.ivoox.com/new.html",
            "audio": "https://www.ivoox.com/new.mp3",
            "len": "01:10:00",
        })

    def test_season_rule(self):
        # 16:00 in New York on 2026-03-11 is 20:00 UTC (daylight saving time).
        self.assertEqual(episodes.season_for(datetime(2026, 3, 11, 19, 59, tzinfo=timezone.utc)), 8)
        self.assertEqual(episodes.season_for(datetime(2026, 3, 11, 20, 1, tzinfo=timezone.utc)), 9)

    def test_merge_only_adds_newer_episodes_after_grace(self):
        feed = episodes.parse_feed(IVOOX_RSS)
        stored = {9: [{"link": "https://www.ivoox.com/old.html", "dateAndTime": "2026-09-24T15:26:12Z"}]}
        changed = episodes.merge(stored, feed, NOW, timedelta(minutes=60))
        self.assertEqual([e["link"] for e in changed[9]], ["https://www.ivoox.com/new.html", "https://www.ivoox.com/old.html"])

        self.assertEqual(episodes.merge(stored, feed, NOW, timedelta(days=2)), {})
        newer = {9: [{"link": "https://www.ivoox.com/x.html", "dateAndTime": "2026-10-01T00:00:00Z"}]}
        self.assertEqual(episodes.merge(newer, feed, NOW, timedelta(minutes=60)), {})


if __name__ == "__main__":
    unittest.main()
