# Déploie la page early access + son collecteur sur hub4fix.net.
# Prérequis : npx wrangler login (une fois), zone hub4fix.net sur Cloudflare, secrets posés.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# early-access.html reste la seule source ; early-public/ n'est qu'une copie de déploiement.
New-Item -ItemType Directory -Force early-public | Out-Null
Copy-Item ..\early-access.html early-public\index.html -Force
Copy-Item ..\favicon.svg, ..\favicon.ico early-public\ -Force

npx wrangler deploy -c wrangler-early.toml
