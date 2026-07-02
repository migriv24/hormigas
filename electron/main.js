const { app, BrowserWindow, dialog, shell, ipcMain, Menu } = require('electron')
const { autoUpdater } = require('electron-updater')
const { spawn }  = require('child_process')
const path  = require('path')
const http  = require('http')
const net   = require('net')
const fs    = require('fs')
const { decryptFromFile, encryptToFile } = require('./credentials')

// ── Constants ─────────────────────────────────────────────────────────────────

const isDev = !app.isPackaged

const SPLASH_MESSAGES = [
  'llamame hormiga',
  'eso eso eso',
  '¡No contaban con mi astucia!',
  'is mayonayse an instrument?',
  'hey. you\'re awake',
  'they really added steve to smash bros?',
]

// ── Credential helpers ────────────────────────────────────────────────────────

/**
 * Does userData/settings.json exist and contain a database URL?
 * If yes, we can start Flask directly.  If no, show the landing page.
 */
function hasCredentials() {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json')
  if (!fs.existsSync(settingsPath)) return false
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    return !!(s.supabase && s.supabase.url) || !!(s.database && s.database.url)
  } catch {
    return false
  }
}

/**
 * Write the decrypted .miga payload to userData as settings.json
 * (and credentials.json for Google API access).
 */
function applyCredentials(payload) {
  const userData = app.getPath('userData')

  const credsPath = path.join(userData, 'credentials.json')
  if (payload.google_credentials) {
    fs.writeFileSync(credsPath, JSON.stringify(payload.google_credentials, null, 2))
  }

  const settings = {
    google_credentials_path: payload.google_credentials ? credsPath : '',
    google_sheet_id:         payload.google_sheet_id  || '',
    imgbb_api_key:           payload.imgbb_api_key    || '',
    log_level:               'INFO',
    cache_ttl_seconds:       300,
    translation_provider:    'google',
    supabase: {
      url:      payload.supabase_url      || '',
      anon_key: payload.supabase_anon_key || '',
    },
    database: {
      url: payload.database_url || '',
    },
    newsletter_defaults:   payload.newsletter_defaults   || {},
    render_both_languages: payload.render_both_languages || false,
    image_highlights:      payload.image_highlights      || { enabled: false },
  }

  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify(settings, null, 2)
  )
}

// ── Electron preferences (local-only, not from .miga) ────────────────────────

function getElectronPrefs() {
  const p = path.join(app.getPath('userData'), 'electron-prefs.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
}

function setElectronPref(key, value) {
  const p = path.join(app.getPath('userData'), 'electron-prefs.json')
  const prefs = getElectronPrefs()
  prefs[key] = value
  fs.writeFileSync(p, JSON.stringify(prefs, null, 2))
}

// ── Recent databases registry ────────────────────────────────────────────────

function getRecentDatabases() {
  const p = path.join(app.getPath('userData'), 'recent-databases.json')
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return [] }
}

function addRecentDatabase(filePath) {
  let recents = getRecentDatabases().filter(r => r.path !== filePath)
  recents.unshift({
    path:       filePath,
    name:       path.basename(filePath),
    lastOpened: new Date().toISOString(),
  })
  if (recents.length > 8) recents = recents.slice(0, 8)
  fs.writeFileSync(
    path.join(app.getPath('userData'), 'recent-databases.json'),
    JSON.stringify(recents, null, 2)
  )
}

// ── Free port finder ──────────────────────────────────────────────────────────

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

// ── Flask server process ───────────────────────────────────────────────────────

let flaskProcess = null
let serverPort   = null

function getServerBinary() {
  const name = process.platform === 'win32' ? 'hormiga-server.exe' : 'hormiga-server'
  return path.join(process.resourcesPath, name)
}

async function startServer() {
  serverPort = await findFreePort()
  console.log('[hormiga] Using port:', serverPort)

  return new Promise((resolve, reject) => {
    if (isDev) {
      console.log('[hormiga] Dev mode — expecting Flask on port', serverPort)
      waitForServer(serverPort, 120, 500).then(resolve).catch(reject)
      return
    }

    const binary  = getServerBinary()
    const dataDir = app.getPath('userData')

    console.log('[hormiga] Starting server binary:', binary)
    console.log('[hormiga] User data dir:', dataDir)

    if (!fs.existsSync(binary)) {
      reject(new Error(
        `Server binary not found at:\n${binary}\n\nPlease reinstall Hormiga.`
      ))
      return
    }

    const runtimeConfig = path.join(dataDir, 'hormiga-runtime.json')
    fs.writeFileSync(runtimeConfig, JSON.stringify({ port: serverPort }))

    let serverOutput = ''

    flaskProcess = spawn(binary, [], {
      cwd: dataDir,
      env: {
        ...process.env,
        HORMIGA_DATA_DIR: dataDir,
        HORMIGA_PORT:     String(serverPort),
        HORMIGA_RUNTIME:  runtimeConfig,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    flaskProcess.stdout.on('data', (data) => {
      const text = data.toString()
      serverOutput += text
      process.stdout.write('[server] ' + text)
    })

    flaskProcess.stderr.on('data', (data) => {
      const text = data.toString()
      serverOutput += text
      process.stderr.write('[server] ' + text)
    })

    flaskProcess.on('error', (err) => {
      reject(new Error(`Failed to start Hormiga server: ${err.message}`))
    })

    flaskProcess.on('exit', (code) => {
      flaskProcess = null
      if (code !== 0 && code !== null) {
        const snippet = serverOutput.slice(-800) || '(no output)'
        reject(new Error(
          `Server exited with code ${code} before becoming ready.\n\nOutput:\n${snippet}`
        ))
      }
    })

    waitForServer(serverPort, 120, 500).then(resolve).catch((err) => {
      const snippet = serverOutput.slice(-800) || '(no output — binary may have crashed silently)'
      reject(new Error(`${err.message}\n\nServer output:\n${snippet}`))
    })
  })
}

function waitForServer(port, maxAttempts, intervalMs) {
  return new Promise((resolve, reject) => {
    let attempts = 0

    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          console.log('[hormiga] Server ready on port', port)
          resolve()
        } else {
          retry()
        }
        res.resume()
      })
      req.on('error', retry)
      req.setTimeout(intervalMs, () => { req.destroy(); retry() })
    }

    const retry = () => {
      attempts++
      if (attempts >= maxAttempts) {
        reject(new Error(`Server did not respond after ${maxAttempts} attempts (port ${port})`))
      } else {
        setTimeout(check, intervalMs)
      }
    }

    check()
  })
}

function stopServer() {
  if (flaskProcess) {
    console.log('[hormiga] Stopping server')
    flaskProcess.kill()
    flaskProcess = null
  }
}

// ── Splash screen ──────────────────────────────────────────────────────────────

let splashWindow = null

function sendToSplash(event, data) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(event, data)
  }
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-splash.js'),
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
    icon: getAppIcon(),
  })

  splashWindow.loadFile(path.join(__dirname, 'splash.html'))

  splashWindow.webContents.once('did-finish-load', () => {
    const msg = SPLASH_MESSAGES[Math.floor(Math.random() * SPLASH_MESSAGES.length)]
    sendToSplash('splash-message', msg)
  })

  splashWindow.on('closed', () => { splashWindow = null })

  return splashWindow
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
}

// ── Landing page ──────────────────────────────────────────────────────────────

let landingWindow = null

function createLandingWindow() {
  landingWindow = new BrowserWindow({
    width: 520,
    height: 480,
    frame: false,
    resizable: false,
    center: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-landing.js'),
    },
    icon: getAppIcon(),
  })

  landingWindow.loadFile(path.join(__dirname, 'landing.html'))
  landingWindow.on('closed', () => { landingWindow = null })

  return landingWindow
}

function sendToLanding(event, data) {
  if (landingWindow && !landingWindow.isDestroyed()) {
    landingWindow.webContents.send(event, data)
  }
}

function closeLanding() {
  if (landingWindow && !landingWindow.isDestroyed()) landingWindow.close()
}

// ── New Database window ───────────────────────────────────────────────────────

let newDatabaseWindow = null

function createNewDatabaseWindow(parentWindow) {
  newDatabaseWindow = new BrowserWindow({
    width: 520,
    height: 600,
    parent:    parentWindow || undefined,
    modal:     !!parentWindow,
    resizable: false,
    center:    true,
    title:     'Connect to Database — Hormiga',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-new-database.js'),
    },
    icon: getAppIcon(),
  })

  newDatabaseWindow.loadFile(path.join(__dirname, 'new-database.html'))
  newDatabaseWindow.on('closed', () => { newDatabaseWindow = null })

  return newDatabaseWindow
}

function closeNewDatabase() {
  if (newDatabaseWindow && !newDatabaseWindow.isDestroyed()) newDatabaseWindow.close()
}

// ── Main window ────────────────────────────────────────────────────────────────

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--app-version=${app.getVersion()}`],
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    icon: getAppIcon(),
  })

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`)

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    closeLanding()
    mainWindow.show()
    buildAppMenu() // rebuild menu now that mainWindow exists (enables Save Database)
    if (isDev) mainWindow.webContents.openDevTools()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    buildAppMenu() // update menu state when main window closes
  })
}

function getAppIcon() {
  if (process.platform === 'win32') return path.join(__dirname, '../assets/icons/icon.ico')
  if (process.platform === 'darwin') return path.join(__dirname, '../assets/icons/icon.icns')
  return path.join(__dirname, '../assets/icons/icon.png')
}

// ── App menu ──────────────────────────────────────────────────────────────────

function buildAppMenu() {
  const hasMain = !!mainWindow

  const fileSubmenu = [
    {
      label: 'New Database…',
      accelerator: 'CmdOrCtrl+N',
      click: () => createNewDatabaseWindow(mainWindow || null),
    },
    {
      label: 'Open Database…',
      accelerator: 'CmdOrCtrl+O',
      click: () => openDatabaseFromMenu(),
    },
    {
      label: 'Save Database As…',
      accelerator: 'CmdOrCtrl+Shift+S',
      enabled: hasMain,
      click: async () => {
        const result = await doExportMiga()
        if (!result.ok && result.error !== 'Cancelled.') {
          dialog.showErrorBox('Export failed', result.error)
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Switch Database…',
      enabled: hasMain,
      click: () => {
        if (mainWindow) { stopServer(); mainWindow.close() }
        createLandingWindow()
      },
    },
    { type: 'separator' },
    { role: 'quit' },
  ]

  const template = []

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  template.push({ label: 'File', submenu: fileSubmenu })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  })

  if (isDev) {
    template.push({
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function openDatabaseFromMenu() {
  const parentWin = mainWindow || landingWindow

  const result = await dialog.showOpenDialog(parentWin, {
    title: 'Open Hormiga database file',
    filters: [{ name: 'Hormiga Database', extensions: ['miga'] }],
    properties: ['openFile'],
  })

  if (result.canceled || !result.filePaths.length) return

  const filePath = result.filePaths[0]

  let payload
  try {
    payload = decryptFromFile(filePath)
  } catch (err) {
    if (err.code === 'PASSWORD_REQUIRED') {
      const pwResult = await promptPassword(parentWin)
      if (pwResult === null) return
      try {
        payload = decryptFromFile(filePath, pwResult)
      } catch (e2) {
        dialog.showErrorBox('Could not open database', e2.message)
        return
      }
    } else {
      dialog.showErrorBox('Could not open database', err.message)
      return
    }
  }

  applyCredentials(payload)
  addRecentDatabase(filePath)

  if (mainWindow) {
    // Relaunch with new credentials
    app.relaunch()
    stopServer()
    app.quit()
  } else {
    setTimeout(() => launchAppFromLanding(), 300)
  }
}

// ── IPC — landing page ────────────────────────────────────────────────────────

ipcMain.handle('landing:open-file', async () => {
  const result = await dialog.showOpenDialog(landingWindow, {
    title: 'Open Hormiga database file',
    filters: [{ name: 'Hormiga Database', extensions: ['miga'] }],
    properties: ['openFile'],
  })

  if (result.canceled || !result.filePaths.length) return null

  const filePath = result.filePaths[0]

  try {
    const payload = decryptFromFile(filePath)
    applyCredentials(payload)
    addRecentDatabase(filePath)
    setTimeout(() => launchAppFromLanding(), 300)
    return { ok: true }
  } catch (err) {
    if (err.code === 'PASSWORD_REQUIRED') {
      return { ok: false, requiresPassword: true, filePath }
    }
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('landing:load-with-password', async (_event, filePath, password) => {
  try {
    const payload = decryptFromFile(filePath, password)
    applyCredentials(payload)
    addRecentDatabase(filePath)
    setTimeout(() => launchAppFromLanding(), 300)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('landing:open-recent', async (_event, filePath) => {
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: 'File not found: ' + filePath }
  }
  try {
    const payload = decryptFromFile(filePath)
    applyCredentials(payload)
    addRecentDatabase(filePath)
    setTimeout(() => launchAppFromLanding(), 300)
    return { ok: true }
  } catch (err) {
    if (err.code === 'PASSWORD_REQUIRED') {
      return { ok: false, requiresPassword: true, filePath }
    }
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('landing:get-recent', () => getRecentDatabases())

ipcMain.handle('landing:new-database', () => {
  createNewDatabaseWindow(landingWindow || null)
  return { ok: true }
})

/** After credentials are applied, start Flask and open the main window */
async function launchAppFromLanding() {
  sendToLanding('landing:status', 'Connecting to database…')
  try {
    await startServer()
    createWindow()
  } catch (err) {
    console.error('[hormiga] Launch failed:', err.message)
    sendToLanding('landing:status', 'Failed to start: ' + err.message)
    dialog.showErrorBox('Hormiga failed to start', err.message)
  }
}

// ── IPC — new database window ─────────────────────────────────────────────────

ipcMain.handle('new-db:pick-creds-file', async () => {
  const result = await dialog.showOpenDialog(newDatabaseWindow, {
    title: 'Select Google credentials.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  const filePath = result.filePaths[0]
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return { name: path.basename(filePath), content }
  } catch (err) {
    return null
  }
})

ipcMain.handle('new-db:submit', async (_event, data) => {
  try {
    applyCredentials(data)
    closeNewDatabase()

    if (mainWindow) {
      // Already in app — relaunch with new credentials
      app.relaunch()
      stopServer()
      app.quit()
    } else {
      // From landing — launch normally
      closeLanding()
      setTimeout(() => launchAppFromLanding(), 300)
    }

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('new-db:cancel', () => {
  closeNewDatabase()
  return { ok: true }
})

// ── IPC — file dialogs (used by resources upload, newsletter import/export) ───

ipcMain.handle('dialog:open-file', async (_event, opts = {}) => {
  const result = await dialog.showOpenDialog({
    title:      opts.title      || 'Open file',
    filters:    opts.filters    || [],
    properties: opts.properties || ['openFile'],
  })
  if (result.canceled || !result.filePaths.length) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:save-file', async (_event, opts = {}) => {
  const result = await dialog.showSaveDialog({
    title:       opts.title       || 'Save file',
    defaultPath: opts.defaultPath || undefined,
    filters:     opts.filters     || [],
  })
  if (result.canceled || !result.filePath) return null
  return result.filePath
})

ipcMain.handle('file:read-text', async (_event, filePath) => {
  try {
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('file:write-text', async (_event, filePath, text) => {
  try {
    fs.writeFileSync(filePath, text, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ── IPC — main window / settings ─────────────────────────────────────────────

ipcMain.handle('main:get-auto-open', () => {
  const prefs = getElectronPrefs()
  return prefs.auto_open_last_database !== false // default true
})

ipcMain.handle('main:set-auto-open', (_event, value) => {
  setElectronPref('auto_open_last_database', value)
  return { ok: true }
})

// ── IPC — export .miga from main window ──────────────────────────────────────

async function doExportMiga() {
  let bundle
  try {
    bundle = await fetchJson(`http://127.0.0.1:${serverPort}/api/export-miga`)
  } catch (err) {
    return { ok: false, error: 'Could not fetch credentials from server: ' + err.message }
  }

  const { response: wantsPw } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Protect with password?',
    message: 'Do you want to protect this file with a password?',
    detail: 'Password-protected files require a password to open. Recommended if sharing.',
    buttons: ['Add password', 'No password'],
    defaultId: 0,
  })

  let password = null
  if (wantsPw === 0) {
    const pwResult = await promptPassword(mainWindow)
    if (pwResult === null) return { ok: false, error: 'Cancelled.' }
    password = pwResult
  }

  const save = await dialog.showSaveDialog(mainWindow, {
    title: 'Save database file',
    defaultPath: `hormiga-${Date.now()}.miga`,
    filters: [{ name: 'Hormiga Database', extensions: ['miga'] }],
  })

  if (save.canceled) return { ok: false, error: 'Cancelled.' }

  try {
    encryptToFile(bundle, save.filePath, password)
    return { ok: true, filePath: save.filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

ipcMain.handle('main:export-miga', () => doExportMiga())

/** Prompt for a password using a minimal Electron child window */
function promptPassword(parentWindow) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 360,
      height: 180,
      parent: parentWindow,
      modal: true,
      resizable: false,
      frame: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload-password.js'),
      },
    })

    win.loadFile(path.join(__dirname, 'password.html'))

    ipcMain.handleOnce('pw:submit', (_event, value) => {
      win.close()
      resolve(value || null)
    })

    win.on('closed', () => resolve(null))
  })
}

/** Minimal fetch for Node (no extra deps — uses built-in http module) */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

// ── Auto-updater (runs during splash) ────────────────────────────────────────

function checkForUpdatesDuringSplash() {
  return new Promise((resolve) => {
    if (isDev) {
      sendToSplash('update-status', { status: 'up-to-date' })
      setTimeout(resolve, 600)
      return
    }

    let settled = false
    const settle = () => { if (!settled) { settled = true; resolve() } }

    const timeout = setTimeout(() => {
      console.log('[updater] Check timed out — continuing startup')
      sendToSplash('update-status', { status: 'up-to-date' })
      settle()
    }, 20000)

    autoUpdater.autoDownload         = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.once('checking-for-update', () => sendToSplash('update-status', { status: 'checking' }))

    autoUpdater.once('update-not-available', () => {
      clearTimeout(timeout)
      sendToSplash('update-status', { status: 'up-to-date' })
      setTimeout(settle, 700)
    })

    autoUpdater.once('update-available', (info) => {
      sendToSplash('update-status', { status: 'downloading', version: info.version, percent: 0 })
    })

    const _onProgress = (progress) => {
      sendToSplash('update-status', { status: 'downloading', percent: Math.round(progress.percent) })
    }
    autoUpdater.on('download-progress', _onProgress)

    autoUpdater.once('update-downloaded', () => {
      clearTimeout(timeout)
      autoUpdater.removeListener('download-progress', _onProgress)

      if (settled) {
        // Timeout already fired — app has started. Let autoInstallOnAppQuit handle it silently.
        console.log('[updater] Update ready — will install on next quit')
        return
      }
      sendToSplash('update-status', { status: 'installing' })
      setTimeout(() => { stopServer(); autoUpdater.quitAndInstall() }, 1800)
    })

    autoUpdater.once('error', (err) => {
      clearTimeout(timeout)
      autoUpdater.removeListener('download-progress', _onProgress)
      console.error('[updater]', err.message)
      sendToSplash('update-status', { status: 'up-to-date' })
      settle()
    })

    autoUpdater.checkForUpdates()
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  buildAppMenu()
  createSplashWindow()

  try {
    await checkForUpdatesDuringSplash()

    const prefs = getElectronPrefs()
    const autoOpen = prefs.auto_open_last_database !== false // default true

    if (autoOpen && hasCredentials()) {
      sendToSplash('update-status', { status: 'up-to-date' })
      await startServer()
      createWindow()
    } else {
      closeSplash()
      createLandingWindow()
    }
  } catch (err) {
    console.error('[hormiga] Startup failed:', err.message)
    closeSplash()
    dialog.showErrorBox('Hormiga failed to start', err.message)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const prefs = getElectronPrefs()
    const autoOpen = prefs.auto_open_last_database !== false
    if (autoOpen && hasCredentials()) startServer().then(createWindow)
    else createLandingWindow()
  }
})

app.on('before-quit', stopServer)
