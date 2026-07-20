const { ipcMain, shell } = require('electron')
const nodemailer = require('nodemailer')
const { execFile } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

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

  return new Promise((resolve, reject) => {
    execFile('python3', [scriptPath, tipo, datiJson, outputPath, conTimbro ? 'timbro' : ''], 
      { env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' } },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }
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
    )
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
    'main.js',
    'preload.js',
    'ipc-handlers.js',
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
    { url: '/sheiiwe/leone-cloud/main/compila_documento.py', dest: path.join(baseDir, 'compila_documento.py') },
    { url: '/sheiiwe/leone-cloud/main/compila_pdf.py', dest: path.join(baseDir, 'compila_pdf.py') },
    { url: '/sheiiwe/leone-cloud/main/fill_pdf_form_with_annotations.py', dest: path.join(baseDir, 'fill_pdf_form_with_annotations.py') },
    { url: '/sheiiwe/leone-cloud/main/ipc-handlers.js', dest: path.join(baseDir, 'ipc-handlers.js') },
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
