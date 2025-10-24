#!/usr/bin/env bash
set -euo pipefail

# notify_social_posts.sh
# Script principal que detecta y envía posts sociales nuevos a Telegram
# Criterios:
# 1. Lee solo data/posts_1.json (posts más recientes cronológicamente)
# 2. Filtra posts por fecha usando cache (.github/notifications/last_post_date.txt)
# 3. Si no hay cache, consulta Telegram para ver qué URLs ya están publicadas
# 4. Después de enviar, actualiza la cache con la fecha del post más reciente enviado

CACHE_FILE=".github/notifications/last_post_date.txt"
POSTS_FILE="data/posts_1.json"

# Verificar que existe el archivo de posts
if [ ! -f "$POSTS_FILE" ]; then
  echo "❌ No se encontró $POSTS_FILE"
  exit 1
fi

# Crear directorio de notificaciones si no existe
mkdir -p .github/notifications

echo "📋 Leyendo posts desde $POSTS_FILE"

# Paso 1: Leer la fecha del último post enviado desde cache
LAST_DATE=""
if [ -f "$CACHE_FILE" ]; then
  LAST_DATE=$(cat "$CACHE_FILE")
  echo "📅 Última fecha en cache: $LAST_DATE"
else
  echo "⚠️ No hay fecha en cache"
fi

# Paso 2: Obtener lista de URLs ya publicadas en Telegram (fallback si no hay cache)
KNOWN_URLS=$(mktemp)
if [ -z "$LAST_DATE" ]; then
  echo "📡 Consultando Telegram para obtener URLs ya publicadas..."
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    UPDATES=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=100" || echo '{"ok":false}')
    if echo "$UPDATES" | jq -e '.ok' >/dev/null 2>&1; then
      echo "$UPDATES" | jq -r '.result[]?.message?.text // empty' | \
        grep -oE 'https?://[^[:space:]]+' | sort -u > "$KNOWN_URLS"
      echo "✅ Se encontraron $(wc -l < "$KNOWN_URLS" | tr -d ' ') URLs en Telegram"
    else
      echo "⚠️ No se pudieron obtener mensajes de Telegram"
    fi
  else
    echo "⚠️ TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados"
  fi
fi

# Paso 3: Filtrar posts nuevos
TEMP_POSTS=$(mktemp)
if [ -n "$LAST_DATE" ]; then
  # Filtrar por fecha
  jq -c --arg last_date "$LAST_DATE" '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null) |
    select(.PublishedOn > $last_date)
  ' "$POSTS_FILE" > "$TEMP_POSTS"
else
  # Filtrar por URLs conocidas
  jq -c '
    .[] | 
    select(.stype == 0) |
    select(.PublishedOn != null) |
    select(.BlueSkyPost.Description != null) |
    select(.BlueSkyPost.BskyPost != null)
  ' "$POSTS_FILE" | while IFS= read -r post; do
    URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
    if ! grep -Fxq "$URL" "$KNOWN_URLS" 2>/dev/null; then
      echo "$post"
    fi
  done > "$TEMP_POSTS"
fi

# Contar posts nuevos
NEW_COUNT=$(wc -l < "$TEMP_POSTS" | tr -d ' ')
echo "📊 Posts nuevos encontrados: $NEW_COUNT"

if [ "$NEW_COUNT" -eq 0 ]; then
  echo "✅ No hay posts nuevos para enviar"
  rm -f "$TEMP_POSTS" "$KNOWN_URLS"
  echo "has_new_posts=false"
  exit 0
fi

echo "has_new_posts=true"
echo "posts_count=$NEW_COUNT"

# Paso 4: Enviar posts a Telegram
echo "📤 Enviando posts a Telegram..."

LATEST_DATE=""
SENT_COUNT=0

while IFS= read -r post; do
  DESCRIPTION=$(echo "$post" | jq -r '.BlueSkyPost.Description')
  URL=$(echo "$post" | jq -r '.BlueSkyPost.BskyPost')
  POST_DATE=$(echo "$post" | jq -r '.PublishedOn')
  
  # Construir mensaje
  MESSAGE="🐬 ${DESCRIPTION}

🔗 ${URL}"
  
  # Enviar a Telegram
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    ENCODED_MESSAGE=$(printf '%s' "$MESSAGE" | jq -sRr '@uri')
    
    RESPONSE=$(curl -s -X POST \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${ENCODED_MESSAGE}" \
      -d "parse_mode=HTML" \
      -d "disable_web_page_preview=false")
    
    if echo "$RESPONSE" | jq -e '.ok' >/dev/null 2>&1; then
      echo "✅ Enviado: ${DESCRIPTION:0:50}..."
      SENT_COUNT=$((SENT_COUNT + 1))
      
      # Actualizar última fecha
      if [ -z "$LATEST_DATE" ] || [ "$POST_DATE" \> "$LATEST_DATE" ]; then
        LATEST_DATE="$POST_DATE"
      fi
      
      # Pequeña pausa entre mensajes
      sleep 2
    else
      echo "❌ Error al enviar: ${DESCRIPTION:0:50}..."
      echo "Respuesta: $RESPONSE"
    fi
  else
    echo "⚠️ DRY RUN: ${DESCRIPTION:0:50}..."
    SENT_COUNT=$((SENT_COUNT + 1))
    if [ -z "$LATEST_DATE" ] || [ "$POST_DATE" \> "$LATEST_DATE" ]; then
      LATEST_DATE="$POST_DATE"
    fi
  fi
done < "$TEMP_POSTS"

echo "📊 Posts enviados: $SENT_COUNT de $NEW_COUNT"

# Paso 5: Actualizar cache con la fecha del último post enviado
if [ -n "$LATEST_DATE" ] && [ "$SENT_COUNT" -gt 0 ]; then
  echo "$LATEST_DATE" > "$CACHE_FILE"
  echo "💾 Cache actualizada con fecha: $LATEST_DATE"
fi

# Limpiar archivos temporales
rm -f "$TEMP_POSTS" "$KNOWN_URLS"

echo "✅ Proceso completado"
