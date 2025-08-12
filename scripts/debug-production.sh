#!/bin/bash

# Script para verificar la configuración de GitHub Secrets y el deployment

echo "🔍 Verificando estado de GitHub Actions..."

# Verificar el último workflow run
echo "📋 Último deployment:"
curl -s -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/Mundo-Dolphins/mundo-dolphins.github.io/actions/workflows/hugo.yaml/runs?per_page=1" \
  | jq -r '.workflow_runs[0] | "Status: \(.status) | Conclusion: \(.conclusion) | Created: \(.created_at)"'

echo ""
echo "🌐 Verificando sitio en producción..."

# Verificar que el sitio responda
echo "📡 Verificando accesibilidad del sitio:"
curl -s -o /dev/null -w "HTTP Status: %{http_code} | Time: %{time_total}s\n" https://mundodolphins.es/

echo ""
echo "🔍 Verificando configuración VAPID en producción..."

# Verificar si la configuración PWA se está inyectando
echo "📝 Verificando inyección de configuración PWA:"
curl -s https://mundodolphins.es/ | grep -A 5 "PWA_SECURE_CONFIG" | head -10

echo ""
echo "💡 Para verificar GitHub Secrets manualmente:"
echo "   1. Ve a: https://github.com/Mundo-Dolphins/mundo-dolphins.github.io/settings/secrets/actions"
echo "   2. Verifica que VAPID_PUBLIC_KEY esté configurado"
echo "   3. Revisa el último workflow en: https://github.com/Mundo-Dolphins/mundo-dolphins.github.io/actions"
