const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const workerDir = path.join(rootDir, 'worker');
const runtimeDir = path.join(rootDir, 'runtime');
const settingsPath = path.join(runtimeDir, 'settings.json');
const logPath = path.join(runtimeDir, 'app.log');
const workerPort = 48731;
const workerUrl = `http://127.0.0.1:${workerPort}`;
const productName = 'Synthetiq Voice';
const launcherPath = path.join(rootDir, 'Launch-SynthetiqVoice.vbs');

let mainWindow;
let tray;
let workerProcess;
let workerRestartTimer;
const popupWidth = 520;
const popupHeight = 680;

function ensureRuntime() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

function log(message) {
  ensureRuntime();
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(logPath, line);
  console.log(message);
}

function readSettings() {
  ensureRuntime();
  const defaults = {
    addMode: false,
    selectedDeviceId: null,
    modelSize: 'small.en',
    computeDevice: 'cpu',
    computeType: 'int8',
    language: 'en',
    debugKeepAudio: false,
    developerMode: false,
    developerCudaEnabled: false,
    setupComplete: false,
    startWithWindows: false
  };
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
    }
  } catch (error) {
    console.error('Failed to read settings:', error);
  }
  return defaults;
}

function writeSettings(settings) {
  ensureRuntime();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function setAutoStart(enabled) {
  const runValue = 'Synthetiq Voice';
  const command = `"C:\\Windows\\System32\\wscript.exe" "${launcherPath}"`;
  const args = enabled
    ? ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', runValue, '/t', 'REG_SZ', '/d', command, '/f']
    : ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', runValue, '/f'];
  return new Promise((resolve) => {
    const child = spawn('reg.exe', args, { windowsHide: true });
    child.on('exit', (code) => resolve(code === 0 || (!enabled && code === 1)));
    child.on('error', () => resolve(false));
  });
}

function pythonExecutable() {
  const venvPython = path.join(rootDir, '.venv', 'Scripts', 'python.exe');
  return fs.existsSync(venvPython) ? venvPython : 'python';
}

function startWorker() {
  if (workerProcess && !workerProcess.killed) {
    return;
  }
  if (workerRestartTimer) {
    clearTimeout(workerRestartTimer);
    workerRestartTimer = null;
  }

  const env = {
    ...process.env,
    LOCAL_DICTATION_PORT: String(workerPort),
    LOCAL_DICTATION_ROOT: rootDir,
    PYTHONIOENCODING: 'utf-8'
  };

  workerProcess = spawn(pythonExecutable(), ['stt_worker.py'], {
    cwd: workerDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  workerProcess.stdout.on('data', (data) => {
    console.log(`[worker] ${data.toString().trim()}`);
  });
  workerProcess.stderr.on('data', (data) => {
    console.error(`[worker] ${data.toString().trim()}`);
  });
  workerProcess.on('exit', (code) => {
    console.log(`Worker exited: ${code}`);
    log(`worker exited with code ${code}`);
    workerProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('worker-exit', code);
    }
    if (!app.isQuitting) {
      workerRestartTimer = setTimeout(() => {
        log('restarting worker');
        startWorker();
      }, 1200);
    }
  });
}

function gpuStatus() {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi.exe', [
      '--query-gpu=name,driver_version,memory.total',
      '--format=csv,noheader'
    ], { windowsHide: true });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    child.on('error', (error) => {
      resolve({ available: false, gpus: [], message: error.message });
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        resolve({ available: false, gpus: [], message: errorOutput.trim() || 'nvidia-smi did not report an NVIDIA GPU.' });
        return;
      }
      const gpus = output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, driver, memory] = line.split(',').map((part) => part.trim());
        return { name, driver, memory };
      });
      resolve({
        available: gpus.length > 0,
        gpus,
        message: gpus.length ? `${gpus.length} NVIDIA GPU${gpus.length === 1 ? '' : 's'} detected.` : 'No NVIDIA GPUs detected.'
      });
    });
  });
}

async function requestWorker(endpoint, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  log(`worker request ${endpoint} started`);
  let response;
  let text;
  try {
    response = await fetch(`${workerUrl}${endpoint}`, {
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
      ...options
    });
    text = await response.text();
  } catch (error) {
    log(`worker request ${endpoint} failed after ${Date.now() - started}ms: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  log(`worker request ${endpoint} finished ${response.status} after ${Date.now() - started}ms`);
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { detail: text };
  }
  if (!response.ok) {
    throw new Error(payload.detail || payload.error || `Worker returned ${response.status}`);
  }
  return payload;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: popupWidth,
    height: popupHeight,
    minWidth: popupWidth,
    minHeight: 520,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: productName,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('blur', () => {
    if (!app.isQuitting && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });
}

function popupPosition() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const work = display.workArea;
  const trayBounds = tray ? tray.getBounds() : null;

  let x = work.x + work.width - popupWidth - 12;
  let y = work.y + work.height - popupHeight - 12;

  if (trayBounds && trayBounds.width > 0 && trayBounds.height > 0) {
    const trayCenterX = trayBounds.x + trayBounds.width / 2;
    const trayCenterY = trayBounds.y + trayBounds.height / 2;
    x = Math.round(trayCenterX - popupWidth / 2);

    const taskbarLikelyBottom = trayCenterY > work.y + work.height / 2;
    y = taskbarLikelyBottom
      ? Math.round(trayBounds.y - popupHeight - 10)
      : Math.round(trayBounds.y + trayBounds.height + 10);
  }

  x = Math.max(work.x + 8, Math.min(x, work.x + work.width - popupWidth - 8));
  y = Math.max(work.y + 8, Math.min(y, work.y + work.height - popupHeight - 8));
  return { x, y };
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  const { x, y } = popupPosition();
  mainWindow.setBounds({ x, y, width: popupWidth, height: popupHeight }, false);
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }
  showWindow();
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(rootDir, 'assets', 'tray-icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(image);
  tray.setToolTip(productName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${productName}`, click: showWindow },
    { label: 'Record', click: () => mainWindow?.webContents.send('tray-record') },
    { label: 'Stop', click: () => mainWindow?.webContents.send('tray-stop') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('click', toggleWindow);
  tray.on('double-click', toggleWindow);
}

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_event, settings) => {
  const merged = { ...readSettings(), ...settings };
  writeSettings(merged);
  return merged;
});
ipcMain.handle('startup:set', async (_event, enabled) => {
  const ok = await setAutoStart(Boolean(enabled));
  const merged = { ...readSettings(), startWithWindows: Boolean(enabled) && ok };
  writeSettings(merged);
  return { ok, enabled: merged.startWithWindows };
});
ipcMain.handle('worker:health', () => requestWorker('/health'));
ipcMain.handle('worker:devices', () => requestWorker('/devices'));
ipcMain.handle('worker:deviceLevels', () => requestWorker('/devices/levels', { timeoutMs: 30000 }));
ipcMain.handle('worker:models', () => requestWorker('/models'));
ipcMain.handle('worker:downloadModel', (_event, payload) => requestWorker('/models/download', {
  method: 'POST',
  body: JSON.stringify(payload),
  timeoutMs: 1800000
}));
ipcMain.handle('worker:preloadModel', (_event, payload) => requestWorker('/models/preload', {
  method: 'POST',
  body: JSON.stringify(payload || {}),
  timeoutMs: 300000
}));
ipcMain.handle('worker:deleteModel', (_event, payload) => requestWorker('/models', {
  method: 'DELETE',
  body: JSON.stringify(payload),
  timeoutMs: 120000
}));
ipcMain.handle('system:gpuStatus', () => gpuStatus());
ipcMain.handle('worker:configure', (_event, settings) => requestWorker('/settings', {
  method: 'POST',
  body: JSON.stringify(settings)
}));
ipcMain.handle('record:start', (_event, payload) => requestWorker('/record/start', {
  method: 'POST',
  body: JSON.stringify(payload || {})
}));
ipcMain.handle('record:stop', () => requestWorker('/record/stop', { method: 'POST', body: '{}', timeoutMs: 60000 }));
ipcMain.handle('clipboard:copy', (_event, text) => {
  clipboard.writeText(text || '');
  return true;
});
ipcMain.handle('clipboard:paste', async (_event, text) => {
  clipboard.writeText(text || '');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  spawn('powershell.exe', [
    '-NoProfile',
    '-WindowStyle',
    'Hidden',
    '-Command',
    '$ws=New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 350; $ws.SendKeys("^v")'
  ], { windowsHide: true, stdio: 'ignore' });
  return true;
});

app.whenReady().then(() => {
  ensureRuntime();
  startWorker();
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (workerProcess && !workerProcess.killed) {
    workerProcess.kill();
  }
  if (workerRestartTimer) {
    clearTimeout(workerRestartTimer);
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
