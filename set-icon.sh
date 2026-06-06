#!/bin/bash
# Applica il logo LC all'icona sul Desktop

ICON="/Users/$(whoami)/Downloads/leone-cloud/assets/icon.png"
TARGET="/Users/$(whoami)/Desktop/Leone Consulting.app"

# Installa fileicon se non c'è
if ! command -v fileicon &> /dev/null; then
  echo "📦 Installazione fileicon..."
  brew install fileicon 2>/dev/null || {
    # Alternativa senza brew: usa osascript + sips
    echo "⚙️  Applico icona tramite sips..."
    
    # Converti PNG in ICNS usando sips + iconutil
    ICONSET_DIR="/tmp/leone.iconset"
    mkdir -p "$ICONSET_DIR"
    
    for size in 16 32 64 128 256 512; do
      sips -z $size $size "$ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" &>/dev/null
      sips -z $((size*2)) $((size*2)) "$ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" &>/dev/null
    done
    
    iconutil -c icns "$ICONSET_DIR" -o /tmp/leone.icns
    
    # Applica l'icona al collegamento desktop tramite Rez/SetFile
    # Metodo AppleScript
    osascript << APPLESCRIPT
      use framework "Foundation"
      use framework "AppKit"
      set iconPath to "/tmp/leone.icns"
      set targetPath to "$TARGET"
      set iconImage to current application's NSImage's alloc()'s initWithContentsOfFile:iconPath
      current application's NSWorkspace's sharedWorkspace()'s setIcon:iconImage forFile:targetPath options:0
APPLESCRIPT
    
    if [ $? -eq 0 ]; then
      echo "✅ Icona applicata con successo!"
    else
      echo "⚠️  Non riuscito con AppleScript, provo altro metodo..."
      # Forza refresh del Finder
      killall Finder 2>/dev/null
    fi
    
    rm -rf "$ICONSET_DIR"
    exit 0
  }
fi

fileicon set "$TARGET" "$ICON"
echo "✅ Icona Leone Consulting applicata al Desktop!"
