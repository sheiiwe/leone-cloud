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
  'creaBadgeNftDaAnagrafica',
  'grPreparaDati',
  'cpApriComparazione',
  'cpRenderComparazione'
]){
  assert.ok(html.includes(`function ${name}`), `funzione mancante: ${name}`)
}

assert.ok(html.includes("db.from('corsi_costi')"), 'archivio privato costi corso mancante')
assert.ok(html.includes('id="cp-search"'), 'ricerca Pagine corso mancante')
assert.ok(html.includes('apriSchedaProc(v.chiave)'), 'apertura scheda dalla ricerca globale mancante')
assert.ok(html.includes('prezzo<=0||!Number.isFinite(costo)?null'), 'guadagno calcolato anche senza prezzo cliente')
assert.ok(html.includes("(m==null?'':'<br><span"), 'margine percentuale nullo non gestito nelle Pagine corso')

const cpGuadagnoBody = html.match(/function _cpGuadagno\(c\)\{([\s\S]*?)\n\}/)
assert.ok(cpGuadagnoBody, 'funzione guadagno Pagine corso non trovata')
const cpGuadagno = new Function('_cpPrezzoCliente', `return function(c){${cpGuadagnoBody[1]}\n}`)(c => c.prezzo_cliente)
assert.strictEqual(cpGuadagno({ costo_partner:280.60, prezzo_cliente:0 }), null, 'un corso Solo info non deve produrre un margine percentuale')
assert.ok(Math.abs(cpGuadagno({ costo_partner:280.60, prezzo_cliente:400 }) - 119.40) < 0.001, 'guadagno corso calcolato in modo errato')

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
