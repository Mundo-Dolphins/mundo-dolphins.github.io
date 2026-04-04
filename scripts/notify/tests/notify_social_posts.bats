#!/usr/bin/env bats
# Tests for scripts/notify/notify_social_posts.sh
#
# Covers:
# 1. Valid cache exists -> only posts newer than the cached timestamp are sent
# 2. Cache missing -> only posts from the last 24 hours are considered
# 3. Cache invalid -> only posts from the last 24 hours are considered
# 4. Posts older than 24 hours are never sent during fallback
# 5. After successful sending, cache is updated to the newest sent post timestamp
# 6. No duplicate reposting on the next workflow run
# 7. If no posts are sent, the cache is not incorrectly advanced

SCRIPT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)/notify_social_posts.sh"
DATA_DIR=""
STATE_DIR=""

# --- helpers -----------------------------------------------------------------

setup() {
  # Temporary working directory isolated per test
  TEST_DIR="$(mktemp -d)"
  DATA_DIR="${TEST_DIR}/data"
  STATE_DIR="${TEST_DIR}/state"
  mkdir -p "$DATA_DIR" "$STATE_DIR"

  # Export variables consumed by the script
  export SOCIAL_NOTIFY_STATE_DIR="$STATE_DIR"
  # Unset real Telegram credentials so every run is a dry-run
  unset TELEGRAM_BOT_TOKEN
  unset TELEGRAM_CHAT_ID

  # Override 'find data ...' by making the script run from TEST_DIR
  cd "$TEST_DIR"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# Write a minimal posts_1.json file with the given posts array (JSON string)
write_posts_file() {
  printf '%s\n' "$1" > "${DATA_DIR}/posts_1.json"
}

# Build a single post JSON object
# Usage: make_post <url> <published_on> [description]
make_post() {
  local url="$1" published_on="$2" description="${3:-Test post}"
  printf '{
    "stype": 0,
    "PublishedOn": "%s",
    "BlueSkyPost": {
      "Description": "%s",
      "BskyPost": "%s",
      "BskyProfileURI": "https://bsky.app/profile/test",
      "BskyProfile": "test"
    }
  }' "$published_on" "$description" "$url"
}

# Timestamp helpers
now_iso()            { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
hours_ago_iso() {
  local h="$1"
  date -u -d "${h} hours ago" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
    || date -u -v-"${h}H" '+%Y-%m-%dT%H:%M:%SZ'
}

# --- tests -------------------------------------------------------------------

# 1. Valid cache: only posts AFTER the cached timestamp are selected
@test "valid cache: only posts newer than cached timestamp are sent" {
  CACHE_TS=$(hours_ago_iso 2)      # cache = 2 hours ago
  POST_OLD_TS=$(hours_ago_iso 3)   # older than cache -> must NOT be sent
  POST_NEW_TS=$(hours_ago_iso 1)   # newer than cache -> must be sent

  echo "$CACHE_TS" > "${STATE_DIR}/last-sent-date.txt"

  write_posts_file "$(printf '[%s,%s]' \
    "$(make_post 'https://bsky.app/post/old' "$POST_OLD_TS" 'Old post')" \
    "$(make_post 'https://bsky.app/post/new' "$POST_NEW_TS" 'New post')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" == *"Cache hit"* ]]
  [[ "$output" == *"DRY RUN: New post"* ]]
  [[ "$output" != *"DRY RUN: Old post"* ]]
  [[ "$output" == *"Posts sent: 1"* ]]
}

# 2. Cache missing: only posts from the last 24 hours are considered
@test "cache missing: only posts from last 24 hours are sent" {
  POST_RECENT_TS=$(hours_ago_iso 1)   # within 24h -> must be sent
  POST_OLD_TS=$(hours_ago_iso 30)     # older than 24h -> must NOT be sent

  # No cache file created

  write_posts_file "$(printf '[%s,%s]' \
    "$(make_post 'https://bsky.app/post/recent' "$POST_RECENT_TS" 'Recent post')" \
    "$(make_post 'https://bsky.app/post/old30h' "$POST_OLD_TS" 'Old 30h post')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" == *"Cache miss"* ]]
  [[ "$output" == *"DRY RUN: Recent post"* ]]
  [[ "$output" != *"DRY RUN: Old 30h post"* ]]
}

# 3. Cache invalid: malformed content falls back to 24-hour window
@test "cache invalid: malformed cache falls back to 24-hour window" {
  echo "NOT_A_DATE" > "${STATE_DIR}/last-sent-date.txt"

  POST_RECENT_TS=$(hours_ago_iso 1)
  POST_OLD_TS=$(hours_ago_iso 30)

  write_posts_file "$(printf '[%s,%s]' \
    "$(make_post 'https://bsky.app/post/recent2' "$POST_RECENT_TS" 'Recent post2')" \
    "$(make_post 'https://bsky.app/post/old30h2' "$POST_OLD_TS" 'Old 30h post2')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" == *"Cache invalid"* ]]
  [[ "$output" == *"DRY RUN: Recent post2"* ]]
  [[ "$output" != *"DRY RUN: Old 30h post2"* ]]
}

# 4. 24-hour safeguard: posts older than 24h are NEVER sent during fallback
@test "24h safeguard: posts older than 24 hours are never sent on fallback" {
  POST_25H_TS=$(hours_ago_iso 25)
  POST_48H_TS=$(hours_ago_iso 48)

  # No cache file created (cache miss -> 24h fallback)

  write_posts_file "$(printf '[%s,%s]' \
    "$(make_post 'https://bsky.app/post/25h' "$POST_25H_TS" '25h old post')" \
    "$(make_post 'https://bsky.app/post/48h' "$POST_48H_TS" '48h old post')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" != *"DRY RUN: 25h old post"* ]]
  [[ "$output" != *"DRY RUN: 48h old post"* ]]
  # Should report no new posts found
  [[ "$output" == *"No new posts found"* ]]
}

# 5. Cache update: after successful sending, cache is updated to newest sent post timestamp
@test "cache is updated to newest sent post timestamp after successful sending" {
  CACHE_TS=$(hours_ago_iso 5)
  POST1_TS=$(hours_ago_iso 3)
  POST2_TS=$(hours_ago_iso 1)  # newest

  echo "$CACHE_TS" > "${STATE_DIR}/last-sent-date.txt"

  write_posts_file "$(printf '[%s,%s]' \
    "$(make_post 'https://bsky.app/post/p1' "$POST1_TS" 'Post one')" \
    "$(make_post 'https://bsky.app/post/p2' "$POST2_TS" 'Post two')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" == *"Cache updated:"* ]]

  # Cache file must exist and contain the newest post's timestamp
  [ -f "${STATE_DIR}/last-sent-date.txt" ]
  SAVED_TS=$(cat "${STATE_DIR}/last-sent-date.txt")
  [ "$SAVED_TS" = "$POST2_TS" ]
}

# 6. No duplicate reposting on the next run
@test "no duplicate reposting on the next workflow run" {
  POST_TS=$(hours_ago_iso 1)

  # First run: no cache
  write_posts_file "$(printf '[%s]' \
    "$(make_post 'https://bsky.app/post/unique' "$POST_TS" 'Unique post')")"

  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN: Unique post"* ]]

  # Second run: cache now holds the timestamp of the post just sent
  SAVED_TS=$(cat "${STATE_DIR}/last-sent-date.txt")
  [ "$SAVED_TS" = "$POST_TS" ]

  run bash "$SCRIPT"
  [ "$status" -eq 0 ]
  echo "output second run: $output"
  [[ "$output" != *"DRY RUN: Unique post"* ]]
  [[ "$output" == *"No new posts found"* ]]
}

# 7. No posts sent -> cache must not be advanced
@test "if no posts are sent the cache is not updated" {
  CACHE_TS=$(hours_ago_iso 1)
  echo "$CACHE_TS" > "${STATE_DIR}/last-sent-date.txt"

  # All posts are older than cache timestamp -> nothing to send
  POST_OLD_TS=$(hours_ago_iso 3)
  write_posts_file "$(printf '[%s]' \
    "$(make_post 'https://bsky.app/post/stale' "$POST_OLD_TS" 'Stale post')")"

  run bash "$SCRIPT"

  [ "$status" -eq 0 ]
  echo "output: $output"
  [[ "$output" == *"No new posts found"* ]]

  # Cache must remain unchanged
  SAVED_TS=$(cat "${STATE_DIR}/last-sent-date.txt")
  [ "$SAVED_TS" = "$CACHE_TS" ]
}
