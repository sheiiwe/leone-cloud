#!/bin/bash

echo ""
echo "╔════════════════════════════════════════╗"
echo "║   Leone Consulting — Installazione     ║"
echo "╚════════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
APP_NAME="Leone Consulting"

# Configura git una volta sola
git config pull.rebase false 2>/dev/null
git config merge.ours.driver true 2>/dev/null

echo "📦 Installazione dipendenze..."
npm install --silent

echo "🔨 Creazione app Mac..."
npm run build-dir 2>/dev/null || npm run build 2>/dev/null

# Cerca l'app compilata in tutte le possibili cartelle
APP_BUILT=""
for try_path in \
  "$SCRIPT_DIR/dist/mac-arm64/$APP_NAME.app" \
  "$SCRIPT_DIR/dist/mac-universal/$APP_NAME.app" \
  "$SCRIPT_DIR/dist/mac/$APP_NAME.app" \
  "$SCRIPT_DIR/dist/mac-x64/$APP_NAME.app"
do
  if [ -d "$try_path" ]; then
    APP_BUILT="$try_path"
    break
  fi
done

if [ -n "$APP_BUILT" ]; then
  echo "✅ Build completata: $APP_BUILT"

  # Rimuovi vecchia versione
  rm -rf "/Applications/$APP_NAME.app" 2>/dev/null

  # Copia in Applications
  cp -R "$APP_BUILT" "/Applications/$APP_NAME.app"
  xattr -rd com.apple.quarantine "/Applications/$APP_NAME.app" 2>/dev/null || true

  echo ""
  echo "╔════════════════════════════════════════╗"
  echo "║  ✅ Installazione completata!          ║"
  echo "║  Avvio Leone Consulting...             ║"
  echo "╚════════════════════════════════════════╝"
  echo ""

  open "/Applications/$APP_NAME.app"
else
  echo "❌ Build non trovata! Provo avvio diretto..."
  npx electron . &
fi
