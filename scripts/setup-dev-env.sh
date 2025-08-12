#!/bin/bash

# Script para desarrollo local - configura variables de entorno desde vapid-config.json
# Uso: source scripts/setup-dev-env.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAPID_CONFIG="$SCRIPT_DIR/vapid-config.json"

if [ -f "$VAPID_CONFIG" ]; then
    # Extraer claves del JSON usando jq o python si jq no está disponible
    if command -v jq >/dev/null 2>&1; then
        export VAPID_PUBLIC_KEY=$(jq -r '.publicKey' "$VAPID_CONFIG")
        export VAPID_PRIVATE_KEY=$(jq -r '.privateKey' "$VAPID_CONFIG")
    else
        # Fallback usando python
        export VAPID_PUBLIC_KEY=$(python3 -c "import json; print(json.load(open('$VAPID_CONFIG'))['publicKey'])")
        export VAPID_PRIVATE_KEY=$(python3 -c "import json; print(json.load(open('$VAPID_CONFIG'))['privateKey'])")
    fi
    
    echo "✅ Variables de entorno VAPID configuradas para desarrollo local"
    echo "🔑 VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:0:20}..."
    echo "🔒 VAPID_PRIVATE_KEY: [configurada]"
    echo ""
    echo "📋 Para usar en Hugo:"
    echo "   hugo server --port 1319 --bind 127.0.0.1"
    echo ""
    echo "🚀 Para producción, configura estos secrets en GitHub:"
    echo "   VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY"
    echo "   VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY"
else
    echo "❌ No se encontró vapid-config.json"
    echo "💡 Ejecuta: node push-notifications-secure.js generate-keys"
fi
