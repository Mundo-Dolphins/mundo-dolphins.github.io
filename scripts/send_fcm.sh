#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/send_fcm.sh \
    --project-id <id> \
    --access-token <token> \
    --type <episode|article> \
    --title <title> \
    --body <body> \
    [--episode-id <id>] \
    [--article-published-timestamp <ms>] \
    [--token <fcm_token>] \
    [--topic <topic>]

Notes:
- If both --token and --topic are provided, token is used.
- Returns non-zero if FCM responds with an error.
USAGE
}

PROJECT_ID=""
ACCESS_TOKEN=""
TYPE=""
TITLE=""
BODY=""
EPISODE_ID=""
ARTICLE_PUBLISHED_TIMESTAMP=""
FCM_TOKEN=""
TOPIC=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)
      PROJECT_ID="$2"; shift 2 ;;
    --access-token)
      ACCESS_TOKEN="$2"; shift 2 ;;
    --type)
      TYPE="$2"; shift 2 ;;
    --title)
      TITLE="$2"; shift 2 ;;
    --body)
      BODY="$2"; shift 2 ;;
    --episode-id)
      EPISODE_ID="$2"; shift 2 ;;
    --article-published-timestamp)
      ARTICLE_PUBLISHED_TIMESTAMP="$2"; shift 2 ;;
    --token)
      FCM_TOKEN="$2"; shift 2 ;;
    --topic)
      TOPIC="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
 done

if [[ -z "$PROJECT_ID" || -z "$ACCESS_TOKEN" || -z "$TYPE" || -z "$TITLE" || -z "$BODY" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 2
fi

if [[ "$TYPE" != "episode" && "$TYPE" != "article" ]]; then
  echo "Invalid type: $TYPE" >&2
  exit 2
fi

if [[ "$TYPE" == "episode" && -z "$EPISODE_ID" ]]; then
  echo "Missing --episode-id for type=episode" >&2
  exit 2
fi

if [[ "$TYPE" == "article" && -z "$ARTICLE_PUBLISHED_TIMESTAMP" ]]; then
  echo "Missing --article-published-timestamp for type=article" >&2
  exit 2
fi

if [[ -z "$FCM_TOKEN" && -z "$TOPIC" ]]; then
  echo "Provide --token or --topic" >&2
  exit 2
fi

TARGET_KIND=""
TARGET_VALUE=""
if [[ -n "$FCM_TOKEN" ]]; then
  TARGET_KIND="token"
  TARGET_VALUE="$FCM_TOKEN"
else
  TARGET_KIND="topic"
  TARGET_VALUE="$TOPIC"
fi

PAYLOAD=$(jq -n \
  --arg target_kind "$TARGET_KIND" \
  --arg target_value "$TARGET_VALUE" \
  --arg type "$TYPE" \
  --arg title "$TITLE" \
  --arg body "$BODY" \
  --arg episode_id "$EPISODE_ID" \
  --arg article_published_timestamp "$ARTICLE_PUBLISHED_TIMESTAMP" \
  '(
    {message: {data: {type: $type, title: $title, body: $body}}} |
    if $target_kind == "token" then .message.token = $target_value else .message.topic = $target_value end |
    if $type == "episode" then .message.data.episode_id = $episode_id else . end |
    if $type == "article" then .message.data.article_published_timestamp = $article_published_timestamp else . end
  )'
)

FCM_URL="https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send"

HTTP_RESPONSE_FILE=$(mktemp)
HTTP_STATUS=$(curl -sS -o "$HTTP_RESPONSE_FILE" -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data "$PAYLOAD" \
  "$FCM_URL")

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "FCM request failed with status ${HTTP_STATUS}" >&2
  cat "$HTTP_RESPONSE_FILE" >&2
  rm -f "$HTTP_RESPONSE_FILE"
  exit 1
fi

echo "FCM request ok (status ${HTTP_STATUS})."
rm -f "$HTTP_RESPONSE_FILE"
