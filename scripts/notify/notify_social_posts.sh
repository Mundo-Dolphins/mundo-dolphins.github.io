#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Detects new posts added in the last commit to data/posts_1.json
# and sends them to Telegram in chronological order (oldest first)

POSTS_FILE="data/posts_1.json"

echo "📋 Checking for new posts in last commit..."

# Verify posts file exists
if [ ! -f "$POSTS_FILE" ]; then
  echo "❌ Posts file not found: $POSTS_FILE"
  exit 1
fi

# Source common Telegram send function with retry logic
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/telegram_send.sh"

# Get posts from current commit
CURRENT_JSON=$(cat "$POSTS_FILE")

# Get posts from parent commit (HEAD~1)
PREVIOUS_JSON=$(git show HEAD~1:"$POSTS_FILE" 2>/dev/null || echo "[]")

# Create temp files for comparison
TEMP_PREVIOUS=$(mktemp)
TEMP_CURRENT=$(mktemp)
TEMP_NEW_POSTS=$(mktemp)

# Extract URLs from both versions (only BlueSky posts)
echo "$PREVIOUS_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_PREVIOUS"
echo "$CURRENT_JSON" | jq -r '.[] | select(.stype == 0) | select(.BlueSkyPost.BskyPost != null) | .BlueSkyPost.BskyPost' | sort > "$TEMP_CURRENT"

# Get URLs that are in current but not in previous commit (newly added)
NEW_URLS=$(comm -13 "$TEMP_PREVIOUS" "$TEMP_CURRENT")

if [ -z "$NEW_URLS" ]; then
  echo "✅ No new posts found in last commit"
  rm -f "$TEMP_PREVIOUS" "$TEMP_CURRENT" "$TEMP_NEW_POSTS"
  exit 0
fi

# Get full post objects for new URLs and sort chronologically (oldest first)
# Process each new URL and find its post object
{
  echo "["
  FIRST=true
  while IFS= read -r url; do
    POST=$(echo "$CURRENT_JSON" | jq -c --arg url "$url" '
      .[] | 
      select(.stype == 0) |
      select(.PublishedOn != null) |
      select(.BlueSkyPost.Description != null) |
      select(.BlueSkyPost.BskyPost == $url)
    ')
    if [ -n "$POST" ]; then
      if [ "$FIRST" = false ]; then
        echo ","
      fi
      echo "$POST"
      FIRST=false
    fi
  done <<< "$NEW_URLS"
  echo "]"
} | jq 'sort_by(.PublishedOn)' > "$TEMP_NEW_POSTS"

# Count posts to send
NEW_COUNT=$(jq 'length' "$TEMP_NEW_POSTS")
echo "📊 New posts found: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No valid posts to send"
  rm -f "$TEMP_PREVIOUS" "$TEMP_CURRENT" "$TEMP_NEW_POSTS"
  exit 0
fi

# Send posts to Telegram (in chronological order: oldest first)
echo "📤 Sending $NEW_COUNT posts to Telegram..."

SENT_COUNT=0

jq -c '.[]' "$TEMP_NEW_POSTS" | while IFS= read -r post; do
  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')
  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')
  
  # Build message
  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"
  
  # Send to Telegram
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    SEND_RESULT=$(send_to_telegram "$MESSAGE")
    
    if [ "$SEND_RESULT" = "success" ]; then
      echo "✅ Sent: ${DESCRIPTION:0:50}... (${POST_DATE})"
      SENT_COUNT=$((SENT_COUNT + 1))
      
      # Small pause between messages to avoid rate limits
      sleep 2
    else
      echo "❌ Error sending: ${DESCRIPTION:0:50}..."
      echo "Response: $SEND_RESULT"
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}... (${POST_DATE})"
    SENT_COUNT=$((SENT_COUNT + 1))
  fi
done

echo "📊 Posts sent: $SENT_COUNT of $NEW_COUNT"

# Clean up
rm -f "$TEMP_PREVIOUS" "$TEMP_CURRENT" "$TEMP_NEW_POSTS"

echo "✅ Process completed"
