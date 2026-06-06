@echo off
chcp 65001 >nul
title Leone Consulting - Aggiornamento

cd /d "%~dp0"

echo 📥 Scaricamento aggiornamenti...
call git pull origin main

echo 📦 Installazione dipendenze...
call npm install --silent

echo 🔨 Compilazione...
call npm run build-win

:: Cerca e avvia il nuovo installer
for /r "dist" %%f in (*Setup*.exe) do (
    start "" "%%f"
    goto :done
)
:done
