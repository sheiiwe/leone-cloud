#!/bin/bash
# Pubblica aggiornamento Leone Consulting su GitHub

cd "$(dirname "$0")"

echo "📦 Pubblicazione in corso..."

VERSIONE=$(node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "?")
DATA=$(date "+%d/%m/%Y %H:%M")

# Verifica base: controlla che non ci siano marcatori di conflitto git
if grep -q "<<<<<<\|>>>>>>>" src/index.html 2>/dev/null; then
  echo "❌ Conflitti git trovati in index.html — risolvi prima di pubblicare!"
  exit 1
fi

# Salva i nostri file prima del merge
cp src/index.html /tmp/lc_index_backup.html
cp package.json /tmp/lc_package_backup.json

# Aggiunge SOLO nuovi/modificati, MAI rimozioni: cosi' non cancella portale/ e sign.html
# (che stanno nel repo del sito ma non in questa cartella dell'app)
git add --ignore-removal .

if git diff --cached --quiet; then
  echo "ℹ️  Nessuna modifica locale."
else
  git commit -m "v${VERSIONE} - ${DATA}" -q
  echo "✅ Commit v${VERSIONE} creato."
fi

# Fetch e merge forzando i nostri file
git fetch origin main -q 2>/dev/null
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "none")

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✅ Già aggiornato su GitHub!"
  exit 0
fi

git merge origin/main --no-edit -q 2>/dev/null

# Ripristina sempre i nostri file dopo il merge
cp /tmp/lc_index_backup.html src/index.html
cp /tmp/lc_package_backup.json package.json
git add src/index.html package.json
git commit -m "v${VERSIONE} - ripristino post-merge" -q 2>/dev/null || true

git push origin main -q

if [ $? -eq 0 ]; then
  echo "✅ Pubblicato v${VERSIONE} su GitHub!"
  echo "   🔔 Ora premi 'Controlla aggiornamenti' nell'app sull'altro Mac."
else
  echo "❌ Errore nel push."
  exit 1
fi
