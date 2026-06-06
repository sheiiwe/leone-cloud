const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  sendContract: (data) => ipcRenderer.invoke('send-contract', data),
  sendReport:   (data) => ipcRenderer.invoke('send-report', data),
  generatePDF:  (tipo, datiJson) => ipcRenderer.invoke('generate-pdf', { tipo, datiJson }),
  generateDoc:  (tipo, datiJson) => ipcRenderer.invoke('generate-doc', { tipo, datiJson }),
  salvaCoordinate: (docId, coords) => ipcRenderer.invoke('salva-coordinate', { docId, coords }),
  openDevTools: () => ipcRenderer.invoke('open-devtools'),
  controllaAggiornamenti: () => ipcRenderer.invoke('controlla-aggiornamenti'),
  installaAggiornamento: () => ipcRenderer.invoke('installa-aggiornamento'),
  aggiornamentoRapido: () => ipcRenderer.invoke('aggiornamento-rapido'),
  inviaEmailCollaboratore: (dati) => ipcRenderer.invoke('invia-email-collaboratore', dati),
  getVersion: () => ipcRenderer.invoke('get-version'),
  sendMail: (dati) => ipcRenderer.invoke('sendMail', dati),
  suonaNotifica: () => ipcRenderer.invoke('suona-notifica'),
  apriFileTmp: (buffer, fileName) => ipcRenderer.invoke('apri-file-tmp', { buffer, fileName }),
  salvaFile: (buffer, fileName) => ipcRenderer.invoke('salva-file', { buffer, fileName }),
})
