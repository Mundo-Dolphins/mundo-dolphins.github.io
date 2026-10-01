# GitHub Actions backup of the Raspberry Pi checkers

The Raspberry Pi runs `ivoox-scrapper` by cron and opens the PRs that keep
`data/` up to date. These scripts are a native backup (standard library
Python, no checker binary) used by `.github/workflows/posts.yml` and
`.github/workflows/episodes.yml`, so the website keeps updating if the Pi is
down.

| Script | Source | Output | Grace period |
|---|---|---|---|
| `social.py` | Bluesky RSS of the `SOCIAL_BSKY_PROFILES` accounts, plus oEmbed for the post CID | `data/posts_N.json` | 30 min |
| `episodes.py` | iVoox RSS (`RSS_FEED_URL`) | `data/season_N.json` | 60 min |

- Only items older than the grace period are added, so the Pi (every 5 / 30
  minutes) normally adds them first and the backup finds nothing to do.
- `gojson.py` writes JSON byte-identical to the Go checker, so the files do
  not get reformatted.
- `open_pr.sh` recreates the `backup-*` branch from `main` on every run and
  opens the PR with the `automerge` label. If the Pi already added the items,
  it closes the backup PR.
- Instagram is not covered: its proxy is only reachable on the Pi's network.

Differences from the Pi: Bluesky dates come from the RSS feed, so they have
minute precision instead of milliseconds.

Tests: `python3 -m unittest discover -s scripts/backup`
