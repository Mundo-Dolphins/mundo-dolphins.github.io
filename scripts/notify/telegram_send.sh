#!/usr/bin/env bash
set -euo pipefail

# telegram_send.sh
# Common function to send messages to Telegram with retry logic
#
# Usage:
#   source telegram_send.sh
#   send_to_telegram "Your message here"

send_to_telegram() {
  local message="$1"
  local max_retries=3
  local retry_count=0
  
  while [ $retry_count -lt $max_retries ]; do
    RESPONSE=$(curl -s -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${message}" \
      -d "disable_web_page_preview=false")
    
    # Check if request was successful
    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then
      echo "success"
      return 0
    fi
    
    # Check if it's a rate limit error (429)
    ERROR_CODE=$(echo "$RESPONSE" | jq -r '.error_code // empty')
    if [ "$ERROR_CODE" = "429" ]; then
      RETRY_AFTER=$(echo "$RESPONSE" | jq -r '.parameters.retry_after // 10')
      retry_count=$((retry_count + 1))
      
      if [ $retry_count -lt $max_retries ]; then
        echo "⏳ Rate limit hit. Waiting ${RETRY_AFTER}s before retry ${retry_count}/${max_retries}..." >&2
        sleep "$RETRY_AFTER"
      else
        echo "❌ Max retries reached after rate limit" >&2
        echo "$RESPONSE"
        return 1
      fi
    else
      # Other error, don't retry
      echo "$RESPONSE"
      return 1
    fi
  done
  
  return 1
}
