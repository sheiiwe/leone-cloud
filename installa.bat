@echo off
chcp 65001 >nul
title Leone Consulting - Installazione

echo.
echo ╔════════════════════════════════════════╗
echo ║   Leone Consulting — Installazione     ║
echo ╚════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Controlla Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js non trovato!
    echo    Scarica e installa Node.js da: https://nodejs.org
    echo    Poi riavvia questo file.
    pause
    exit /b 1
)

echo ✅ Node.js trovato
echo.
echo 📦 Installazione dipendenze...
call npm install --silent
if errorlevel 1 (
    echo ❌ Errore installazione dipendenze
    pause
    exit /b 1
)

echo 🔨 Creazione app Windows...
call npm run build-win
if errorlevel 1 (
    echo ❌ Errore build
    pause
    exit /b 1
)

:: Cerca il file .exe installabile
set "INSTALLER="
for /r "dist" %%f in (*.exe) do (
    echo %%f | findstr /i "Setup" >nul
    if not errorlevel 1 set "INSTALLER=%%f"
)

if defined INSTALLER (
    echo.
    echo ╔════════════════════════════════════════╗
    echo ║  ✅ Build completata!                  ║
    echo ║  Avvio installer...                    ║
    echo ╚════════════════════════════════════════╝
    echo.
    start "" "%INSTALLER%"
) else (
    echo ✅ Build completata! Cerca il file .exe nella cartella dist\
)

pause
