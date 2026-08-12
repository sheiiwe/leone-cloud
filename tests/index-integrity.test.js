'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { TextDecoder } = require('util')

const indexPath = path.join(__dirname, '..', 'src', 'index.html')
const bytes = fs.readFileSync(indexPath)
const html = new TextDecoder('utf-8', { fatal:true }).decode(bytes)

assert.ok(bytes.length > 1_000_000, 'src/index.html sembra troncato')
assert.ok(html.startsWith('<!DOCTYPE html>'), 'DOCTYPE mancante')
assert.ok(html.trimEnd().endsWith('</html>'), 'chiusura HTML mancante')
assert.ok(!html.includes('\0'), 'src/index.html contiene byte NUL')
assert.ok(!html.includes('\uFFFD'), 'src/index.html contiene caratteri UTF-8 corrotti')

for(const name of [
  'switchSezione',
  'apriTessera',
  'configuraCertificatoApple',
  'emettiAppleWallet',
  'configuraAccountGoogleWallet',
  'controllaStatoGoogleWallet',
  'mostraStatoGoogleWallet',
  'emettiGoogleWallet',
  'revocaGoogleWallet',
  'creaBadgeNftDaAnagrafica'
]){
  assert.ok(html.includes(`function ${name}`), `funzione mancante: ${name}`)
}

const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8')
const ipc = fs.readFileSync(path.join(__dirname, '..', 'ipc-handlers.js'), 'utf8')
assert.ok(preload.includes("ipcRenderer.invoke('stato-google-wallet')"), 'bridge stato Google Wallet mancante')
assert.ok(ipc.includes("ipcMain.handle('stato-google-wallet'"), 'handler stato Google Wallet mancante')
assert.ok(ipc.includes('ensureGoogleWalletClass'), 'creazione classe Google Wallet mancante')

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
assert.ok(scripts.length >= 8, 'blocchi script mancanti')
for(const [, attrs, source] of scripts){
  if(/\bsrc\s*=/.test(attrs)) continue
  assert.doesNotThrow(() => new Function(source), 'JavaScript inline non valido')
}

console.log(`index.html integro: ${bytes.length} byte, ${scripts.length} script`)
