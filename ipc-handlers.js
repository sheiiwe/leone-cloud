const { ipcMain, shell, dialog } = require('electron')
const nodemailer = require('nodemailer')
const { execFile } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')
const crypto = require('crypto')
const https = require('https')
// Tenuto qui (oltre che nel modulo testabile google-wallet.js) per mantenere
// compatibile l'aggiornamento automatico già installato sui Mac: le versioni
// precedenti scaricano ipc-handlers.js ma non conoscono ancora il nuovo file.
const GOOGLE_WALLET_ISSUER_ID = '338000000023187800'
const GOOGLE_WALLET_CLASS_ID = `${GOOGLE_WALLET_ISSUER_ID}.leone_badge_aziendale_v1`
const GOOGLE_WALLET_SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_OBJECTS_URL = 'https://walletobjects.googleapis.com/walletobjects/v1/genericObject'
const GOOGLE_CLASSES_URL = 'https://walletobjects.googleapis.com/walletobjects/v1/genericClass'
const GOOGLE_WALLET_LOGO_URL = 'https://verifica.leoneconsultingitalia.it/assets/google-wallet-logo.png'
let _googleWalletTokenCache = null

function _gwBase64url(value){
  return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')
}
function _gwSignJwt(credentials, claims){
  const header={alg:'RS256',typ:'JWT'}
  if(credentials.private_key_id) header.kid=credentials.private_key_id
  const unsigned=`${_gwBase64url(JSON.stringify(header))}.${_gwBase64url(JSON.stringify(claims))}`
  return `${unsigned}.${_gwBase64url(crypto.sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key))}`
}
function validateServiceAccount(credentials){
  if(!credentials || credentials.type!=='service_account') throw new Error('Il file selezionato non è una chiave JSON di un account di servizio Google.')
  if(!/^[^@\s]+@[^@\s]+[.]iam[.]gserviceaccount[.]com$/.test(String(credentials.client_email||''))) throw new Error('Nel JSON manca una e-mail valida dell’account di servizio Google.')
  if(!String(credentials.private_key||'').includes('BEGIN PRIVATE KEY')) throw new Error('Nel JSON manca la chiave privata dell’account di servizio Google.')
  if(!credentials.project_id) throw new Error('Nel JSON manca l’ID del progetto Google Cloud.')
  return credentials
}
function _gwLocalized(value){ return {defaultValue:{language:'it-IT',value:String(value||'')}} }
function _gwDateIso(value,end){
  const raw=String(value||'').trim(); if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d=new Date(`${raw}T${end?'23:59:59':'00:00:00'}+02:00`); return Number.isNaN(d.getTime())?null:d.toISOString()
}
function _gwItDate(value){
  const m=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/); return m?`${m[3]}/${m[2]}/${m[1]}`:'—'
}
function _gwObjectSuffix(code){
  const s=String(code||'').trim().replace(/[^A-Za-z0-9._-]/g,'_')
  if(!/^[A-Za-z0-9._-]{3,80}$/.test(s)) throw new Error('Il codice del tesserino non è valido per Google Wallet.')
  return s
}
function buildGoogleWalletObject(badge){
  const code=String(badge?.code||'').trim(), name=String(badge?.name||'').trim()
  const role=String(badge?.role||badge?.type||'Collaboratore').trim()
  if(!name) throw new Error('Nel tesserino manca il nome della persona.')
  const object={
    id:`${GOOGLE_WALLET_ISSUER_ID}.${_gwObjectSuffix(code)}`,
    classId:GOOGLE_WALLET_CLASS_ID,
    state:badge?.active===false?'INACTIVE':'ACTIVE',
    cardTitle:_gwLocalized('Leone Consulting'),subheader:_gwLocalized('BADGE AZIENDALE'),header:_gwLocalized(name),
    logo:{sourceUri:{uri:GOOGLE_WALLET_LOGO_URL},contentDescription:_gwLocalized('Logo Leone Consulting')},
    hexBackgroundColor:'#141414',
    barcode:{type:'QR_CODE',value:`https://verifica.leoneconsultingitalia.it/${encodeURIComponent(code)}`,alternateText:code},
    textModulesData:[
      {id:'ruolo',header:'RUOLO',body:role||'Collaboratore'},
      {id:'numero_badge',header:'N. BADGE',body:code},
      {id:'prova_nft',header:'PROVA NFT',body:badge?.nftTokenId?`Polygon · NFT #${badge.nftTokenId} · non trasferibile`:'NFT obbligatorio collegato'},
      {id:'validita',header:'VALIDO FINO AL',body:_gwItDate(badge?.expiresAt)},
      {id:'emittente',header:'EMITTENTE',body:'Leone Consulting di Leonardo Angelucci'}
    ],
    linksModuleData:{uris:[
      {id:'verifica_ufficiale',uri:`https://verifica.leoneconsultingitalia.it/${encodeURIComponent(code)}`,description:'Verifica ufficiale del badge e NFT'},
      ...(/^https:\/\//.test(String(badge?.nftExplorerUrl||''))?[{id:'prova_nft_polygon',uri:String(badge.nftExplorerUrl),description:'Prova NFT su Polygon'}]:[])
    ]}
  }
  const start=_gwDateIso(badge?.issuedAt,false), end=_gwDateIso(badge?.expiresAt,true)
  if(start||end){ object.validTimeInterval={}; if(start)object.validTimeInterval.start={date:start}; if(end)object.validTimeInterval.end={date:end} }
  if(end) object.notifications={expiryNotification:{enableNotification:true}}
  return object
}
function buildSaveUrl(credentials,object){
  const claims={iss:credentials.client_email,aud:'google',origins:['https://portale.leoneconsultingitalia.it'],typ:'savetowallet',iat:Math.floor(Date.now()/1000),payload:{genericObjects:[{id:object.id,classId:object.classId}]}}
  return `https://pay.google.com/gp/v/save/${_gwSignJwt(credentials,claims)}`
}
function _gwRequest(url,options={}){
  return new Promise((resolve,reject)=>{
    const parsed=new URL(url), body=options.body==null?null:Buffer.from(typeof options.body==='string'?options.body:JSON.stringify(options.body))
    const headers={...(options.headers||{})}; if(body&&headers['Content-Length']==null) headers['Content-Length']=String(body.length)
    const req=https.request({protocol:parsed.protocol,hostname:parsed.hostname,port:parsed.port||undefined,path:`${parsed.pathname}${parsed.search}`,method:options.method||'GET',headers,timeout:30000},res=>{
      const chunks=[]; res.on('data',c=>chunks.push(c)); res.on('end',()=>{ const text=Buffer.concat(chunks).toString('utf8'); let data=null; if(text){try{data=JSON.parse(text)}catch(_){data=text}} resolve({status:Number(res.statusCode||0),data,headers:res.headers}) })
    })
    req.on('timeout',()=>req.destroy(new Error('Google Wallet non ha risposto entro 30 secondi.'))); req.on('error',reject); if(body)req.write(body); req.end()
  })
}
function _gwError(response,fallback){
  const message=response?.data?.error?.message||response?.data?.error_description||(typeof response?.data==='string'?response.data:'')
  const code=response?.status?` (HTTP ${response.status})`:''
  if(response?.status===403&&/api.*not.*enabled|has not been used|disabled/i.test(message)) return new Error('La Google Wallet API non è ancora abilitata nel progetto Google Cloud. Apri “API e servizi”, abilita Google Wallet API e riprova tra qualche minuto.')
  if(response?.status===403) return new Error(`L’account di servizio non è autorizzato come Developer nell’emittente Google Wallet.${message?`\n${message}`:''}`)
  if(response?.status===404&&/class/i.test(message)) return new Error(`Google non trova la classe ${GOOGLE_WALLET_CLASS_ID}. Controlla che sia stata creata nello stesso emittente.`)
  return new Error(`${fallback}${code}${message?`\n${message}`:''}`)
}
async function _gwAccessToken(credentials){
  const now=Date.now(); if(_googleWalletTokenCache&&_googleWalletTokenCache.email===credentials.client_email&&_googleWalletTokenCache.expiresAt>now+60000)return _googleWalletTokenCache.token
  const iat=Math.floor(now/1000), assertion=_gwSignJwt(credentials,{iss:credentials.client_email,scope:GOOGLE_WALLET_SCOPE,aud:GOOGLE_TOKEN_URL,iat,exp:iat+3600})
  const form=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()
  const response=await _gwRequest(GOOGLE_TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form})
  if(response.status<200||response.status>=300||!response.data?.access_token) throw _gwError(response,'Google non ha accettato la chiave dell’account di servizio.')
  const expiresIn=Math.max(60,Number(response.data.expires_in||3600)); _googleWalletTokenCache={email:credentials.client_email,token:response.data.access_token,expiresAt:now+(expiresIn*1000)}
  return _googleWalletTokenCache.token
}
async function _gwWalletRequest(credentials,url,method,body){
  const token=await _gwAccessToken(credentials)
  return _gwRequest(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body==null?{}:{'Content-Type':'application/json'})},body})
}
async function statoGoogleWallet(credentials){
  const response=await _gwWalletRequest(credentials,`${GOOGLE_CLASSES_URL}/${encodeURIComponent(GOOGLE_WALLET_CLASS_ID)}`,'GET')
  if(response.status===404){
    return {configured:true,classReady:false,classId:GOOGLE_WALLET_CLASS_ID,email:credentials.client_email,projectId:credentials.project_id}
  }
  if(response.status<200||response.status>=300) throw _gwError(response,'Non è stato possibile verificare la configurazione Google Wallet.')
  return {
    configured:true,classReady:true,classId:GOOGLE_WALLET_CLASS_ID,
    classReviewStatus:response.data?.reviewStatus||null,
    email:credentials.client_email,projectId:credentials.project_id
  }
}
async function ensureGoogleWalletClass(credentials){
  const stato=await statoGoogleWallet(credentials)
  if(stato.classReady) return stato
  let response=await _gwWalletRequest(credentials,GOOGLE_CLASSES_URL,'POST',{
    id:GOOGLE_WALLET_CLASS_ID,
    issuerName:'Leone Consulting di Leonardo Angelucci',
    reviewStatus:'UNDER_REVIEW'
  })
  if(response.status===409) return statoGoogleWallet(credentials)
  if(response.status<200||response.status>=300) throw _gwError(response,'Non è stato possibile creare la classe Google Wallet.')
  return {
    configured:true,classReady:true,classId:GOOGLE_WALLET_CLASS_ID,
    classReviewStatus:response.data?.reviewStatus||'UNDER_REVIEW',
    email:credentials.client_email,projectId:credentials.project_id
  }
}
async function upsertGoogleWalletObject(credentials,object){
  const resourceUrl=`${GOOGLE_OBJECTS_URL}/${encodeURIComponent(object.id)}`, existing=await _gwWalletRequest(credentials,resourceUrl,'GET'); let response
  if(existing.status===404){ response=await _gwWalletRequest(credentials,GOOGLE_OBJECTS_URL,'POST',object); if(response.status===409)response=await _gwWalletRequest(credentials,resourceUrl,'PUT',object) }
  else if(existing.status>=200&&existing.status<300) response=await _gwWalletRequest(credentials,resourceUrl,'PUT',object)
  else throw _gwError(existing,'Non è stato possibile controllare il badge su Google Wallet.')
  if(response.status<200||response.status>=300) throw _gwError(response,'Non è stato possibile creare o aggiornare il badge su Google Wallet.')
  return response.data
}
async function revokeGoogleWalletObject(credentials,objectId){
  if(!String(objectId||'').startsWith(`${GOOGLE_WALLET_ISSUER_ID}.`)) throw new Error('ID Google Wallet non valido.')
  const response=await _gwWalletRequest(credentials,`${GOOGLE_OBJECTS_URL}/${encodeURIComponent(objectId)}`,'PATCH',{state:'INACTIVE'})
  if(response.status===404)return{id:objectId,state:'INACTIVE',alreadyMissing:true}
  if(response.status<200||response.status>=300)throw _gwError(response,'Non è stato possibile revocare il badge su Google Wallet.')
  return response.data
}

const execFileAsync = (file, args, options = {}) => new Promise((resolve, reject) => {
  execFile(file, args, options, (error, stdout, stderr) => {
    if (error) {
      error.message = `${error.message}${stderr ? `\n${stderr}` : ''}`
      reject(error)
    } else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
})

const walletDir = () => path.join(os.homedir(), 'Documents', 'Leone Consulting', 'Wallet')
const walletPaths = () => ({
  dir: walletDir(),
  key: path.join(walletDir(), 'LeoneWallet.key'),
  cert: path.join(walletDir(), 'LeoneWallet.cer'),
  wwdrDer: path.join(walletDir(), 'AppleWWDRCAG4.cer'),
  wwdrPem: path.join(walletDir(), 'AppleWWDRCAG4.pem'),
  googleCredentials: path.join(walletDir(), 'GoogleWalletServiceAccount.json'),
})

function leggiCredenzialiGoogleWallet(){
  const p=walletPaths()
  if(!fs.existsSync(p.googleCredentials)){
    throw new Error('Account Google Wallet non configurato. Premi “Configura Google Wallet” e seleziona il file JSON scaricato da Google Cloud.')
  }
  let credentials
  try{ credentials=JSON.parse(fs.readFileSync(p.googleCredentials,'utf8')) }
  catch(_){ throw new Error('Il file locale delle credenziali Google Wallet non è un JSON valido. Configuralo di nuovo.') }
  return validateServiceAccount(credentials)
}

async function certToPem(certPath, outputPath){
  try { await execFileAsync('/usr/bin/openssl', ['x509','-inform','DER','-in',certPath,'-out',outputPath]) }
  catch (_) { await execFileAsync('/usr/bin/openssl', ['x509','-in',certPath,'-out',outputPath]) }
}

function downloadFile(url, destination){
  return new Promise((resolve, reject) => {
    const get = (current) => https.get(current, { headers:{ 'User-Agent':'Leone Consulting Wallet' } }, res => {
      if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){ res.resume(); get(new URL(res.headers.location,current).toString()); return }
      if(res.statusCode !== 200){ res.resume(); reject(new Error(`Download certificato Apple: HTTP ${res.statusCode}`)); return }
      const tmp=destination+'.tmp'; const out=fs.createWriteStream(tmp)
      res.pipe(out); out.on('finish',()=>out.close(()=>{ fs.renameSync(tmp,destination); resolve(destination) }))
      out.on('error',reject)
    }).on('error',reject)
    get(url)
  })
}

async function preparaFirmaApple(){
  const p=walletPaths(); fs.mkdirSync(p.dir,{recursive:true,mode:0o700})
  if(!fs.existsSync(p.key)) throw new Error(`Chiave privata non trovata:\n${p.key}`)
  if(!fs.existsSync(p.cert)){
    const candidates=[path.join(p.dir,'pass.cer'),path.join(os.homedir(),'Downloads','pass.cer')]
    const found=candidates.find(x=>fs.existsSync(x))
    if(found) fs.copyFileSync(found,p.cert)
  }
  if(!fs.existsSync(p.cert)) throw new Error('Certificato Wallet non configurato. Premi “Configura certificato Apple” e seleziona pass.cer.')
  if(!fs.existsSync(p.wwdrDer)) await downloadFile('https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer',p.wwdrDer)
  if(!fs.existsSync(p.wwdrPem)) await certToPem(p.wwdrDer,p.wwdrPem)

  const certPem=path.join(p.dir,'LeoneWallet.pem'); await certToPem(p.cert,certPem)
  const subject=(await execFileAsync('/usr/bin/openssl',['x509','-in',certPem,'-noout','-subject'])).stdout
  if(!subject.includes('pass.it.leoneconsulting.badge')) throw new Error('Il certificato selezionato non appartiene a pass.it.leoneconsulting.badge.')
  const certPub=(await execFileAsync('/usr/bin/openssl',['x509','-in',certPem,'-pubkey','-noout'])).stdout.replace(/\s/g,'')
  const keyPub=(await execFileAsync('/usr/bin/openssl',['pkey','-in',p.key,'-pubout'])).stdout.replace(/\s/g,'')
  if(certPub!==keyPub) throw new Error('Il certificato non corrisponde alla chiave LeoneWallet.key creata su questo Mac.')
  return {...p,certPem}
}

// Trasporti email DINAMICI: le credenziali arrivano da Impostazioni (cloud).
// Fallback sicuro al vecchio email-server.js SOLO se il file esiste ancora.
let _t = { email: null, pec: null }
let _fromUser = { email: 'amministrazione@leoneconsultingitalia.it', pec: 'amministratore@pec.leoneconsultingitalia.it' }
try {
  const legacy = require('./email-server')
  _t.email = legacy.transportEmail || null
  _t.pec = legacy.transportPEC || null
} catch (e) { /* email-server.js non presente: si usa la config da Impostazioni */ }

ipcMain.handle('set-email-config', (event, cfg) => {
  try {
    if (cfg && cfg.smtp && cfg.smtp.host && cfg.smtp.user) {
      _t.email = nodemailer.createTransport({ host: cfg.smtp.host, port: Number(cfg.smtp.port) || 465, secure: true, auth: { user: cfg.smtp.user, pass: cfg.smtp.pass } })
      _fromUser.email = cfg.smtp.user
    }
    if (cfg && cfg.pec && cfg.pec.host && cfg.pec.user) {
      _t.pec = nodemailer.createTransport({ host: cfg.pec.host, port: Number(cfg.pec.port) || 465, secure: true, auth: { user: cfg.pec.user, pass: cfg.pec.pass } })
      _fromUser.pec = cfg.pec.user
    }
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

// ── APPLE WALLET: la chiave privata rimane esclusivamente sul Mac ───────────
ipcMain.handle('configura-apple-wallet', async () => {
  try{
    const p=walletPaths(); fs.mkdirSync(p.dir,{recursive:true,mode:0o700})
    const result=await dialog.showOpenDialog({
      title:'Seleziona il certificato Apple Wallet pass.cer',
      defaultPath:path.join(os.homedir(),'Downloads'),
      properties:['openFile'],
      filters:[{name:'Certificato Apple',extensions:['cer','pem']}]
    })
    if(result.canceled||!result.filePaths[0]) return {ok:false,canceled:true}
    fs.copyFileSync(result.filePaths[0],p.cert)
    await preparaFirmaApple()
    return {ok:true,certificato:p.cert,chiave:p.key}
  }catch(e){ return {ok:false,errore:e.message||String(e)} }
})

// ── GOOGLE WALLET: il JSON viene copiato in una cartella privata del Mac ───
ipcMain.handle('configura-google-wallet', async () => {
  try{
    const p=walletPaths(); fs.mkdirSync(p.dir,{recursive:true,mode:0o700})
    const result=await dialog.showOpenDialog({
      title:'Seleziona la chiave JSON dell’account di servizio Google Wallet',
      defaultPath:path.join(os.homedir(),'Downloads'),
      properties:['openFile'],
      filters:[{name:'Chiave account di servizio Google',extensions:['json']}]
    })
    if(result.canceled||!result.filePaths[0]) return {ok:false,canceled:true}
    let credentials
    try{ credentials=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8')) }
    catch(_){ throw new Error('Il file selezionato non è un JSON valido.') }
    validateServiceAccount(credentials)
    const source=path.resolve(result.filePaths[0]), destination=path.resolve(p.googleCredentials)
    if(source!==destination){
      const tmp=`${p.googleCredentials}.tmp`
      fs.copyFileSync(source,tmp)
      fs.chmodSync(tmp,0o600)
      fs.renameSync(tmp,p.googleCredentials)
    }else fs.chmodSync(p.googleCredentials,0o600)
    const stato=await ensureGoogleWalletClass(credentials)
    return {ok:true,...stato}
  }catch(e){ return {ok:false,errore:e.message||String(e)} }
})

ipcMain.handle('stato-google-wallet', async () => {
  const p=walletPaths()
  if(!fs.existsSync(p.googleCredentials)){
    return {ok:true,configured:false,classReady:false,classId:GOOGLE_WALLET_CLASS_ID}
  }
  try{
    const credentials=leggiCredenzialiGoogleWallet()
    return {ok:true,...await statoGoogleWallet(credentials)}
  }catch(e){ return {ok:false,configured:true,classReady:false,classId:GOOGLE_WALLET_CLASS_ID,errore:e.message||String(e)} }
})

ipcMain.handle('genera-google-wallet', async (_event, badge) => {
  try{
    const credentials=leggiCredenzialiGoogleWallet()
    const object=buildGoogleWalletObject(badge)
    await upsertGoogleWalletObject(credentials,object)
    return {
      ok:true,
      objectId:object.id,
      saveUrl:buildSaveUrl(credentials,object),
      classId:GOOGLE_WALLET_CLASS_ID
    }
  }catch(e){ return {ok:false,errore:e.message||String(e)} }
})

ipcMain.handle('revoca-google-wallet', async (_event, objectId) => {
  try{
    const credentials=leggiCredenzialiGoogleWallet()
    const object=await revokeGoogleWalletObject(credentials,String(objectId||''))
    return {ok:true,objectId:object.id||String(objectId||'')}
  }catch(e){ return {ok:false,errore:e.message||String(e)} }
})

ipcMain.handle('genera-apple-wallet', async (_event, badge) => {
  let tmpRoot=''
  try{
    const code=String(badge?.code||'').trim()
    const name=String(badge?.name||'').trim()
    const role=String(badge?.role||'').trim()
    if(!/^[A-Za-z0-9_-]{3,80}$/.test(code)||!name) throw new Error('Dati del tesserino non validi.')
    const firma=await preparaFirmaApple()
    tmpRoot=fs.mkdtempSync(path.join(os.tmpdir(),'leone-wallet-'))
    const passDir=path.join(tmpRoot,'pass'); fs.mkdirSync(passDir)
    const verifyUrl=`https://verifica.leoneconsultingitalia.it/${encodeURIComponent(code)}`
    const expires=badge?.expiresAt ? new Date(`${badge.expiresAt}T23:59:59+02:00`) : null
    const pass={
      formatVersion:1,
      passTypeIdentifier:'pass.it.leoneconsulting.badge',
      serialNumber:code,
      teamIdentifier:'2QSB8C5755',
      organizationName:'Leone Consulting di Leonardo Angelucci',
      description:'Badge aziendale Leone Consulting',
      logoText:'Leone Consulting',
      foregroundColor:'rgb(255, 255, 255)',
      backgroundColor:'rgb(20, 20, 20)',
      labelColor:'rgb(242, 32, 21)',
      barcodes:[{format:'PKBarcodeFormatQR',message:verifyUrl,messageEncoding:'iso-8859-1',altText:code}],
      generic:{
        primaryFields:[{key:'name',label:'TITOLARE',value:name}],
        secondaryFields:[{key:'role',label:'RUOLO',value:role||String(badge?.type||'Collaboratore')}],
        auxiliaryFields:[
          {key:'code',label:'N. BADGE',value:code},
          {key:'expires',label:'VALIDO FINO AL',value:expires?expires.toLocaleDateString('it-IT'):'—'}
        ],
        backFields:[
          {key:'verify',label:'Verifica ufficiale',value:verifyUrl},
          {key:'nft',label:'Prova NFT non trasferibile',value:badge?.nftTokenId?`${badge?.nftNetwork||'polygon'} · NFT #${badge.nftTokenId}`:'NFT obbligatorio collegato'},
          ...(badge?.credentialCode?[{key:'credential',label:'Codice prova NFT',value:String(badge.credentialCode)}]:[]),
          ...(/^https:\/\//.test(String(badge?.nftExplorerUrl||''))?[{key:'nftExplorer',label:'Apri prova su Polygon',value:String(badge.nftExplorerUrl)}]:[]),
          {key:'issuer',label:'Emittente',value:'Leone Consulting di Leonardo Angelucci'},
          {key:'contact',label:'Assistenza',value:'amministrazione@leoneconsultingitalia.it'}
        ]
      },
      ...(expires&&!Number.isNaN(expires.getTime())?{expirationDate:expires.toISOString()}:{}),
      userInfo:{badgeCode:code,verificationUrl:verifyUrl,credentialCode:badge?.credentialCode||null,nftTokenId:badge?.nftTokenId||null}
    }
    fs.writeFileSync(path.join(passDir,'pass.json'),JSON.stringify(pass,null,2))
    const iconSource=[path.join(__dirname,'assets','icon1024.png'),path.join(__dirname,'assets','icon.png')].find(fs.existsSync)
    if(!iconSource) throw new Error('Logo dell’app non trovato.')
    await execFileAsync('/usr/bin/sips',['-z','29','29',iconSource,'--out',path.join(passDir,'icon.png')])
    await execFileAsync('/usr/bin/sips',['-z','58','58',iconSource,'--out',path.join(passDir,'icon@2x.png')])
    await execFileAsync('/usr/bin/sips',['-z','87','87',iconSource,'--out',path.join(passDir,'icon@3x.png')])

    const manifest={}
    for(const file of fs.readdirSync(passDir).sort()){
      manifest[file]=crypto.createHash('sha1').update(fs.readFileSync(path.join(passDir,file))).digest('hex')
    }
    fs.writeFileSync(path.join(passDir,'manifest.json'),JSON.stringify(manifest))
    await execFileAsync('/usr/bin/openssl',[
      'smime','-binary','-sign','-signer',firma.certPem,'-inkey',firma.key,
      '-certfile',firma.wwdrPem,'-in',path.join(passDir,'manifest.json'),
      '-out',path.join(passDir,'signature'),'-outform','DER'
    ])
    const output=path.join(tmpRoot,`Leone-${code}.pkpass`)
    await execFileAsync('/usr/bin/zip',['-q','-X','-r',output,'.'],{cwd:passDir})
    const bytes=fs.readFileSync(output)
    if(bytes.length>2*1024*1024) throw new Error('Il pass supera il limite di 2 MB.')
    return {ok:true,base64:bytes.toString('base64'),fileName:`Leone-${code}.pkpass`,size:bytes.length}
  }catch(e){ return {ok:false,errore:e.message||String(e)} }
  finally{ if(tmpRoot) try{fs.rmSync(tmpRoot,{recursive:true,force:true})}catch(_){} }
})

const fromAddr = (via) => via === 'pec'
  ? `"Leone Consulting" <${_fromUser.pec}>`
  : `"Leone Consulting" <${_fromUser.email}>`

const transport = (via) => {
  const t = via === 'pec' ? _t.pec : _t.email
  if (!t) throw new Error('Email non configurata. Vai in Impostazioni → Email & PEC e inserisci le credenziali.')
  return t
}

// Trasporto costruito dalle credenziali passate nell'invio (preferito),
// con fallback a quelle pushate / al file legacy.
const makeTransport = (via, smtp, smtpPec) => {
  const cfg = via === 'pec' ? smtpPec : smtp
  if (cfg && cfg.host && cfg.user) {
    return nodemailer.createTransport({ host: cfg.host, port: Number(cfg.port) || 465, secure: true, auth: { user: cfg.user, pass: cfg.pass } })
  }
  return transport(via)
}
const fromFor = (via, smtp, smtpPec) => {
  const cfg = via === 'pec' ? smtpPec : smtp
  if (cfg && cfg.user) return `"Leone Consulting" <${cfg.user}>`
  return fromAddr(via)
}

// ── INVIA CONTRATTO PER FIRMA ──────────────────────────────────
ipcMain.handle('send-contract', async (event, { to, name, contractType, signToken, via, smtp, smtpPec }) => {
  const signUrl = `https://firma.leoneconsultingitalia.it/?token=${signToken}`
  const isAgg = /aggiornamento/i.test(contractType || '')
  const intro = isAgg
    ? `<p>Le inviamo l'<strong>aggiornamento del contratto</strong> da sottoscrivere.</p><p style="font-size:13px;color:#555">Si tratta di un aggiornamento del contratto già in essere, che lo integra e sostituisce nelle parti modificate. La preghiamo di leggerlo e firmarlo.</p>`
    : `<p>Le inviamo il <strong>${contractType}</strong> da sottoscrivere.</p>`
  const ctaLabel = isAgg ? '✍️ Leggi e firma l\'aggiornamento' : '✍️ Leggi e firma il contratto'
  const subject = isAgg ? `Aggiornamento contratto — Leone Consulting: firma richiesta` : `${contractType} — Leone Consulting: firma richiesta`
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a18">
  <div style="background:#185FA5;padding:24px;text-align:center"><h1 style="color:#fff;margin:0">Leone Consulting</h1><p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">di Leonardo Angelucci</p></div>
  <div style="padding:32px 24px">
    <p>Gentile <strong>${name}</strong>,</p>
    ${intro}
    <div style="text-align:center;margin:32px 0"><a href="${signUrl}" style="background:#185FA5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600">${ctaLabel}</a></div>
    <p style="font-size:12px;color:#888">Il link è valido per 30 giorni. Per info: amministrazione@leoneconsultingitalia.it</p>
  </div>
  <div style="background:#f5f5f0;padding:16px 24px;font-size:11px;color:#888;text-align:center">Leone Consulting di Leonardo Angelucci · Via Pia 42, 00049 Velletri (RM) · P.IVA 18231181001</div>
  </body></html>`
  const info = await makeTransport(via, smtp, smtpPec).sendMail({ from: fromFor(via, smtp, smtpPec), to, subject, html })
  return { success: true, messageId: info.messageId }
})

// ── INVIA REPORT / BONUS ──────────────────────────────────────
ipcMain.handle('send-report', async (event, { to, name, reportHtml, mese, via, smtp, smtpPec }) => {
  await makeTransport(via, smtp, smtpPec).sendMail({
    from: fromFor(via, smtp, smtpPec), to,
    subject: `${mese} — Leone Consulting`,
    html: reportHtml,
  })
  return { success: true }
})

// ── GENERA DOCUMENTO LEGALE ─────────────────────────────────
ipcMain.handle('generate-doc', async (event, { tipo, datiJson }) => {
  const scriptPath = [
    path.join(os.homedir(), 'Downloads', 'leone-cloud', 'compila_documento.py'),
    path.join(__dirname, 'compila_documento.py'),
  ].find(p => fs.existsSync(p))
  
  if (!scriptPath) throw new Error('Script compila_documento.py non trovato')
  
  const outputPath = path.join(os.tmpdir(), `documento_${tipo}_${Date.now()}.pdf`)
  
  return new Promise((resolve, reject) => {
    execFile('python3', [scriptPath, tipo, datiJson, outputPath],
      { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' } },
      (error, stdout, stderr) => {
        if (error) { reject(new Error(stderr || error.message)); return }
        const pdfPath = stdout.trim()
        const finalPath = fs.existsSync(pdfPath) ? pdfPath : outputPath
        if (fs.existsSync(finalPath)) {
          shell.openPath(finalPath)
          resolve(finalPath)
        } else {
          reject(new Error('Documento non generato'))
        }
      }
    )
  })
})

// ── GENERA PDF PROSPETTO ──────────────────────────────────────
ipcMain.handle('generate-pdf', async (event, { tipo, datiJson, conTimbro = false }) => {
  // Cerca compila_pdf.py — prima in Downloads (dev), poi estrae dall'asar se necessario
  const homeDir = os.homedir()
  const possiblePaths = [
    path.join(homeDir, 'Downloads', 'leone-cloud', 'compila_pdf.py'),
    path.join(homeDir, 'Desktop', 'leone-cloud', 'compila_pdf.py'),
    path.join(homeDir, 'Documents', 'leone-cloud', 'compila_pdf.py'),
    path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'compila_pdf.py'),
    path.join(__dirname, 'compila_pdf.py'),
  ]

  let scriptPath = possiblePaths.find(p => {
    try { return fs.existsSync(p) } catch(e) { return false }
  })

  // Se non trovato, copia dal bundle all'esterno
  if (!scriptPath) {
    const targetDir = path.join(homeDir, '.leone_consulting')
    const targetScript = path.join(targetDir, 'compila_pdf.py')
    const targetFill = path.join(targetDir, 'fill_pdf_form_with_annotations.py')
    const targetTemplates = path.join(targetDir, 'assets', 'templates')
    const targetFields = path.join(targetDir, 'assets', 'fields')

    fs.mkdirSync(targetDir, { recursive: true })
    fs.mkdirSync(targetTemplates, { recursive: true })
    fs.mkdirSync(targetFields, { recursive: true })

    // Copia script Python
    const srcScript = path.join(app.getAppPath().replace('app.asar',''), 'compila_pdf.py')
    const srcFill = path.join(app.getAppPath().replace('app.asar',''), 'fill_pdf_form_with_annotations.py')
    if (fs.existsSync(srcScript)) fs.copyFileSync(srcScript, targetScript)
    if (fs.existsSync(srcFill)) fs.copyFileSync(srcFill, targetFill)

    // Copia templates e fields
    const srcTemplates = path.join(app.getAppPath().replace('app.asar',''), 'assets', 'templates')
    const srcFields = path.join(app.getAppPath().replace('app.asar',''), 'assets', 'fields')
    for (const dir of [[srcTemplates, targetTemplates],[srcFields, targetFields]]) {
      try {
        if (fs.existsSync(dir[0])) {
          fs.readdirSync(dir[0]).forEach(f => {
            fs.copyFileSync(path.join(dir[0],f), path.join(dir[1],f))
          })
        }
      } catch(e) {}
    }
    scriptPath = targetScript
  }

  if (!scriptPath || !fs.existsSync(scriptPath)) {
    throw new Error('Script non trovato. Assicurati che leone-cloud sia in Downloads.')
  }

  const outputPath = path.join(os.tmpdir(), `prospetto_${tipo}_${Date.now()}.pdf`)
  const pyEnv = { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' }

  const eseguiScript = () => new Promise((resolve, reject) => {
    execFile('python3', [scriptPath, tipo, datiJson, outputPath, conTimbro ? 'timbro' : ''],
      { env: pyEnv },
      (error, stdout, stderr) => {
        if (error) { reject({ error, stdout, stderr }); return }
        resolve({ stdout, stderr })
      }
    )
  })

  // Se manca una libreria Python (reportlab/Pillow/pypdf), la installo al volo e riprovo una sola volta
  const installaLibrerieMancanti = (testoErrore) => new Promise((resolve, reject) => {
    const m = /No module named '([a-zA-Z0-9_]+)'/.exec(testoErrore || '')
    const nomiPip = { reportlab: 'reportlab', PIL: 'Pillow', pypdf: 'pypdf', fitz: 'PyMuPDF' }
    const pacchetto = m ? (nomiPip[m[1]] || m[1]) : null
    if (!pacchetto) { reject(new Error(testoErrore)); return }
    execFile('python3', ['-m', 'pip', 'install', '--user', '--quiet', pacchetto], { env: pyEnv }, (err1) => {
      if (!err1) { resolve(); return }
      // ambiente "gestito esternamente": serve il flag apposito
      execFile('python3', ['-m', 'pip', 'install', '--user', '--quiet', '--break-system-packages', pacchetto], { env: pyEnv }, (err2) => {
        if (err2) { reject(new Error(`Manca la libreria Python "${pacchetto}" e non sono riuscito a installarla da solo. Apri il Terminale e lancia: python3 -m pip install --user ${pacchetto}`)); return }
        resolve()
      })
    })
  })

  return new Promise((resolve, reject) => {
    eseguiScript()
      .then(({ stdout }) => finalizza(stdout))
      .catch(({ stderr, error }) => {
        installaLibrerieMancanti(stderr || error.message)
          .then(() => eseguiScript())
          .then(({ stdout }) => finalizza(stdout))
          .catch((e2) => reject(e2 instanceof Error ? e2 : new Error(stderr || error.message)))
      })

    function finalizza(stdout) {
      const pdfPath = stdout.trim()
      if (fs.existsSync(pdfPath)) {
        shell.openPath(pdfPath)
        resolve(pdfPath)
      } else if (fs.existsSync(outputPath)) {
        shell.openPath(outputPath)
        resolve(outputPath)
      } else {
        reject(new Error('PDF non generato'))
      }
    }
  })
})

// ── SALVA COORDINATE EDITOR ────────────────────────────────────
ipcMain.handle('salva-coordinate', async (event, { docId, coords }) => {
  const scriptPath = [
    path.join(os.homedir(), 'Downloads', 'leone-cloud', 'compila_documento.py'),
    path.join(__dirname, 'compila_documento.py'),
  ].find(p => require('fs').existsSync(p))

  if (!scriptPath) return { ok: false, error: 'Script non trovato' }

  // Leggi lo script attuale
  const fs = require('fs')
  let script = fs.readFileSync(scriptPath, 'utf8')

  // Genera la funzione Python per questo documento
  const funcName = `compila_${docId.toLowerCase()}`
  const campiPy = coords.map(c =>
    `        {'p':${c.p},'x':${c.x},'y':${c.y},'v': dati.get('procacciatore',{}).get('${c.tipo}','') if '${c.tipo}' not in ('data','data_inizio','data_fine') else dati.get('${c.tipo}','')}`
  ).join(',\n')

  const newFunc = `def ${funcName}(dati, out):
    """${docId} - campi da editor visuale"""
    p = dati.get('procacciatore', {})
    campi = [
${campiPy}
    ]
    return compila_multi_page(
        os.path.join(TMPL_DIR, '${docId}.pdf'),
        campi, out
    )
`

  // Sostituisci o aggiungi la funzione
  const funcRegex = new RegExp(`def ${funcName}\\(dati, out\\):[\\s\\S]*?(?=\\ndef |\\n# Main)`)
  if (funcRegex.test(script)) {
    script = script.replace(funcRegex, newFunc)
  } else {
    script = script.replace('# Main', newFunc + '\n# Main')
  }

  // Rimuovi la versione blank se presente (shutil.copy)
  script = script.replace(
    new RegExp(`def ${funcName}\\(dati, out\\):[\\s\\S]*?shutil\\.copy[^\\n]+\\n[\\s\\S]*?return out\\n`),
    newFunc
  )

  fs.writeFileSync(scriptPath, script, 'utf8')
  return { ok: true }
})

// Apri devtools
ipcMain.handle('open-devtools', (event) => {
  event.sender.openDevTools()
})

// ── CONTROLLA AGGIORNAMENTI DA GITHUB ────────────────────────────
ipcMain.handle('controlla-aggiornamenti', async () => {
  try {
    const https = require('https')
    const pkg = require('./package.json')
    const versione_locale = pkg.version

    return new Promise((resolve) => {
      const options = {
        hostname: 'raw.githubusercontent.com',
        path: '/sheiiwe/leone-cloud/main/package.json',
        headers: { 'User-Agent': 'leone-cloud' }
      }
      https.get(options, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const remote = JSON.parse(data)
            const aggiornamento = remote.version !== versione_locale
            resolve({ aggiornamento, versione: remote.version, locale: versione_locale })
          } catch(e) {
            resolve({ aggiornamento: false, errore: 'Parsing fallito' })
          }
        })
      }).on('error', () => resolve({ aggiornamento: false, errore: 'Rete non disponibile' }))
    })
  } catch(e) {
    return { aggiornamento: false, errore: e.message }
  }
})

ipcMain.handle('installa-aggiornamento', async () => {
  const { exec } = require('child_process')
  const path = require('path')
  const scriptPath = path.join(os.homedir(), 'Downloads', 'leone-cloud', 'aggiorna.sh')
  exec(`bash "${scriptPath}"`)
  return { ok: true }
})

// ── AGGIORNAMENTO IMMEDIATO (scarica dentro l'app installata e riavvia subito) ──
ipcMain.handle('aggiorna-e-riavvia', async () => {
  const https = require('https')
  const { app } = require('electron')
  const appDir = app.getAppPath()   // .../Resources/app  (asar disattivato)

  const FILES = [
    'src/index.html',
    'assets/supabase.js',
    'main.js',
    'preload.js',
    'ipc-handlers.js',
    'google-wallet.js',
    'package.json',
    'compila_documento.py',
    'compila_pdf.py',
    'fill_pdf_form_with_annotations.py',
  ]

  const scarica = (rel) => new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'raw.githubusercontent.com',
      path: '/sheiiwe/leone-cloud/main/' + rel,
      headers: { 'User-Agent': 'leone-cloud', 'Cache-Control': 'no-cache' }
    }, (res) => {
      if (res.statusCode === 404) { resolve(null); return }          // file non presente nel repo: lo salto
      if (res.statusCode !== 200) { reject(new Error(rel + ': HTTP ' + res.statusCode)); return }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.setTimeout(20000, () => { req.destroy(new Error('Timeout su ' + rel)) })
  })

  try {
    // 1) scarico TUTTO in memoria (se qualcosa fallisce non tocco l'app installata)
    const scaricati = []
    for (const rel of FILES) {
      const buf = await scarica(rel)
      if (buf && buf.length) scaricati.push({ rel, buf })
    }
    if (!scaricati.length) throw new Error('Nessun file scaricato')

    // 2) verifico di poter scrivere dentro l'app
    const provaPath = path.join(appDir, '.perm_test')
    try { fs.writeFileSync(provaPath, 'ok'); fs.unlinkSync(provaPath) }
    catch (e) { throw new Error('Non ho i permessi per aggiornare l\u0027app in ' + appDir) }

    // 3) backup + scrittura
    for (const f of scaricati) {
      const dest = path.join(appDir, f.rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      if (fs.existsSync(dest)) { try { fs.copyFileSync(dest, dest + '.bak') } catch (e) {} }
      fs.writeFileSync(dest, f.buf)
    }

    // 4) riavvio IMMEDIATO
    setTimeout(() => { app.relaunch(); app.exit(0) }, 400)
    return { ok: true, aggiornati: scaricati.map(f => f.rel) }
  } catch (e) {
    return { ok: false, errore: e.message }
  }
})

// ── AGGIORNAMENTO RAPIDO (solo src/index.html e script Python) ──
ipcMain.handle('aggiornamento-rapido', async () => {
  const { exec } = require('child_process')
  const fs = require('fs')
  const https = require('https')
  
  // Scarica i file nella cartella Downloads/leone-cloud
  const baseDir = path.join(os.homedir(), 'Downloads', 'leone-cloud')
  const fileDaAggiornare = [
    { url: '/sheiiwe/leone-cloud/main/src/index.html', dest: path.join(baseDir, 'src', 'index.html') },
    { url: '/sheiiwe/leone-cloud/main/assets/supabase.js', dest: path.join(baseDir, 'assets', 'supabase.js') },
    { url: '/sheiiwe/leone-cloud/main/compila_documento.py', dest: path.join(baseDir, 'compila_documento.py') },
    { url: '/sheiiwe/leone-cloud/main/compila_pdf.py', dest: path.join(baseDir, 'compila_pdf.py') },
    { url: '/sheiiwe/leone-cloud/main/fill_pdf_form_with_annotations.py', dest: path.join(baseDir, 'fill_pdf_form_with_annotations.py') },
    { url: '/sheiiwe/leone-cloud/main/ipc-handlers.js', dest: path.join(baseDir, 'ipc-handlers.js') },
    { url: '/sheiiwe/leone-cloud/main/google-wallet.js', dest: path.join(baseDir, 'google-wallet.js') },
    { url: '/sheiiwe/leone-cloud/main/preload.js', dest: path.join(baseDir, 'preload.js') },
    { url: '/sheiiwe/leone-cloud/main/email-server.js', dest: path.join(baseDir, 'email-server.js') },
    { url: '/sheiiwe/leone-cloud/main/package.json', dest: path.join(baseDir, 'package.json') },
  ]

  const scaricaFile = (urlPath, dest) => new Promise((resolve, reject) => {
    const options = {
      hostname: 'raw.githubusercontent.com',
      path: urlPath,
      headers: { 'User-Agent': 'leone-cloud' }
    }
    https.get(options, (res) => {
      if(res.statusCode !== 200){ reject(new Error(`HTTP ${res.statusCode}`)); return }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, data, 'utf8')
        resolve()
      })
    }).on('error', reject)
  })

  try {
    for(const f of fileDaAggiornare){
      await scaricaFile(f.url, f.dest)
    }
    // Lancia aggiorna.sh per ricompilare
    const { exec } = require('child_process')
    const scriptPath = path.join(baseDir, 'aggiorna.sh')
    exec(`bash "${scriptPath}"`)
    return { ok: true }
  } catch(e) {
    return { ok: false, errore: e.message }
  }
})

// ── EMAIL NOTIFICA COLLABORATORE ──────────────────────────────
ipcMain.handle('invia-email-collaboratore', async (event, { emailCollaboratore, nomeProdotto, lead, smtp }) => {
  try {
    await makeTransport('email', smtp).sendMail({
      from: fromFor('email', smtp),
      to: emailCollaboratore,
      subject: `🆕 Nuovo lead per: ${nomeProdotto}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#c0392b">Nuovo lead ricevuto</h2>
          <p>È arrivato un nuovo lead per il prodotto/corso <strong>${nomeProdotto}</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Nome</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${lead.nome||'—'}</strong></td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${lead.email||'—'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Telefono</td><td style="padding:8px;border-bottom:1px solid #eee">${lead.tel||lead.telefono||'—'}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Prodotto</td><td style="padding:8px;border-bottom:1px solid #eee">${nomeProdotto}</td></tr>
            <tr><td style="padding:8px;color:#666">Note</td><td style="padding:8px">${lead.note||'—'}</td></tr>
          </table>
          <p style="margin-top:20px;color:#999;font-size:12px">Notifica automatica — Leone Consulting</p>
        </div>
      `
    })
    return { ok: true }
  } catch(e) {
    console.error('Email collaboratore error:', e)
    return { ok: false, errore: e.message }
  }
})

// ── VERSIONE APP ──────────────────────────────────────────────
ipcMain.handle('get-version', () => {
  return require('./package.json').version
})

// ── SEND MAIL GENERICO (notifiche admin firma) ────────────────
ipcMain.handle('sendMail', async (event, { to, subject, html, smtp, attachments }) => {
  try {
    const msg = { from: fromFor('email', smtp), to, subject, html }
    if (Array.isArray(attachments) && attachments.length) {
      msg.attachments = attachments.map(a => ({
        filename: a.filename,
        content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, 'base64')
      }))
    }
    await makeTransport('email', smtp).sendMail(msg)
    return { ok: true }
  } catch(e) {
    console.error('sendMail error:', e)
    return { ok: false, errore: e.message }
  }
})

// ── SUONO NOTIFICA SISTEMA ────────────────────────────────────
ipcMain.handle('suona-notifica', async () => {
  try {
    const { exec } = require('child_process')
    if(process.platform === 'darwin'){
      // Suono "Glass" di macOS - quello delle notifiche
      exec('afplay /System/Library/Sounds/Glass.aiff')
    }
    return { ok: true }
  } catch(e) {
    return { ok: false }
  }
})

// ── APRI FILE TEMPORANEO CON APP DI SISTEMA ───────────────────
ipcMain.handle('apri-file-tmp', async (event, { buffer, fileName }) => {
  try {
    const os = require('os')
    const path = require('path')
    const fs = require('fs')
    const { shell } = require('electron')
    const tmpDir = os.tmpdir()
    const tmpPath = path.join(tmpDir, fileName)
    fs.writeFileSync(tmpPath, Buffer.from(buffer))
    await shell.openPath(tmpPath)
    return { ok: true }
  } catch(e) {
    return { ok: false, errore: e.message }
  }
})

// ── SALVA FILE CON DIALOG ─────────────────────────────────────
ipcMain.handle('salva-file', async (event, { buffer, fileName }) => {
  try {
    const { dialog } = require('electron')
    const fs = require('fs')
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: fileName,
      filters: [{ name: 'Tutti i file', extensions: ['*'] }]
    })
    if(!filePath) return { ok: false }
    fs.writeFileSync(filePath, Buffer.from(buffer))
    return { ok: true }
  } catch(e) {
    return { ok: false, errore: e.message }
  }
})
