const { ipcMain, shell } = require('electron')
const { transportEmail, transportPEC } = require('./email-server')
const { execFile } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const fromAddr = (via) => via === 'pec'
  ? '"Leone Consulting" <amministratore@pec.leoneconsultingitalia.it>'
  : '"Leone Consulting" <amministrazione@leoneconsultingitalia.it>'

const transport = (via) => via === 'pec' ? transportPEC : transportEmail

// ── INVIA CONTRATTO PER FIRMA ──────────────────────────────────
ipcMain.handle('send-contract', async (event, { to, name, contractType, signToken, via }) => {
  const signUrl = `https://sheiiwe.github.io/leone-cloud/sign.html?token=${signToken}`
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a18">
  <div style="background:#185FA5;padding:24px;text-align:center"><h1 style="color:#fff;margin:0">Leone Consulting</h1><p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">di Leonardo Angelucci</p></div>
  <div style="padding:32px 24px">
    <p>Gentile <strong>${name}</strong>,</p>
    <p>Le inviamo il <strong>${contractType}</strong> da sottoscrivere.</p>
    <div style="text-align:center;margin:32px 0"><a href="${signUrl}" style="background:#185FA5;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:600">✍️ Leggi e firma il contratto</a></div>
    <p style="font-size:12px;color:#888">Il link è valido per 30 giorni. Per info: amministrazione@leoneconsultingitalia.it</p>
  </div>
  <div style="background:#f5f5f0;padding:16px 24px;font-size:11px;color:#888;text-align:center">Leone Consulting di Leonardo Angelucci · Via Pia 42, 00049 Velletri (RM) · P.IVA 18231181001</div>
  </body></html>`
  const info = await transport(via).sendMail({ from: fromAddr(via), to, subject: `${contractType} — Leone Consulting: firma richiesta`, html })
  return { success: true, messageId: info.messageId }
})

// ── INVIA REPORT / BONUS ──────────────────────────────────────
ipcMain.handle('send-report', async (event, { to, name, reportHtml, mese, via }) => {
  await transport(via).sendMail({
    from: fromAddr(via), to,
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
ipcMain.handle('invia-email-collaboratore', async (event, { emailCollaboratore, nomeProdotto, lead }) => {
  try {
    const { transportEmail } = require('./email-server')
    await transportEmail.sendMail({
      from: '"Leone Consulting" <amministrazione@leoneconsultingitalia.it>',
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
ipcMain.handle('sendMail', async (event, { to, subject, html }) => {
  try {
    await transportEmail.sendMail({
      from: '"Leone Consulting" <amministrazione@leoneconsultingitalia.it>',
      to, subject, html
    })
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
