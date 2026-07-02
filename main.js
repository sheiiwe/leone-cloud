const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')
const fs = require('fs')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'default',
    backgroundColor: '#f5f5f0',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
  mainWindow.once('ready-to-show', () => mainWindow.show())

  // Console sviluppatori: Cmd+Option+I
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if(input.meta && input.alt && input.key === 'i'){
      mainWindow.webContents.toggleDevTools()
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createDesktopAlias() {
  try {
    const exePath = app.getPath('exe')
    if (!exePath.includes('.app')) return
    const appBundlePath = exePath.split('.app')[0] + '.app'
    const desktop = path.join(os.homedir(), 'Desktop')
    const aliasPath = path.join(desktop, 'Leone Consulting.app')
    const flagFile = path.join(os.homedir(), '.leone_desktop_created')
    if (fs.existsSync(flagFile)) return
    if (fs.existsSync(aliasPath)) return
    execSync(`ln -sf "${appBundlePath}" "${aliasPath}"`)
    fs.writeFileSync(flagFile, '1')
  } catch (e) { console.log('Desktop shortcut skipped:', e.message) }
}

const menuTemplate = [
  { label: app.name, submenu: [
    { role: 'about', label: 'Informazioni su Leone Consulting' },
    { type: 'separator' },
    { role: 'services', label: 'Servizi' },
    { type: 'separator' },
    { role: 'hide', label: 'Nascondi' },
    { role: 'hideOthers', label: 'Nascondi gli altri' },
    { role: 'unhide', label: 'Mostra tutto' },
    { type: 'separator' },
    { role: 'quit', label: 'Esci' },
  ]},
  { label: 'Modifica', submenu: [
    { role: 'undo', label: 'Annulla' }, { role: 'redo', label: 'Ripristina' },
    { type: 'separator' },
    { role: 'cut', label: 'Taglia' }, { role: 'copy', label: 'Copia' },
    { role: 'paste', label: 'Incolla' }, { role: 'selectAll', label: 'Seleziona tutto' },
  ]},
  { label: 'Visualizza', submenu: [
    { role: 'reload', label: 'Ricarica' }, { type: 'separator' },
    { role: 'togglefullscreen', label: 'Schermo intero' },
    { role: 'toggleDevTools', label: 'Strumenti sviluppatore' },
    { role: 'resetZoom', label: 'Dimensione originale' },
    { role: 'zoomIn', label: 'Ingrandisci' }, { role: 'zoomOut', label: 'Riduci' },
  ]},
  { label: 'Finestra', submenu: [
    { role: 'minimize', label: 'Riduci a icona' }, { role: 'zoom', label: 'Zoom' },
    { type: 'separator' }, { role: 'front', label: 'Porta in primo piano' },
  ]},
]

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'))
    createDesktopAlias()
  }
  require('./ipc-handlers')
  try { app.setLoginItemSettings({ openAtLogin: true }) } catch (e) {}
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
