#!/usr/bin/env bash
set -euo pipefail

# notify_articles_podcasts.sh
# Detects new articles (content/noticias/*.md), podcasts (data/season_*.json),
# and videos (data/videos.json) added in the last commit and sends them to Telegram.

echo "📋 Checking for new articles, podcasts, and videos in last commit..."

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

TARGET_SHA="${NOTIFY_COMMIT_SHA:-HEAD}"
if ! git rev-parse --verify "$TARGET_SHA" >/dev/null 2>&1; then
  echo "⚠️ Target commit '$TARGET_SHA' not found locally. Falling back to HEAD."
  TARGET_SHA="HEAD"
fi

BASE_SHA="${NOTIFY_BASE_SHA:-${TARGET_SHA}^}"
if ! git rev-parse --verify "$BASE_SHA" >/dev/null 2>&1; then
  echo "⚠️ Base commit '$BASE_SHA' not found. Falling back to HEAD~1."
  BASE_SHA="HEAD~1"
fi

MAX_PODCASTS_RAW="${TELEGRAM_MAX_PODCASTS:-1}"
if [[ "$MAX_PODCASTS_RAW" =~ ^[0-9]+$ ]]; then
  MAX_PODCASTS="$MAX_PODCASTS_RAW"
else
  MAX_PODCASTS=1
fi

echo "🧭 Diff range: ${BASE_SHA}..${TARGET_SHA}"
echo "🎙️ Max podcast notifications to send: ${MAX_PODCASTS}"

LATEST_SEASON_FILE=$(find data -maxdepth 1 -type f -name 'season_*.json' | \
  sed -E 's#^data/season_([0-9]+)\.json$#\1|&#' | \
  sort -t'|' -k1,1n | \
  tail -n 1 | \
  cut -d'|' -f2-)

if [ -n "$LATEST_SEASON_FILE" ]; then
  echo "🗂️ Latest season file for podcast notifications: ${LATEST_SEASON_FILE}"
else
  echo "⚠️ Could not determine latest season file. Podcast detection will be skipped."
fi

# Detect changed files in last commit
# Use raw (unquoted) paths and NUL separation to correctly handle
# filenames with non-ASCII characters (git may escape them otherwise).
# IMPORTANT: Do NOT assign to a variable - it loses NUL bytes. Write directly to file.
TEMP_FILELIST=$(mktemp)
TEMP_NEW_ARTICLE_FILES=$(mktemp)
git -c core.quotepath=false diff --name-only -z "$BASE_SHA" "$TARGET_SHA" 2>/dev/null | \
  tr '\0' '\n' > "$TEMP_FILELIST" || echo "" > "$TEMP_FILELIST"

# Detect only newly added article files (git status A)
git -c core.quotepath=false diff --name-only --diff-filter=A -z "$BASE_SHA" "$TARGET_SHA" 2>/dev/null | \
  tr '\0' '\n' > "$TEMP_NEW_ARTICLE_FILES" || echo "" > "$TEMP_NEW_ARTICLE_FILES"

# Check if file list is empty or has content
if [ ! -s "$TEMP_FILELIST" ]; then
  echo "✅ No files changed in last commit"
  rm -f "$TEMP_FILELIST" "$TEMP_NEW_ARTICLE_FILES"
  exit 0
fi

# Temp files for storing detected items
TEMP_ARTICLES=$(mktemp)
TEMP_PODCASTS=$(mktemp)
TEMP_VIDEOS=$(mktemp)

# Check for newly added articles in content/noticias/
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if [[ "$file" =~ ^content/noticias/.*\.md$ ]] && [ -f "$file" ]; then
    # Extract frontmatter
    TITLE=$(grep -m 1 "^title:" "$file" | sed 's/title: *//;s/"//g;s/'"'"'//g' || echo "")
    SLUG=$(basename "$file" .md)
    
    if [ -n "$TITLE" ]; then
      echo "${TITLE}|${SLUG}" >> "$TEMP_ARTICLES"
    fi
  fi
done < "$TEMP_NEW_ARTICLE_FILES"

# Check for new podcasts in data/season_*.json
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if [[ "$file" =~ ^data/season_.*\.json$ ]] && [ -f "$file" ]; then
    if [ -z "$LATEST_SEASON_FILE" ] || [ "$file" != "$LATEST_SEASON_FILE" ]; then
      continue
    fi

    # Get episodes from current commit
    CURRENT_JSON=$(cat "$file")
    
    # Get episodes from previous commit
    PREVIOUS_JSON=$(git show "${BASE_SHA}:$file" 2>/dev/null || echo "[]")
    
    # Create temp files
    TEMP_PREV=$(mktemp)
    TEMP_CURR=$(mktemp)
    
    # Extract episode URLs to compare (using 'audio' field, not 'AudioUrl')
    echo "$PREVIOUS_JSON" | jq -r '.[].audio // empty' | sort > "$TEMP_PREV"
    echo "$CURRENT_JSON" | jq -r '.[].audio // empty' | sort > "$TEMP_CURR"
    
    # Find new episodes (in current but not in previous)
    NEW_URLS=$(comm -13 "$TEMP_PREV" "$TEMP_CURR")
    
    if [ -n "$NEW_URLS" ]; then
      # Get full episode objects for new URLs
      # Use a temporary file instead of here-string to avoid file descriptor issues
      TEMP_URLS=$(mktemp)
      printf '%s\n' "$NEW_URLS" > "$TEMP_URLS"
      
      while IFS= read -r url; do
        [ -z "$url" ] && continue
        # Get title from episode and generate slug
        TITLE=$(printf '%s' "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.audio == $url) | .title')
        LINK=$(printf '%s' "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.audio == $url) | .link // empty' | head -n 1)
        
        if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
          # Generate slug from title using Python
          SLUG=$(printf '%s' "$LINK" | sed -nE 's#https?://(www\.)?ivoox\.com/([^/?#]+)-audios-mp3_rf_[0-9]+_[0-9]+\.html#\2#p')
          if [ -z "$SLUG" ]; then
            SLUG=$(printf '%s' "$TITLE" | python3 -c 'import sys,unicodedata,re; t=sys.stdin.read(); s=unicodedata.normalize("NFKD", t); s=s.encode("ascii","ignore").decode("ascii"); s=re.sub(r"[^a-zA-Z0-9]+","-", s).strip("-").lower(); print(s)')
          fi
          PUBLISHED=$(printf '%s' "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.audio == $url) | .dateAndTime // empty' | head -n 1)
          EPISODE_TS=$(printf '%s' "$PUBLISHED" | python3 -c 'import sys,datetime
s=(sys.stdin.read() or "").strip()
if not s:
  print(0)
  raise SystemExit(0)
if s.endswith("Z"):
  s=s[:-1]+"+00:00"
try:
  dt=datetime.datetime.fromisoformat(s)
except ValueError:
  print(0)
  raise SystemExit(0)
if dt.tzinfo is None:
  dt=dt.replace(tzinfo=datetime.timezone.utc)
print(int(dt.timestamp()*1000))')
          
          if [ -n "$SLUG" ]; then
            echo "${TITLE}|${SLUG}|${EPISODE_TS}" >> "$TEMP_PODCASTS"
          fi
        fi
      done < "$TEMP_URLS"
      
      rm -f "$TEMP_URLS"
    fi
    
    rm -f "$TEMP_PREV" "$TEMP_CURR"
  fi
done < "$TEMP_FILELIST"

# Check for new videos in data/videos.json (non-podcast)
while IFS= read -r file; do
  [ -z "$file" ] && continue
  if [[ "$file" == "data/videos.json" ]] && [ -f "$file" ]; then
    CURRENT_JSON=$(cat "$file")
    PREVIOUS_JSON=$(git show "${BASE_SHA}:$file" 2>/dev/null || echo "[]")

    TEMP_PREV=$(mktemp)
    TEMP_CURR=$(mktemp)

    echo "$PREVIOUS_JSON" | jq -r '.[] | select(.isPodcast == false) | .url // empty' | sort > "$TEMP_PREV"
    echo "$CURRENT_JSON" | jq -r '.[] | select(.isPodcast == false) | .url // empty' | sort > "$TEMP_CURR"

    NEW_URLS=$(comm -13 "$TEMP_PREV" "$TEMP_CURR")

    if [ -n "$NEW_URLS" ]; then
      # Use a temporary file instead of here-string to avoid file descriptor issues
      TEMP_URLS=$(mktemp)
      printf '%s\n' "$NEW_URLS" > "$TEMP_URLS"
      
      while IFS= read -r url; do
        [ -z "$url" ] && continue
        TITLE=$(printf '%s' "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.url == $url) | .title')
        if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
          SLUG=$(printf '%s' "$TITLE" | python3 -c 'import sys,unicodedata,re; t=sys.stdin.read(); s=unicodedata.normalize("NFKD", t); s=s.encode("ascii","ignore").decode("ascii"); s=re.sub(r"[^a-zA-Z0-9]+","-", s).strip("-").lower(); print(s)')
          if [ -n "$SLUG" ]; then
            # Avoid duplicates if content/videos was also committed
            if ! grep -Fq "|${SLUG}" "$TEMP_VIDEOS" 2>/dev/null; then
              echo "${TITLE}|${SLUG}" >> "$TEMP_VIDEOS"
            fi
          fi
        fi
      done < "$TEMP_URLS"
      
      rm -f "$TEMP_URLS"
    fi

    rm -f "$TEMP_PREV" "$TEMP_CURR"
  fi
done < "$TEMP_FILELIST"

# Clean up temporary file list
rm -f "$TEMP_FILELIST" "$TEMP_NEW_ARTICLE_FILES"

# Count total items
ARTICLES_COUNT=$(wc -l < "$TEMP_ARTICLES" | tr -d ' ')
PODCASTS_COUNT=$(wc -l < "$TEMP_PODCASTS" | tr -d ' ')
VIDEOS_COUNT=$(wc -l < "$TEMP_VIDEOS" | tr -d ' ')
TOTAL_ITEMS=$((ARTICLES_COUNT + PODCASTS_COUNT + VIDEOS_COUNT))

if [ "$TOTAL_ITEMS" -eq 0 ]; then
  echo "✅ No new articles, podcasts, or videos found"
  rm -f "$TEMP_ARTICLES" "$TEMP_PODCASTS" "$TEMP_VIDEOS"
  exit 0
fi

echo "📊 Found: ${ARTICLES_COUNT} articles, ${PODCASTS_COUNT} podcasts, ${VIDEOS_COUNT} videos"

# Send articles to Telegram
if [ "$ARTICLES_COUNT" -gt 0 ]; then
  echo "📰 Sending ${ARTICLES_COUNT} articles to Telegram..."
  while IFS='|' read -r title slug; do
    MESSAGE="📰 Nuevo artículo publicado: ${title}

🔗 https://mundodolphins.es/noticias/${slug}/"
    
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      SEND_RESULT=$(send_to_telegram "$MESSAGE")
      
      if [ "$SEND_RESULT" = "success" ]; then
        echo "✅ Sent article: ${title:0:50}..."
        sleep 2
      else
        echo "❌ Error sending article: ${title:0:50}..."
        echo "Response: $SEND_RESULT"
      fi
    else
      echo "⚠️ DRY RUN: Article - ${title:0:50}..."
    fi
  done < "$TEMP_ARTICLES"
fi

# Send podcasts to Telegram
if [ "$PODCASTS_COUNT" -gt 0 ]; then
  echo "🎙️ Detected ${PODCASTS_COUNT} podcasts. Sending up to ${MAX_PODCASTS} most recent..."
  TEMP_PODCASTS_SORTED=$(mktemp)
  sort -t'|' -k3,3nr "$TEMP_PODCASTS" | head -n "$MAX_PODCASTS" > "$TEMP_PODCASTS_SORTED"
  SENT_PODCASTS_COUNT=$(wc -l < "$TEMP_PODCASTS_SORTED" | tr -d ' ')

  while IFS='|' read -r title slug episode_ts; do
    PODCAST_URL="https://mundodolphins.es/podcast/${slug}/"

    MESSAGE="🎙️ Nuevo capítulo del podcast publicado: ${title}

🔗 ${PODCAST_URL}"
    
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      SEND_RESULT=$(send_to_telegram "$MESSAGE")
      
      if [ "$SEND_RESULT" = "success" ]; then
        echo "✅ Sent podcast: ${title:0:50}..."
        sleep 2
      else
        echo "❌ Error sending podcast: ${title:0:50}..."
        echo "Response: $SEND_RESULT"
      fi
    else
      echo "⚠️ DRY RUN: Podcast - ${title:0:50}..."
    fi
  done < "$TEMP_PODCASTS_SORTED"

  echo "✅ Podcasts sent: ${SENT_PODCASTS_COUNT} (detected: ${PODCASTS_COUNT})"
  rm -f "$TEMP_PODCASTS_SORTED"
fi

# Send videos to Telegram
if [ "$VIDEOS_COUNT" -gt 0 ]; then
  echo "🎥 Sending ${VIDEOS_COUNT} videos to Telegram..."
  while IFS='|' read -r title slug; do
    MESSAGE="🎥 Nuevo vídeo publicado: ${title}

🔗 https://mundodolphins.es/videos/${slug}/"

    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      SEND_RESULT=$(send_to_telegram "$MESSAGE")

      if [ "$SEND_RESULT" = "success" ]; then
        echo "✅ Sent video: ${title:0:50}..."
        sleep 2
      else
        echo "❌ Error sending video: ${title:0:50}..."
        echo "Response: $SEND_RESULT"
      fi
    else
      echo "⚠️ DRY RUN: Video - ${title:0:50}..."
    fi
  done < "$TEMP_VIDEOS"
fi

# Clean up
rm -f "$TEMP_ARTICLES" "$TEMP_PODCASTS" "$TEMP_VIDEOS"

echo "✅ Process completed"
