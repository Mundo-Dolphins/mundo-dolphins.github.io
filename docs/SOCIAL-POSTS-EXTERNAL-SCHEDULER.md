# Social posts: scheduler externo (Servidor externo + Cloudflare)

Este documento define como disparar el workflow de social posts de GitHub Actions desde un scheduler externo cada 10 minutos para evitar la variabilidad del `schedule` nativo.

## Flujo

1. Un cron externo ejecuta un script.
2. El script llama al endpoint `repository_dispatch` de GitHub.
3. El workflow `.github/workflows/posts.yml` escucha el evento `social-check`.

## Requisitos

- Repositorio: `Mundo-Dolphins/mundo-dolphins.github.io`
- Workflow habilitado para `repository_dispatch`.
- Token con permisos para enviar dispatch al repositorio.

## 1) Instalar en VPS con CLI + SSH

### 1.1 Crear carpeta y copiar script por SSH

Desde tu maquina local:

```bash
ssh user@ip "mkdir -p ~/mundo-dolphins-scheduler"
scp scripts/external/trigger_posts_workflow.sh user@ip:~/mundo-dolphins-scheduler/
ssh user@ip "chmod +x ~/mundo-dolphins-scheduler/trigger_posts_workflow.sh"
```

### 1.2 Guardar token en un archivo de entorno

En el VPS:

```bash
cat > ~/mundo-dolphins-scheduler/.env <<'EOF'
GITHUB_TOKEN=REEMPLAZAR_POR_TOKEN_REAL
GITHUB_OWNER=Mundo-Dolphins
GITHUB_REPO=mundo-dolphins.github.io
EVENT_TYPE=social-check
EOF
chmod 600 ~/mundo-dolphins-scheduler/.env
```

### 1.3 Probar manualmente

```bash
cd ~/mundo-dolphins-scheduler
set -a
source ./.env
set +a
./trigger_posts_workflow.sh
```

Si todo va bien, debe responder `OK: workflow disparado...`.

### 1.4 Crear cron cada 10 minutos

```bash
(crontab -l 2>/dev/null; echo '*/10 * * * * cd ~/mundo-dolphins-scheduler && set -a && source ./.env && set +a && ./trigger_posts_workflow.sh >> ~/mundo-dolphins-scheduler/cron.log 2>&1') | crontab -
```

Verificar:

```bash
crontab -l
tail -f ~/mundo-dolphins-scheduler/cron.log
```

## 2) Alternativa Cloudflare Cron Triggers

Puedes usar un Worker con Cron Trigger (cada 10 min) que haga el mismo `repository_dispatch`.

### 2.1 Worker (ejemplo)

```javascript
export default {
  async scheduled(event, env, ctx) {
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`;

    const payload = {
      event_type: 'social-check',
      client_payload: {
        source: 'cloudflare-cron',
        triggered_at: new Date().toISOString(),
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Dispatch failed: ${res.status} ${text}`);
    }
  },
};
```

### 2.2 Cron en `wrangler.toml` (cada 10 min)

```toml
name = "md-social-trigger"
main = "src/index.js"
compatibility_date = "2026-04-24"

[triggers]
crons = ["*/10 * * * *"]
```

### 2.3 Secrets en Cloudflare

- `GITHUB_TOKEN`
- `GITHUB_OWNER` = `Mundo-Dolphins`
- `GITHUB_REPO` = `mundo-dolphins.github.io`

Con Wrangler:

```bash
wrangler secret put GITHUB_TOKEN
wrangler secret put GITHUB_OWNER
wrangler secret put GITHUB_REPO
```

## Seguridad recomendada

- Usa un token dedicado solo para este dispatch.
- No guardes tokens en texto plano fuera de `.env` con permisos `600`.
- Rota el token periodicamente.
- Si dejas `schedule` en GitHub Actions como backup, usa intervalos mas amplios para no duplicar ejecuciones.

## Troubleshooting rapido

- HTTP `401/403`: token sin permisos o expirado.
- HTTP `404`: owner/repo incorrectos o token sin acceso al repo.
- Dispatch correcto pero workflow no corre: confirmar que `posts.yml` tiene `repository_dispatch` con `types: [social-check]`.
