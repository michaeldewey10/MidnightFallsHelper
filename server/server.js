const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const MAX_SEQUENCE = 5;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Midnight Falls Helper relay is running.\n');
});

const wss = new WebSocket.Server({ server });

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomCode() {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)];
    }

    if (!rooms.has(code)) {
      return code;
    }
  }

  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function publicState(room) {
  return {
    sequence: room.sequence,
    revision: room.revision,
    roomCode: room.code,
    clients: room.clients.size,
    maxSequence: MAX_SEQUENCE
  };
}

function broadcast(room, message) {
  for (const client of room.clients) {
    send(client, message);
  }
}

function broadcastState(room) {
  broadcast(room, { type: 'state', payload: publicState(room) });
}

function leaveRoom(socket) {
  if (!socket.roomCode) {
    return;
  }

  const room = rooms.get(socket.roomCode);
  if (room) {
    room.clients.delete(socket);
    room.lastSeen = Date.now();
    broadcast(room, {
      type: 'room-info',
      payload: {
        roomCode: room.code,
        clients: room.clients.size
      }
    });
  }

  socket.roomCode = '';
  socket.role = '';
}

function attachToRoom(socket, room, role) {
  leaveRoom(socket);
  socket.roomCode = room.code;
  socket.role = role;
  room.clients.add(socket);
  room.lastSeen = Date.now();
}

function createRoom(socket) {
  const code = roomCode();
  const room = {
    code,
    leaderToken: crypto.randomBytes(18).toString('base64url'),
    sequence: [],
    revision: 0,
    clients: new Set(),
    lastSeen: Date.now()
  };

  rooms.set(code, room);
  attachToRoom(socket, room, 'leader');
  send(socket, {
    type: 'room-created',
    payload: {
      roomCode: code,
      leaderToken: room.leaderToken,
      relayRole: 'leader'
    }
  });
  broadcastState(room);
}

function joinRoom(socket, payload) {
  const code = String(payload.roomCode || '').trim().toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    send(socket, { type: 'error', error: `Room ${code || '(blank)'} was not found.` });
    return;
  }

  attachToRoom(socket, room, 'client');
  send(socket, {
    type: 'room-joined',
    payload: {
      roomCode: room.code,
      relayRole: 'client'
    }
  });
  broadcastState(room);
}

function updateRoom(socket, payload) {
  const code = String(payload.roomCode || socket.roomCode || '').trim().toUpperCase();
  const room = rooms.get(code);

  if (!room || payload.leaderToken !== room.leaderToken) {
    send(socket, { type: 'error', error: 'Leader token rejected.' });
    return;
  }

  const sequence = Array.isArray(payload.sequence) ? payload.sequence.slice(0, MAX_SEQUENCE) : [];
  room.sequence = sequence;
  room.revision += 1;
  room.lastSeen = Date.now();
  broadcastState(room);
}

function handleMessage(socket, raw) {
  let message;

  try {
    message = JSON.parse(raw.toString());
  } catch {
    send(socket, { type: 'error', error: 'Invalid JSON message.' });
    return;
  }

  if (message.type === 'create-room') {
    createRoom(socket);
    return;
  }

  if (message.type === 'join-room') {
    joinRoom(socket, message.payload || {});
    return;
  }

  if (message.type === 'leader-update') {
    updateRoom(socket, message.payload || {});
    return;
  }

  send(socket, { type: 'error', error: `Unknown message type: ${message.type || '(missing)'}` });
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.roomCode = '';
  socket.role = '';

  socket.on('pong', () => {
    socket.isAlive = true;
  });
  socket.on('message', (raw) => handleMessage(socket, raw));
  socket.on('close', () => leaveRoom(socket));
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }

  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && now - room.lastSeen > ROOM_TTL_MS) {
      rooms.delete(code);
    }
  }
}, HEARTBEAT_MS);

server.listen(PORT, HOST, () => {
  console.log(`Midnight Falls relay listening on ${HOST}:${PORT}`);
});
