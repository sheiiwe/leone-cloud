'use strict'

const assert = require('assert')
const crypto = require('crypto')
const wallet = require('../google-wallet')

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}
})
const credentials = {
  type:'service_account',
  client_email:'wallet-test@example.iam.gserviceaccount.com',
  project_id:'wallet-test',
  private_key:privateKey
}

wallet.validateServiceAccount(credentials)
const object = wallet.buildGoogleWalletObject({
  code:'LC-ADM-001',
  name:'Leonardo Angelucci',
  role:'Amministratore',
  issuedAt:'2026-08-12',
  expiresAt:'2029-07-19',
  active:true
})
assert.equal(object.id,'338000000023187800.LC-ADM-001')
assert.equal(object.classId,wallet.GOOGLE_WALLET_CLASS_ID)
assert.equal(object.barcode.value,'https://verifica.leoneconsultingitalia.it/LC-ADM-001')
assert.equal(object.state,'ACTIVE')

const saveUrl = wallet.buildSaveUrl(credentials,object)
assert.ok(saveUrl.startsWith('https://pay.google.com/gp/v/save/'))
const token = saveUrl.split('/').pop()
const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8'))
assert.deepEqual(payload.payload.genericObjects,[{id:object.id,classId:object.classId}])
assert.equal(payload.iss,credentials.client_email)
assert.equal(payload.aud,'google')

assert.throws(()=>wallet.validateServiceAccount({}),/account di servizio/)
assert.throws(()=>wallet.buildGoogleWalletObject({code:'!',name:'Test'}),/codice/)
console.log('Google Wallet tests: OK')
