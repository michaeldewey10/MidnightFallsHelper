const SLOT_ANGLES = [36, 108, 180, 252, 324];
let detailsHidden = false;
let appState = {
  role: 'solo',
  sequence: [],
  symbols: [],
  maxSequence: 5,
  connected: false,
  clickThrough: false,
  clients: 0,
  status: 'Ready',
  error: ''
};

const elements = {
  arenaSlots: document.getElementById('arenaSlots'),
  sequenceCount: document.getElementById('sequenceCount'),
  sequencePills: document.getElementById('sequencePills'),
  symbolButtons: document.getElementById('symbolButtons'),

  resetButton: document.getElementById('resetButton'),
  createRoomButton: document.getElementById('createRoomButton'),
  joinRoomButton: document.getElementById('joinRoomButton'),
  disconnectButton: document.getElementById('disconnectButton'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  errorText: document.getElementById('errorText'),
  roomText: document.getElementById('roomText'),
  detailsPanel: document.getElementById('detailsPanel'),
  minimizeButton: document.getElementById('minimizeButton'),
  maximizeButton: document.getElementById('maximizeButton'),
  hotkeysPanel: document.getElementById('hotkeysPanel'),
  quitButton: document.getElementById('quitButton')
};

function symbolById(symbolId) {
  return appState.symbols.find((symbol) => symbol.id === symbolId);
}

function renderSymbolIcon(symbolId, fallback = '') {
  const symbol = symbolById(symbolId);
  const label = symbol ? symbol.label : fallback;

  return `
    <span class="symbol-icon symbol-${symbolId}">
      <img src="./assets/${symbolId}.png" alt="">
      <span>${label}</span>
    </span>
  `;
}

function positionForAngle(angle, radius) {
  const radians = (angle * Math.PI) / 180;
  return {
    left: `${50 + Math.sin(radians) * radius}%`,
    top: `${50 - Math.cos(radians) * radius}%`
  };
}

function renderArena() {
  elements.arenaSlots.innerHTML = '';

  for (let index = 0; index < appState.maxSequence; index += 1) {
    const symbolId = appState.sequence[index];
    const slot = document.createElement('div');
    const position = positionForAngle(SLOT_ANGLES[index], 38);

    slot.className = `arena-slot ${symbolId ? 'filled' : 'empty'}`;
    slot.style.left = position.left;
    slot.style.top = position.top;
    slot.setAttribute('aria-label', symbolId ? `Order ${index + 1}: ${symbolById(symbolId)?.name || symbolId}` : `Order ${index + 1} empty`);
    slot.innerHTML = symbolId
      ? renderSymbolIcon(symbolId)
      : `<span class="slot-number">${index + 1}</span>`;

    elements.arenaSlots.appendChild(slot);
  }
}

function renderSequence() {
  elements.sequenceCount.textContent = `${appState.sequence.length} / ${appState.maxSequence}`;
  elements.sequencePills.innerHTML = '';

  for (let index = 0; index < appState.maxSequence; index += 1) {
    const symbolId = appState.sequence[index];
    const pill = document.createElement('div');
    pill.className = `sequence-pill ${symbolId ? 'filled' : ''}`;
    pill.innerHTML = symbolId
      ? `<span>${index + 1}</span>${renderSymbolIcon(symbolId)}`
      : `<span>${index + 1}</span><em>Waiting</em>`;
    elements.sequencePills.appendChild(pill);
  }
}

function renderControls() {
  const sequenceFull = appState.sequence.length >= appState.maxSequence;
  const busyConnecting = appState.status === 'Connecting to relay';
  const roomLocked = busyConnecting || appState.connected;

  elements.symbolButtons.innerHTML = '';

  appState.symbols.forEach((symbol, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `symbol-button symbol-${symbol.id}`;
    button.disabled = sequenceFull;
    button.innerHTML = `
      ${renderSymbolIcon(symbol.id, symbol.label)}
      <span class="symbol-name">${symbol.name}</span>
      <kbd>${index + 1}</kbd>
    `;
    button.addEventListener('click', () => window.midnightFalls.addSymbol(symbol.id));
    elements.symbolButtons.appendChild(button);
  });

  elements.resetButton.classList.add('symbol-button', 'danger-button', 'reset-button');
  elements.resetButton.textContent = 'Reset';
  elements.resetButton.disabled = appState.sequence.length === 0;
  elements.symbolButtons.appendChild(elements.resetButton);
  elements.createRoomButton.disabled = roomLocked;
  elements.joinRoomButton.disabled = roomLocked;
  elements.disconnectButton.disabled = !appState.connected;
}

function renderSync() {
  elements.errorText.textContent = appState.error || '';
  elements.errorText.hidden = !appState.error;

  const connecting = appState.status === 'Connecting to relay';
  elements.roomCodeInput.readOnly = connecting;
  elements.joinRoomButton.disabled = connecting || appState.connected;

  if (connecting && document.activeElement !== elements.roomCodeInput) {
    elements.roomCodeInput.value = 'Connecting...';
  } else if (appState.roomCode && document.activeElement !== elements.roomCodeInput) {
    elements.roomCodeInput.value = appState.roomCode;
  }

  if (appState.connected && appState.roomCode) {
    const clientLabel = appState.clients === 1 ? 'client' : 'clients';
    elements.roomText.textContent = `Room ${appState.roomCode} (${appState.clients} ${clientLabel})`;
  } else {
    elements.roomText.textContent = '';
  }
}

function renderDetailsToggle() {
  document.body.classList.toggle('is-collapsed', detailsHidden);
  elements.detailsPanel.hidden = detailsHidden;
  if (detailsHidden) {
    elements.hotkeysPanel.setAttribute('hidden', '');
  } else {
    elements.hotkeysPanel.removeAttribute('hidden');
  }
}

function render() {
  renderArena();
  renderSequence();
  renderControls();
  renderSync();
  renderDetailsToggle();
}

function setState(nextState) {
  appState = { ...appState, ...nextState };
  render();
}

async function initialize() {
  window.midnightFalls.onState(setState);
  const initialState = await window.midnightFalls.getState();
  setState(initialState);
}

elements.resetButton.addEventListener('click', () => window.midnightFalls.reset());
elements.minimizeButton.addEventListener('click', () => {
  detailsHidden = true;
  renderDetailsToggle();
  window.midnightFalls.setCollapsed(true);
});
elements.maximizeButton.addEventListener('click', () => {
  detailsHidden = false;
  renderDetailsToggle();
  window.midnightFalls.setCollapsed(false);
});
elements.createRoomButton.addEventListener('click', () => window.midnightFalls.createRoom());
elements.joinRoomButton.addEventListener('click', () => window.midnightFalls.joinRoom(elements.roomCodeInput.value));
elements.disconnectButton.addEventListener('click', () => window.midnightFalls.disconnect());
elements.quitButton.addEventListener('click', () => window.midnightFalls.quit());
elements.roomCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    window.midnightFalls.joinRoom(elements.roomCodeInput.value);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) {
    return;
  }

  if (event.key >= '1' && event.key <= '5') {
    const symbol = appState.symbols[Number(event.key) - 1];

    if (symbol) {
      window.midnightFalls.addSymbol(symbol.id);
    }
  }

  if (event.key.toLowerCase() === 'r') {
    window.midnightFalls.reset();
  }

  if (event.key === 'Backspace') {
    window.midnightFalls.undo();
  }
});

initialize();
