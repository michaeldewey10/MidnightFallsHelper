const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('midnightFalls', {
  getState: () => ipcRenderer.invoke('app:get-state'),
  addSymbol: (symbolId) => ipcRenderer.invoke('app:add-symbol', symbolId),
  reset: () => ipcRenderer.invoke('app:reset'),
  undo: () => ipcRenderer.invoke('app:undo'),
  createRoom: (relayUrl) => ipcRenderer.invoke('app:create-room', relayUrl),
  joinRoom: (relayUrl, roomCode) => ipcRenderer.invoke('app:join-room', relayUrl, roomCode),
  disconnect: () => ipcRenderer.invoke('app:disconnect'),
  toggleClickThrough: () => ipcRenderer.invoke('app:toggle-click-through'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  }
});
