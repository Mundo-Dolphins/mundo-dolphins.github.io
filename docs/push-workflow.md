# Android FCM push via GitHub Actions

This setup sends Android FCM (HTTP v1) data-only notifications from GitHub Actions.

## Required GitHub Secrets

Create the following secrets in the repo:

- ANDROID_FIREBASE_PROJECT_ID
- ANDROID_FIREBASE_SERVICE_ACCOUNT_JSON

The service account JSON must be the full JSON (not base64) from Google Cloud.

## Minimum permissions

Grant the service account the minimum role required to call FCM HTTP v1:

- Permission: firebasecloudmessaging.messages.create

Recommended roles (pick one):

- Firebase Cloud Messaging API Admin
- Custom role with firebasecloudmessaging.messages.create

## Manual workflow examples

### Episode

Workflow: .github/workflows/send-push.yml

Inputs:
- notification_type: episode
- episode_id: 1744098194000
- title: Nuevo episodio disponible
- body: Ya puedes escucharlo
- token: <device token> (optional)
- topic: mundo-dolphins-news (optional)

### Article

Workflow: .github/workflows/send-push.yml

Inputs:
- notification_type: article
- article_published_timestamp: 1744080000000
- title: Nuevo articulo publicado
- body: Pulsa para leerlo
- token: <device token> (optional)
- topic: mundo-dolphins-news (optional)

## repository_dispatch example

Trigger event types:
- new_episode
- new_article

Payload examples:

```json
{
  "event_type": "new_episode",
  "client_payload": {
    "episode_id": "1744098194000",
    "title": "Nuevo episodio disponible",
    "body": "Ya puedes escucharlo",
    "token": "<device token>",
    "topic": "mundo-dolphins-news"
  }
}
```

```json
{
  "event_type": "new_article",
  "client_payload": {
    "article_published_timestamp": "1744080000000",
    "title": "Nuevo articulo publicado",
    "body": "Pulsa para leerlo",
    "topic": "mundo-dolphins-news"
  }
}
```

## Troubleshooting

- SENDER_ID_MISMATCH: The token belongs to a different Firebase project. Verify ANDROID_FIREBASE_PROJECT_ID and the app configuration.
- PERMISSION_DENIED: The service account lacks firebasecloudmessaging.messages.create. Grant the proper role.
- CONSUMER_INVALID: The Firebase Cloud Messaging API is not enabled for the project. Enable it in Google Cloud Console.

## Notes

- If both token and topic are provided, token is used.
- The script exits non-zero when FCM responds with an error.
