#!/usr/bin/env bash
set -euo pipefail

# notify_articles_podcasts.sh
# Detects new articles (content/noticias/*.md) and podcasts (data/season_*.json)
# added in the last commit and sends them to Telegram

echo "📋 Checking for new articles and podcasts in last commit..."

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

# Detect changed files in last commit
CHANGED_FILES=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  echo "✅ No files changed in last commit"
  exit 0
fi

# Temp files for storing detected items
TEMP_ARTICLES=$(mktemp)
TEMP_PODCASTS=$(mktemp)

# Check for new articles in content/noticias/
while IFS= read -r file; do
  if [[ "$file" =~ ^content/noticias/.*\.md$ ]] && [ -f "$file" ]; then
    # Extract frontmatter
    TITLE=$(grep -m 1 "^title:" "$file" | sed 's/title: *//;s/"//g;s/'"'"'//g' || echo "")
    SLUG=$(basename "$file" .md)
    
    if [ -n "$TITLE" ]; then
      echo "${TITLE}|${SLUG}" >> "$TEMP_ARTICLES"
    fi
  fi
done <<< "$CHANGED_FILES"

# Check for new podcasts in data/season_*.json
while IFS= read -r file; do
  if [[ "$file" =~ ^data/season_.*\.json$ ]] && [ -f "$file" ]; then
    # Get episodes from current commit
    CURRENT_JSON=$(cat "$file")
    
    # Get episodes from previous commit
    PREVIOUS_JSON=$(git show HEAD~1:"$file" 2>/dev/null || echo "[]")
    
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
      while IFS= read -r url; do
        # Get title from episode and generate slug
        TITLE=$(echo "$CURRENT_JSON" | jq -r --arg url "$url" '.[] | select(.audio == $url) | .title')
        
        if [ -n "$TITLE" ] && [ "$TITLE" != "null" ]; then
          # Generate slug from title using Python
          SLUG=$(printf '%s' "$TITLE" | python3 -c 'import sys,unicodedata,re; t=sys.stdin.read(); s=unicodedata.normalize("NFKD", t); s=s.encode("ascii","ignore").decode("ascii"); s=re.sub(r"[^a-zA-Z0-9]+","-", s).strip("-").lower(); print(s)')
          
          if [ -n "$SLUG" ]; then
            echo "${TITLE}|${SLUG}" >> "$TEMP_PODCASTS"
          fi
        fi
      done <<< "$NEW_URLS"
    fi
    
    rm -f "$TEMP_PREV" "$TEMP_CURR"
  fi
done <<< "$CHANGED_FILES"

# Count total items
ARTICLES_COUNT=$(wc -l < "$TEMP_ARTICLES" | tr -d ' ')
PODCASTS_COUNT=$(wc -l < "$TEMP_PODCASTS" | tr -d ' ')
TOTAL_ITEMS=$((ARTICLES_COUNT + PODCASTS_COUNT))

if [ "$TOTAL_ITEMS" -eq 0 ]; then
  echo "✅ No new articles or podcasts found"
  rm -f "$TEMP_ARTICLES" "$TEMP_PODCASTS"
  exit 0
fi

echo "📊 Found: ${ARTICLES_COUNT} articles, ${PODCASTS_COUNT} podcasts"

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
  echo "🎙️ Sending ${PODCASTS_COUNT} podcasts to Telegram..."
  while IFS='|' read -r title slug; do
    MESSAGE="🎙️ Nuevo capítulo del podcast publicado: ${title}

🔗 https://mundodolphins.es/podcast/${slug}/"
    
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
  done < "$TEMP_PODCASTS"
fi

# Clean up
rm -f "$TEMP_ARTICLES" "$TEMP_PODCASTS"

echo "✅ Process completed"

