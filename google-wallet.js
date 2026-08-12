'use strict'

const crypto = require('crypto')
const https = require('https')

const GOOGLE_WALLET_ISSUER_ID = '338000000023187800'
const GOOGLE_WALLET_CLASS_ID = `${GOOGLE_WALLET_ISSUER_ID}.leone_badge_aziendale_v1`
const GOOGLE_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_OBJECTS_URL = 'https://walletobjects.googleapis.com/walletobjects/v1/genericObject'
const GOOGLE_WALLET_LOGO_URL = 'https://verifica.leoneconsultingitalia.it/assets/google-wallet-logo.png'

let tokenCache = null

function base64url(value){
  return Buffer.from(value).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signJwt(credentials, claims){
  const header = { alg:'RS256', typ:'JWT' }
  if(credentials.private_key_id) header.kid = credentials.private_key_id
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key)
  return `${unsigned}.${base64url(signature)}`
}

function validateServiceAccount(credentials){
  if(!credentials || credentials.type !== 'service_account'){
    throw new Error('Il file selezionato non è una chiave JSON di un account di servizio Google.')
  }
  if(!/^[^@\s]+@[^@\s]+[.]iam[.]gserviceaccount[.]com$/.test(String(credentials.client_email || ''))){
    throw new Error('Nel JSON manca una e-mail valida dell’account di servizio Google.')
  }
  if(!String(credentials.private_key || '').includes('BEGIN PRIVATE KEY')){
    throw new Error('Nel JSON manca la chiave privata dell’account di servizio Google.')
  }
  if(!credentials.project_id) throw new Error('Nel JSON manca l’ID del progetto Google Cloud.')
  return credentials
}

function localized(value){
  return { defaultValue:{ language:'it-IT', value:String(value || '') } }
}

function dateOnlyToIso(value, endOfDay){
  const raw = String(value || '').trim()
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T${endOfDay ? '23:59:59' : '00:00:00'}+02:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function formatItalianDate(value){
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—'
}

function normalizeObjectSuffix(code){
  const suffix = String(code || '').trim().replace(/[^A-Za-z0-9._-]/g, '_')
  if(!/^[A-Za-z0-9._-]{3,80}$/.test(suffix)) throw new Error('Il codice del tesserino non è valido per Google Wallet.')
  return suffix
}

function buildGoogleWalletObject(badge){
  const code = String(badge?.code || '').trim()
  const name = String(badge?.name || '').trim()
  const role = String(badge?.role || badge?.type || 'Collaboratore').trim()
  if(!name) throw new Error('Nel tesserino manca il nome della persona.')

  const objectId = `${GOOGLE_WALLET_ISSUER_ID}.${normalizeObjectSuffix(code)}`
  const verifyUrl = `https://verifica.leoneconsultingitalia.it/${encodeURIComponent(code)}`
  const object = {
    id: objectId,
    classId: GOOGLE_WALLET_CLASS_ID,
    state: badge?.active === false ? 'INACTIVE' : 'ACTIVE',
    cardTitle: localized('Leone Consulting'),
    subheader: localized('BADGE AZIENDALE'),
    header: localized(name),
    logo: {
      sourceUri:{ uri:GOOGLE_WALLET_LOGO_URL },
      contentDescription:localized('Logo Leone Consulting')
    },
    hexBackgroundColor:'#141414',
    barcode:{ type:'QR_CODE', value:verifyUrl, alternateText:code },
    textModulesData:[
      { id:'ruolo', header:'RUOLO', body:role || 'Collaboratore' },
      { id:'numero_badge', header:'N. BADGE', body:code },
      { id:'validita', header:'VALIDO FINO AL', body:formatItalianDate(badge?.expiresAt) },
      { id:'emittente', header:'EMITTENTE', body:'Leone Consulting di Leonardo Angelucci' }
    ],
    linksModuleData:{
      uris:[{ id:'verifica_ufficiale', uri:verifyUrl, description:'Verifica ufficiale del badge' }]
    }
  }

  const start = dateOnlyToIso(badge?.issuedAt, false)
  const end = dateOnlyToIso(badge?.expiresAt, true)
  if(start || end){
    object.validTimeInterval = {}
    if(start) object.validTimeInterval.start = { date:start }
    if(end) object.validTimeInterval.end = { date:end }
  }
  if(end) object.notifications = { expiryNotification:{ enableNotification:true } }
  return object
}

function buildSaveUrl(credentials, object){
  const claims = {
    iss: credentials.client_email,
    aud:'google',
    origins:['https://portale.leoneconsultingitalia.it'],
    typ:'savetowallet',
    iat:Math.floor(Date.now()/1000),
    payload:{ genericObjects:[{ id:object.id, classId:object.classId }] }
  }
  return `https://pay.google.com/gp/v/save/${signJwt(credentials, claims)}`
}

function request(url, options = {}){
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const body = options.body == null
      ? null
      : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
    const headers = { ...(options.headers || {}) }
    if(body && headers['Content-Length'] == null) headers['Content-Length'] = String(body.length)
    const req = https.request({
      protocol:parsed.protocol,
      hostname:parsed.hostname,
      port:parsed.port || undefined,
      path:`${parsed.pathname}${parsed.search}`,
      method:options.method || 'GET',
      headers,
      timeout:30000
    }, res => {
      const chunks=[]
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        if(text){ try{ data=JSON.parse(text) }catch(_){ data=text } }
        resolve({ status:Number(res.statusCode || 0), data, headers:res.headers })
      })
    })
    req.on('timeout',()=>req.destroy(new Error('Google Wallet non ha risposto entro 30 secondi.')))
    req.on('error',reject)
    if(body) req.write(body)
    req.end()
  })
}

function googleError(response, fallback){
  const message = response?.data?.error?.message || response?.data?.error_description || (typeof response?.data === 'string' ? response.data : '')
  const code = response?.status ? ` (HTTP ${response.status})` : ''
  if(response?.status === 403 && /api.*not.*enabled|has not been used|disabled/i.test(message)){
    return new Error('La Google Wallet API non è ancora abilitata nel progetto Google Cloud. Apri “API e servizi”, abilita Google Wallet API e riprova tra qualche minuto.')
  }
  if(response?.status === 403){
    return new Error(`L’account di servizio non è autorizzato come Developer nell’emittente Google Wallet.${message ? `\n${message}` : ''}`)
  }
  if(response?.status === 404 && /class/i.test(message)){
    return new Error(`Google non trova la classe ${GOOGLE_WALLET_CLASS_ID}. Controlla che sia stata creata nello stesso emittente.`)
  }
  return new Error(`${fallback}${code}${message ? `\n${message}` : ''}`)
}

async function getAccessToken(credentials){
  const now = Date.now()
  if(tokenCache && tokenCache.email === credentials.client_email && tokenCache.expiresAt > now + 60000){
    return tokenCache.token
  }
  const iat = Math.floor(now/1000)
  const assertion = signJwt(credentials, {
    iss:credentials.client_email,
    scope:GOOGLE_WALLET_SCOPE,
    aud:GOOGLE_TOKEN_URL,
    iat,
    exp:iat+3600
  })
  const form = new URLSearchParams({
    grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  }).toString()
  const response = await request(GOOGLE_TOKEN_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body:form
  })
  if(response.status < 200 || response.status >= 300 || !response.data?.access_token){
    throw googleError(response, 'Google non ha accettato la chiave dell’account di servizio.')
  }
  const expiresIn = Math.max(60, Number(response.data.expires_in || 3600))
  tokenCache = { email:credentials.client_email, token:response.data.access_token, expiresAt:now+(expiresIn*1000) }
  return tokenCache.token
}

async function walletRequest(credentials, url, method, body){
  const token = await getAccessToken(credentials)
  const response = await request(url, {
    method,
    headers:{
      Authorization:`Bearer ${token}`,
      Accept:'application/json',
      ...(body == null ? {} : {'Content-Type':'application/json'})
    },
    body
  })
  return response
}

async function upsertGoogleWalletObject(credentials, object){
  const resourceUrl = `${GOOGLE_OBJECTS_URL}/${encodeURIComponent(object.id)}`
  const existing = await walletRequest(credentials, resourceUrl, 'GET')
  let response
  if(existing.status === 404){
    response = await walletRequest(credentials, GOOGLE_OBJECTS_URL, 'POST', object)
    if(response.status === 409) response = await walletRequest(credentials, resourceUrl, 'PUT', object)
  }else if(existing.status >= 200 && existing.status < 300){
    response = await walletRequest(credentials, resourceUrl, 'PUT', object)
  }else{
    throw googleError(existing, 'Non è stato possibile controllare il badge su Google Wallet.')
  }
  if(response.status < 200 || response.status >= 300){
    throw googleError(response, 'Non è stato possibile creare o aggiornare il badge su Google Wallet.')
  }
  return response.data
}

async function revokeGoogleWalletObject(credentials, objectId){
  if(!String(objectId || '').startsWith(`${GOOGLE_WALLET_ISSUER_ID}.`)) throw new Error('ID Google Wallet non valido.')
  const resourceUrl = `${GOOGLE_OBJECTS_URL}/${encodeURIComponent(objectId)}`
  const response = await walletRequest(credentials, resourceUrl, 'PATCH', { state:'INACTIVE' })
  if(response.status === 404) return { id:objectId, state:'INACTIVE', alreadyMissing:true }
  if(response.status < 200 || response.status >= 300){
    throw googleError(response, 'Non è stato possibile revocare il badge su Google Wallet.')
  }
  return response.data
}

module.exports = {
  GOOGLE_WALLET_ISSUER_ID,
  GOOGLE_WALLET_CLASS_ID,
  GOOGLE_WALLET_LOGO_URL,
  validateServiceAccount,
  buildGoogleWalletObject,
  buildSaveUrl,
  upsertGoogleWalletObject,
  revokeGoogleWalletObject,
  signJwt
}
