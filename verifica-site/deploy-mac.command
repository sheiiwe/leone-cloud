#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Pubblico la verifica unificata sul progetto Cloudflare Pages leone-verifica..."
npx --yes wrangler@latest pages deploy . --project-name=leone-verifica
echo "Pubblicazione completata. Controlla https://verifica.leoneconsultingitalia.it"
