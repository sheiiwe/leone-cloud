#!/bin/bash
# Aggiorna Leone Consulting da GitHub

cd "$(dirname "$0")"
echo "🔄 Controllo aggiornamenti..."

# Auto-riparazione: se manca .git, lo ricrea e si allinea al repo
if [ ! -d .git ]; then
  echo "🔧 Ripristino collegamento a GitHub..."
  git init -q
  git remote add origin https://github.com/sheiiwe/leone-cloud.git 2>/dev/null
  git fetch origin main 2>/dev/null && git reset --hard origin/main 2>/dev/null
fi

# Scarica aggiornamenti da GitHub
git pull origin main 2>/dev/null
if [ $? -ne 0 ]; then
  # Il pull potrebbe essere bloccato da modifiche locali: provo a riallineare a forza
  git fetch origin main 2>/dev/null
  if [ $? -ne 0 ]; then
    echo "⚠️  Impossibile connettersi a GitHub, avvio versione locale..."
    open "/Applications/Leone Consulting.app"
    exit 0
  fi
  echo "🔧 Riallineo alla versione su GitHub..."
  git reset --hard origin/main 2>/dev/null
fi

echo "⚙️  Installazione aggiornamento..."

# Chiudi app
pkill -f "Leone Consulting" 2>/dev/null
sleep 1

# Installa dipendenze se mancano
if [ ! -d "node_modules" ]; then
  echo "📦 Installazione dipendenze..."
  npm install
fi

# Ricompila
npm run build 2>/dev/null

APP=$(find dist -name "*.app" 2>/dev/null | head -1)
SUPABASE_BUNDLE="$APP/Contents/Resources/app/assets/supabase.js"
if [ -n "$APP" ] && [ -s "$SUPABASE_BUNDLE" ]; then
  # Sostituisci l'app soltanto dopo avere verificato che la nuova build sia completa.
  rm -rf "/Applications/Leone Consulting.app" 2>/dev/null
  cp -r "$APP" /Applications/
  echo "✅ Leone Consulting aggiornato!"
  open "/Applications/Leone Consulting.app"
else
  echo "❌ Aggiornamento annullato: build mancante o priva di assets/supabase.js."
  echo "   La versione già installata non è stata sostituita."
  open "/Applications/Leone Consulting.app"
  exit 1
fi

echo "   Puoi chiudere il terminale."
