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
  'revocaAppleWallet',
  'configuraAccountGoogleWallet',
  'controllaStatoGoogleWallet',
  'mostraStatoGoogleWallet',
  'emettiGoogleWallet',
  'revocaGoogleWallet',
  'creaBadgeNftDaAnagrafica',
  'invocaFunzioneAutenticata',
  '_tsGarantisciNftTessera',
  'collegaNftTessera',
  'collegaNftMancanti',
  'grPreparaDati',
  'cpApriComparazione',
  'cpRenderComparazione'
]){
  assert.ok(html.includes(`function ${name}`), `funzione mancante: ${name}`)
}

assert.ok(html.includes("db.from('corsi_costi')"), 'archivio privato costi corso mancante')
assert.ok(html.includes('.main{flex:1;min-width:0;overflow:auto'), 'scorrimento principale ancorato alla finestra mancante')
assert.ok(html.includes('.tbl-wrap{overflow-x:visible}'), 'le tabelle mantengono ancora la barra orizzontale in fondo al contenuto')
assert.ok(html.includes("onclick=\"revocaAppleWallet(\\'"), 'pulsante Revoca Apple Wallet mancante')
assert.ok(html.includes("onclick=\"revocaGoogleWallet(\\'"), 'pulsante Revoca Google Wallet mancante')
assert.ok(html.includes('?\'<button class="btn btn-sm btn-r" title="Revoca il pass Apple Wallet"'), 'Revoca Apple Wallet non è un pulsante rosso sostitutivo')
assert.ok(html.includes('?\'<button class="btn btn-sm btn-r" title="Revoca il badge da Google Wallet"'), 'Revoca Google Wallet non è un pulsante rosso sostitutivo')
assert.ok(html.includes('<th>NFT</th>'), 'colonna NFT dei tesserini mancante')
assert.ok(html.includes("tessera_id:t.id"), 'collegamento tesserino/credential NFT mancante')
assert.ok(html.includes("Authorization:'Bearer '+sessione.access_token"), 'JWT utente non inviato esplicitamente alla Edge Function NFT')
assert.ok(html.includes("apikey:SUPA_KEY"), 'apikey pubblica non inviata alla Edge Function NFT')
assert.ok(html.includes("if(risposta.res.status===401)"), 'rinnovo sessione e retry su 401 mancanti')
assert.ok(!html.includes("const motivo=prompt("), 'prompt() non supportato ancora usato per sospensione/revoca NFT')
assert.ok(html.includes("await _tsGarantisciNftTessera(q.data"), 'emissione NFT automatica sul nuovo tesserino mancante')
assert.ok(html.includes("Prima devi emettere e collegare l’NFT obbligatorio"), 'Wallet non protetto dal requisito NFT')
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

const nftMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608150001_link_tessere_credentials_nft.sql'), 'utf8')
assert.ok(nftMigration.includes('add column if not exists tessera_id uuid'), 'FK NFT/tesserino mancante')
assert.ok(nftMigration.includes('credentials_tessera_id_uidx'), 'protezione anti-duplicato NFT/tesserino mancante')
assert.ok(nftMigration.includes("'dipendente','amministratore'"), 'tipo NFT amministratore mancante')
assert.ok(nftMigration.includes('create or replace function public.verify_leone_asset'), 'verifica QR con NFT mancante')
assert.ok(nftMigration.includes('create or replace function public.get_my_wallet_badge_for_portal'), 'vincolo NFT nei portali mancante')
assert.ok(nftMigration.includes("and v_status = 'valido'"), 'Wallet ancora disponibile senza NFT valido')

const verifyApp = fs.readFileSync(path.join(__dirname, '..', 'verifica-site', 'app.js'), 'utf8')
assert.ok(verifyApp.includes('Prova NFT permanente'), 'prova NFT non visibile nella verifica del tesserino')
const portal = fs.readFileSync(path.join(__dirname, '..', 'portale', 'index.html'), 'utf8')
assert.ok(portal.includes('NFT obbligatorio in emissione'), 'stato NFT non visibile nei portali')
for(const [, attrs, source] of portal.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc\s*=/.test(attrs)) continue
  assert.doesNotThrow(() => new Function(source), 'JavaScript inline del portale non valido')
}

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
assert.ok(scripts.length >= 8, 'blocchi script mancanti')
for(const [, attrs, source] of scripts){
  if(/\bsrc\s*=/.test(attrs)) continue
  assert.doesNotThrow(() => new Function(source), 'JavaScript inline non valido')
}

console.log(`index.html integro: ${bytes.length} byte, ${scripts.length} script`)
