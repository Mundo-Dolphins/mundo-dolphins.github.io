#!/usr/bin/env bash
set -euo pipefail

# send_to_telegram.sh
# Reads an articles JSON array (default: articles.json) and sends Telegram messages.
# Environment variables:
# - TELEGRAM_BOT_TOKEN (required)
# - TELEGRAM_CHAT_ID (required)
# - DRY_RUN=1 to only print messages without sending
# - NOTIFICATION_DELAY_SEC optional delay between messages (default 1)

ARTICLES_FILE="${1:-articles.json}"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "❌ TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set"
  exit 1
fi

if [ ! -f "$ARTICLES_FILE" ]; then
  echo "❌ Articles file '$ARTICLES_FILE' not found"
  exit 1
fi

CONTENT_COUNT=$(jq length "$ARTICLES_FILE")
if [ "$CONTENT_COUNT" -le 0 ]; then
  echo "ℹ️ No articles to send"
  exit 0
fi

DELAY=${NOTIFICATION_DELAY_SEC:-1}

for i in $(seq 0 $((CONTENT_COUNT - 1))); do
  ITEM=$(jq -r ".[$i]" "$ARTICLES_FILE")
  TITLE=$(echo "$ITEM" | jq -r '.title')
  URL=$(echo "$ITEM" | jq -r '.url')
  SECTION=$(echo "$ITEM" | jq -r '.section')

  if [ "$SECTION" = "podcast" ]; then
    MESSAGE="🎙️ Nuevo episodio de podcast publicado: *${TITLE}*%0A🔗 ${URL}"
  else
    MESSAGE="🆕 Nuevo artículo publicado en la web: *${TITLE}*%0A🔗 ${URL}"
  fi

  echo "📤 Sending notification $((i+1))/$CONTENT_COUNT: $TITLE"

  if [ "${DRY_RUN:-0}" = "1" ]; then
    echo "DRY_RUN: $MESSAGE"
    continue
  fi

  MAX_RETRIES=3
  RETRY_COUNT=0

  while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TELEGRAM_CHAT_ID}" \
      -d text="${MESSAGE}" \
      -d parse_mode="Markdown")

    OK=$(echo "$RESPONSE" | jq -r '.ok // false')
    if [ "$OK" = "true" ]; then
      echo "✅ Successfully sent notification $((i+1))/$CONTENT_COUNT"
      break
    fi

    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.error_code // empty')
    if [ "$ERROR_CODE" = "429" ]; then
      RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.parameters.retry_after // 30')
      echo "⏳ Rate limit hit. Waiting $RETRY_AFTER seconds..."
      sleep "$RETRY_AFTER"
    else
      RETRY_COUNT=$((RETRY_COUNT + 1))
      echo "⚠️ Attempt $RETRY_COUNT/$MAX_RETRIES failed. Response: $RESPONSE"
      if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        sleep 2
      fi
    fi
  done

  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ Failed to send notification after $MAX_RETRIES attempts for: $TITLE"
  fi

  sleep "$DELAY"
done

echo "🎉 Notification process completed!"
