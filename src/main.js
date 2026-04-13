const { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const RELAY_URL = 'wss://midnightfallshelper.onrender.com';
const MAX_SEQUENCE = 5;
const EXPANDED_SIZE = { width: 560, height: 820 };
const COLLAPSED_SIZE = { width: 420, height: 390 };
const SYMBOLS = [
  { id: 't', label: 'T', name: 'T Rune', hotkey: 'CommandOrControl+Shift+1' },
  { id: 'x', label: 'X', name: 'X Rune', hotkey: 'CommandOrControl+Shift+2' },
  { id: 'v', label: 'V', name: 'V Rune', hotkey: 'CommandOrControl+Shift+3' },
  { id: 'o', label: 'O', name: 'O Rune', hotkey: 'CommandOrControl+Shift+4' },
  { id: 'baklava', label: '<>', name: 'Baklava Rune', hotkey: 'CommandOrControl+Shift+5' }
];

const defaultState = {
  role: 'solo',
  sequence: [],
  revision: 0,
  connected: false,
  relayUrl: RELAY_URL,
  roomCode: '',
  leaderToken: '',
  clients: 0,
  clickThrough: false,
  status: 'Ready',
  error: ''
};

let mainWindow;
let wsClient;
let settingsPath;
let state = { ...defaultState };

app.commandLine.appendSwitch('disable-gpu');

function writeCrashLog(error) {
  try {
    const message = error && error.stack ? error.stack : String(error);
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `${new Date().toISOString()}\n${message}\n\n`);
  } catch {
    // Logging must never become the reason the overlay fails to start.
  }
}

process.on('uncaughtException', writeCrashLog);
process.on('unhandledRejection', writeCrashLog);

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: EXPANDED_SIZE.width,
    height: EXPANDED_SIZE.height,
    x: Math.max(0, width - 600),
    y: 32,
    minWidth: 420,
    minHeight: 620,
    transparent: false,
    frame: false,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#151515',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  applyClickThrough();
}

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const saved = JSON.parse(raw);
    state = {
      ...state,
      roomCode: typeof saved.roomCode === 'string' ? saved.roomCode : '',
      clickThrough: Boolean(saved.clickThrough)
    };
  } catch {
    // First launch or invalid settings: defaults are fine.
  }
}

function saveSettings() {
  if (!settingsPath) {
    return;
  }

  const payload = {
    roomCode: state.roomCode,
    clickThrough: state.clickThrough
  };

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function rendererState() {
  return {
    ...state,
    maxSequence: MAX_SEQUENCE,
    symbols: SYMBOLS,
    platform: process.platform,
    hotkeys: {
      reset: 'CommandOrControl+Shift+R',
      undo: 'CommandOrControl+Shift+Backspace',
      clickThrough: 'CommandOrControl+Shift+Space'
    }
  };
}

function sendToRenderer() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:state', rendererState());
  }
}

function setStatus(status, error = '') {
  state.status = status;
  state.error = error;
  sendToRenderer();
}

function broadcastSharedState() {
  if (state.role !== 'leader' || !wsClient || wsClient.readyState !== WebSocket.OPEN || !state.roomCode || !state.leaderToken) {
    return;
  }

  wsClient.send(JSON.stringify({
    type: 'leader-update',
    payload: {
      roomCode: state.roomCode,
      leaderToken: state.leaderToken,
      sequence: state.sequence
    }
  }));
}

function setSequence(sequence) {
  state.sequence = sequence.slice(0, MAX_SEQUENCE);
  state.revision += 1;
  broadcastSharedState();
  sendToRenderer();
}

function addSymbol(symbolId) {
  if (state.role === 'client') {
    setStatus('Client mode is read-only', 'Only the leader can enter the order.');
    return false;
  }

  if (!SYMBOLS.some((symbol) => symbol.id === symbolId)) {
    return false;
  }

  if (state.sequence.length >= MAX_SEQUENCE) {
    setStatus('Sequence already has five runes');
    return false;
  }

  setSequence([...state.sequence, symbolId]);
  setStatus(state.sequence.length === MAX_SEQUENCE ? 'Five runes locked' : 'Rune added');
  return true;
}

function resetSequence() {
  if (state.role === 'client') {
    setStatus('Client mode is read-only', 'Only the leader can reset the order.');
    return false;
  }

  setSequence([]);
  setStatus('Sequence reset');
  return true;
}

function undoSymbol() {
  if (state.role === 'client') {
    setStatus('Client mode is read-only', 'Only the leader can edit the order.');
    return false;
  }

  if (state.sequence.length === 0) {
    setStatus('No runes to undo');
    return false;
  }

  setSequence(state.sequence.slice(0, -1));
  setStatus('Last rune removed');
  return true;
}

function closeClient() {
  if (wsClient) {
    wsClient.removeAllListeners();
    wsClient.close();
    wsClient = undefined;
  }
}

function sendRelay(message) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify(message));
  }
}

function applyRelayState(payload) {
  if (!payload) {
    return;
  }

  state.sequence = Array.isArray(payload.sequence) ? payload.sequence.slice(0, MAX_SEQUENCE) : [];
  state.revision = Number(payload.revision) || state.revision;
  state.roomCode = typeof payload.roomCode === 'string' ? payload.roomCode : state.roomCode;
  state.clients = Number(payload.clients) || 0;
  sendToRenderer();
}

function connectRelay(onOpen) {
  closeClient();

  state = {
    ...state,
    connected: false,
    relayUrl: RELAY_URL,
    clients: 0,
    error: ''
  };
  saveSettings();
  setStatus('Connecting to relay');

  return new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(RELAY_URL);
    wsClient = socket;

    const finish = () => {
      if (!settled) {
        settled = true;
        resolve(rendererState());
      }
    };

    socket.on('open', () => {
      state.connected = true;
      onOpen();
      finish();
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'room-created' && message.payload) {
          state.role = 'leader';
          state.roomCode = message.payload.roomCode || '';
          state.leaderToken = message.payload.leaderToken || '';
          state.connected = true;
          saveSettings();
          setStatus(`Room ${state.roomCode} created`);
          finish();
          return;
        }

        if (message.type === 'room-joined' && message.payload) {
          state.role = 'client';
          state.roomCode = message.payload.roomCode || state.roomCode;
          state.leaderToken = '';
          state.connected = true;
          saveSettings();
          setStatus(`Joined room ${state.roomCode}`);
          finish();
          return;
        }

        if (message.type === 'state') {
          applyRelayState(message.payload);
          return;
        }

        if (message.type === 'room-info' && message.payload) {
          state.clients = Number(message.payload.clients) || 0;
          sendToRenderer();
          return;
        }

        if (message.type === 'error') {
          state.role = 'solo';
          state.connected = false;
          state.leaderToken = '';
          state.clients = 0;
          setStatus('Relay error', message.error || 'Unknown relay error.');
          closeClient();
          finish();
        }
      } catch {
        setStatus('Sync message ignored', 'Received invalid sync data.');
      }
    });

    socket.on('close', () => {
      if (wsClient === socket) {
        const error = state.error;
        state.connected = false;
        state.leaderToken = '';
        setStatus(error ? 'Connection failed' : 'Disconnected from relay', error);
        finish();
      }
    });

    socket.on('error', (error) => {
      state.connected = false;
      state.leaderToken = '';
      setStatus('Connection failed', error.message);
      finish();
    });
  });
}

function createRoom() {
  state = {
    ...state,
    role: 'leader',
    roomCode: '',
    leaderToken: '',
    clients: 0
  };

  return connectRelay(() => {
    sendRelay({ type: 'create-room' });
  });
}

function joinRoom(roomCode) {
  const normalizedRoomCode = String(roomCode || '').trim().toUpperCase();

  if (!normalizedRoomCode) {
    state = {
      ...state,
      role: 'solo',
      connected: false,
      roomCode: '',
      leaderToken: '',
      clients: 0,
      error: 'Enter a room code first.'
    };
    setStatus('Join failed', state.error);
    return Promise.resolve(rendererState());
  }

  state = {
    ...state,
    role: 'client',
    roomCode: normalizedRoomCode,
    leaderToken: '',
    clients: 0
  };

  return connectRelay(() => {
    sendRelay({
      type: 'join-room',
      payload: {
        roomCode: normalizedRoomCode
      }
    });
  });
}

function disconnectSession() {
  closeClient();
  state = {
    ...state,
    role: 'solo',
    connected: false,
    roomCode: '',
    leaderToken: '',
    clients: 0
  };
  setStatus('Disconnected');
  return rendererState();
}

function applyClickThrough() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setIgnoreMouseEvents(state.clickThrough, { forward: true });
}

function toggleClickThrough() {
  state.clickThrough = !state.clickThrough;
  saveSettings();
  applyClickThrough();
  setStatus(state.clickThrough ? 'Click-through enabled' : 'Click-through disabled');
  return rendererState();
}

function setCollapsedWindow(collapsed) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const size = collapsed ? COLLAPSED_SIZE : EXPANDED_SIZE;
  mainWindow.setSize(size.width, size.height, true);
}

function registerHotkeys() {
  const register = (accelerator, action) => {
    const ok = globalShortcut.register(accelerator, action);

    if (!ok) {
      state.error = `Could not register ${accelerator}. It may be in use by another app.`;
    }
  };

  SYMBOLS.forEach((symbol) => {
    register(symbol.hotkey, () => addSymbol(symbol.id));
  });

  register('CommandOrControl+Shift+R', resetSequence);
  register('CommandOrControl+Shift+Backspace', undoSymbol);
  register('CommandOrControl+Shift+Space', toggleClickThrough);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  loadSettings();
  createWindow();
  registerHotkeys();
  sendToRenderer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  closeClient();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('app:get-state', () => rendererState());
ipcMain.handle('app:add-symbol', (_event, symbolId) => {
  addSymbol(symbolId);
  return rendererState();
});
ipcMain.handle('app:reset', () => {
  resetSequence();
  return rendererState();
});
ipcMain.handle('app:undo', () => {
  undoSymbol();
  return rendererState();
});
ipcMain.handle('app:create-room', () => createRoom());
ipcMain.handle('app:join-room', (_event, roomCode) => joinRoom(roomCode));
ipcMain.handle('app:disconnect', () => disconnectSession());
ipcMain.handle('app:toggle-click-through', () => toggleClickThrough());
ipcMain.handle('app:set-collapsed', (_event, collapsed) => setCollapsedWindow(Boolean(collapsed)));
ipcMain.handle('app:quit', () => app.quit());
