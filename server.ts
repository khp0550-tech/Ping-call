import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

interface Peer {
  id: string;
  name: string;
  pin: string;
  ws?: WebSocket | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  joinedAt: number;
  lastSeenAt: number;
  eventsQueue: any[];
}

interface Room {
  pin: string;
  createdAt: number;
  peers: Map<string, Peer>;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(pin: string): Room {
  let room = rooms.get(pin);
  if (!room) {
    room = {
      pin,
      createdAt: Date.now(),
      peers: new Map(),
    };
    rooms.set(pin, room);
  }
  return room;
}

function generateUniquePin(): string {
  for (let i = 0; i < 50; i++) {
    const candidate = Math.floor(1000 + Math.random() * 9000).toString();
    const existing = rooms.get(candidate);
    if (!existing || existing.peers.size === 0) {
      return candidate;
    }
  }
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Dispatch event to a specific peer (via WS if open, and append to eventsQueue)
function dispatchToPeer(peer: Peer, event: any) {
  // 1. Try WebSocket
  if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
    try {
      peer.ws.send(JSON.stringify(event));
    } catch (e) {
      console.warn(`Failed to send WS to ${peer.id}:`, e);
    }
  }
  // 2. Also keep in queue for polling clients
  peer.eventsQueue.push(event);
  if (peer.eventsQueue.length > 100) {
    peer.eventsQueue.shift();
  }
}

// Broadcast event to all peers in a room (optionally exclude one peer)
function broadcastToRoom(pin: string, event: any, excludePeerId?: string) {
  const room = rooms.get(pin);
  if (!room) return;
  for (const [id, peer] of room.peers.entries()) {
    if (id !== excludePeerId) {
      dispatchToPeer(peer, event);
    }
  }
}

// Remove a peer from a room
function removePeerFromRoom(pin: string, peerId: string) {
  const room = rooms.get(pin);
  if (!room) return;
  const peer = room.peers.get(peerId);
  if (peer) {
    room.peers.delete(peerId);
    console.log(`[PinCall] Peer ${peer.name} (${peerId}) left Room #${pin}. Remaining: ${room.peers.size}`);
    broadcastToRoom(pin, {
      type: 'peer-left',
      peerId,
    });
    if (room.peers.size === 0) {
      rooms.delete(pin);
    }
  }
}

// Cleanup inactive peers every 15s
setInterval(() => {
  const now = Date.now();
  for (const [pin, room] of rooms.entries()) {
    for (const [peerId, peer] of room.peers.entries()) {
      // Inactive if WS is not open AND hasn't polled in 35 seconds
      const isWsDead = !peer.ws || peer.ws.readyState !== WebSocket.OPEN;
      if (isWsDead && now - peer.lastSeenAt > 35000) {
        removePeerFromRoom(pin, peerId);
      }
    }
  }
}, 15000);

// --- REST API Endpoints ---

app.get('/api/health', (_req: Request, res: Response) => {
  let totalPeers = 0;
  for (const r of rooms.values()) {
    totalPeers += r.peers.size;
  }
  res.json({
    status: 'ok',
    activeRooms: rooms.size,
    activePeers: totalPeers,
    time: new Date().toISOString(),
  });
});

app.get('/api/room/status/:pin', (req: Request, res: Response) => {
  const pin = req.params.pin;
  if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
  }
  const room = rooms.get(pin);
  const count = room ? room.peers.size : 0;
  res.json({
    pin,
    exists: count > 0,
    count,
    maxCapacity: 8,
  });
});

app.post('/api/room/create', (_req: Request, res: Response) => {
  const pin = generateUniquePin();
  getOrCreateRoom(pin);
  res.json({ pin });
});

// Legacy backward-compatibility routes
app.get('/api/signaling/poll/:peerId', (_req: Request, res: Response) => {
  res.json({ messages: [], events: [] });
});

app.post('/api/signaling/send', (_req: Request, res: Response) => {
  res.json({ success: true });
});

// REST Join
app.post('/api/room/join', (req: Request, res: Response) => {
  const { pin, peerId, userName, audioEnabled, videoEnabled } = req.body;
  if (!pin || !/^\d{4}$/.test(pin) || !peerId) {
    return res.status(400).json({ error: 'Valid 4-digit PIN and peerId required' });
  }

  const room = getOrCreateRoom(pin);
  if (room.peers.size >= 8 && !room.peers.has(peerId)) {
    return res.status(403).json({ error: 'Room is full (max 8 participants)' });
  }

  let peer = room.peers.get(peerId);
  const existingPeersList = Array.from(room.peers.values())
    .filter((p) => p.id !== peerId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled,
      isScreenSharing: p.isScreenSharing,
    }));

  if (!peer) {
    peer = {
      id: peerId,
      name: userName || `Guest-${peerId.slice(0, 4)}`,
      pin,
      ws: null,
      audioEnabled: audioEnabled !== false,
      videoEnabled: videoEnabled !== false,
      isScreenSharing: false,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      eventsQueue: [],
    };
    room.peers.set(peerId, peer);

    console.log(`[PinCall] Peer ${peer.name} (${peerId}) joined Room #${pin} via HTTP. Total: ${room.peers.size}`);

    // Notify other peers
    broadcastToRoom(
      pin,
      {
        type: 'peer-joined',
        peer: {
          id: peer.id,
          name: peer.name,
          audioEnabled: peer.audioEnabled,
          videoEnabled: peer.videoEnabled,
          isScreenSharing: false,
        },
      },
      peerId
    );
  } else {
    peer.lastSeenAt = Date.now();
    if (userName) peer.name = userName;
  }

  res.json({
    type: 'joined',
    pin,
    peerId,
    peers: existingPeersList,
  });
});

// REST Signal
app.post('/api/room/signal', (req: Request, res: Response) => {
  const { pin, from, to, data } = req.body;
  if (!pin || !from || !to || !data) {
    return res.status(400).json({ error: 'Missing pin, from, to, or data' });
  }
  const room = rooms.get(pin);
  if (room) {
    const targetPeer = room.peers.get(to);
    if (targetPeer) {
      dispatchToPeer(targetPeer, {
        type: 'signal',
        from,
        data,
      });
      return res.json({ success: true });
    }
  }
  res.status(404).json({ error: 'Target peer not found' });
});

// REST Media state
app.post('/api/room/media-state', (req: Request, res: Response) => {
  const { pin, peerId, audioEnabled, videoEnabled, isScreenSharing } = req.body;
  const room = rooms.get(pin);
  if (room) {
    const peer = room.peers.get(peerId);
    if (peer) {
      if (audioEnabled !== undefined) peer.audioEnabled = audioEnabled;
      if (videoEnabled !== undefined) peer.videoEnabled = videoEnabled;
      if (isScreenSharing !== undefined) peer.isScreenSharing = isScreenSharing;
      peer.lastSeenAt = Date.now();

      broadcastToRoom(
        pin,
        {
          type: 'peer-media-state',
          peerId,
          audioEnabled: peer.audioEnabled,
          videoEnabled: peer.videoEnabled,
          isScreenSharing: peer.isScreenSharing,
        },
        peerId
      );
    }
  }
  res.json({ success: true });
});

// REST Chat
app.post('/api/room/chat', (req: Request, res: Response) => {
  const { pin, peerId, userName, text } = req.body;
  if (!pin || !text || !text.trim()) {
    return res.status(400).json({ error: 'Invalid message' });
  }
  const chatObj = {
    type: 'chat',
    id: 'chat_' + Math.random().toString(36).substring(2, 9),
    peerId,
    userName: userName || 'Someone',
    text: text.trim().slice(0, 500),
    timestamp: Date.now(),
  };
  broadcastToRoom(pin, chatObj);
  res.json({ success: true, message: chatObj });
});

// REST Reaction
app.post('/api/room/reaction', (req: Request, res: Response) => {
  const { pin, peerId, emoji } = req.body;
  if (!pin || !emoji) return res.status(400).json({ error: 'Invalid reaction' });
  const reactObj = {
    type: 'reaction',
    peerId,
    emoji,
    id: 'react_' + Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
  };
  broadcastToRoom(pin, reactObj);
  res.json({ success: true });
});

// REST Poll Events
app.get('/api/room/poll/:pin/:peerId', (req: Request, res: Response) => {
  const { pin, peerId } = req.params;
  const room = rooms.get(pin);
  if (!room) {
    return res.json({ events: [] });
  }
  const peer = room.peers.get(peerId);
  if (!peer) {
    return res.json({ events: [] });
  }
  peer.lastSeenAt = Date.now();
  const events = [...peer.eventsQueue];
  peer.eventsQueue = [];
  res.json({ events });
});

// REST Leave
app.post('/api/room/leave', (req: Request, res: Response) => {
  const { pin, peerId } = req.body;
  if (pin && peerId) {
    removePeerFromRoom(pin, peerId);
  }
  res.json({ success: true });
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
  // Only handle /ws or /signaling path so Vite HMR is unaffected!
  if (pathname === '/ws' || pathname === '/signaling') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws: WebSocket) => {
  let boundPeerId: string | null = null;
  let boundPin: string | null = null;

  const send = (socket: WebSocket, data: any) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  };

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'join': {
          const { pin, peerId, userName, audioEnabled, videoEnabled } = msg;
          if (!pin || !/^\d{4}$/.test(pin) || !peerId) {
            return send(ws, { type: 'error', message: 'Invalid 4-digit PIN or peer ID' });
          }

          boundPeerId = peerId;
          boundPin = pin;

          const room = getOrCreateRoom(pin);
          if (room.peers.size >= 8 && !room.peers.has(peerId)) {
            return send(ws, { type: 'error', message: 'Room is full (max 8 participants)' });
          }

          let peer = room.peers.get(peerId);
          const existingPeersList = Array.from(room.peers.values())
            .filter((p) => p.id !== peerId)
            .map((p) => ({
              id: p.id,
              name: p.name,
              audioEnabled: p.audioEnabled,
              videoEnabled: p.videoEnabled,
              isScreenSharing: p.isScreenSharing,
            }));

          if (!peer) {
            peer = {
              id: peerId,
              name: userName || `Guest-${peerId.slice(0, 4)}`,
              pin,
              ws,
              audioEnabled: audioEnabled !== false,
              videoEnabled: videoEnabled !== false,
              isScreenSharing: false,
              joinedAt: Date.now(),
              lastSeenAt: Date.now(),
              eventsQueue: [],
            };
            room.peers.set(peerId, peer);

            console.log(`[PinCall] Peer ${peer.name} (${peerId}) joined Room #${pin} via WS. Total: ${room.peers.size}`);

            // Broadcast peer-joined to others
            broadcastToRoom(
              pin,
              {
                type: 'peer-joined',
                peer: {
                  id: peer.id,
                  name: peer.name,
                  audioEnabled: peer.audioEnabled,
                  videoEnabled: peer.videoEnabled,
                  isScreenSharing: false,
                },
              },
              peerId
            );
          } else {
            peer.ws = ws;
            peer.lastSeenAt = Date.now();
            if (userName) peer.name = userName;
          }

          // Confirm join to this peer
          send(ws, {
            type: 'joined',
            pin,
            peerId,
            peers: existingPeersList,
          });
          break;
        }

        case 'signal': {
          const { to, data } = msg;
          if (!to || !boundPeerId || !boundPin) return;

          const room = rooms.get(boundPin);
          if (room) {
            const target = room.peers.get(to);
            if (target) {
              dispatchToPeer(target, {
                type: 'signal',
                from: boundPeerId,
                data,
              });
            }
          }
          break;
        }

        case 'media-state': {
          if (!boundPin || !boundPeerId) return;
          const { audioEnabled, videoEnabled, isScreenSharing } = msg;
          const room = rooms.get(boundPin);
          if (room) {
            const peer = room.peers.get(boundPeerId);
            if (peer) {
              if (audioEnabled !== undefined) peer.audioEnabled = audioEnabled;
              if (videoEnabled !== undefined) peer.videoEnabled = videoEnabled;
              if (isScreenSharing !== undefined) peer.isScreenSharing = isScreenSharing;
              peer.lastSeenAt = Date.now();

              broadcastToRoom(
                boundPin,
                {
                  type: 'peer-media-state',
                  peerId: boundPeerId,
                  audioEnabled: peer.audioEnabled,
                  videoEnabled: peer.videoEnabled,
                  isScreenSharing: peer.isScreenSharing,
                },
                boundPeerId
              );
            }
          }
          break;
        }

        case 'chat': {
          if (!boundPin || !boundPeerId) return;
          const { text, userName } = msg;
          if (!text || !text.trim()) return;

          const chatObj = {
            type: 'chat',
            id: 'chat_' + Math.random().toString(36).substring(2, 9),
            peerId: boundPeerId,
            userName: userName || 'Someone',
            text: text.trim().slice(0, 500),
            timestamp: Date.now(),
          };
          broadcastToRoom(boundPin, chatObj);
          break;
        }

        case 'reaction': {
          if (!boundPin || !boundPeerId) return;
          const { emoji } = msg;
          if (!emoji) return;

          const reactObj = {
            type: 'reaction',
            peerId: boundPeerId,
            emoji,
            id: 'react_' + Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
          };
          broadcastToRoom(boundPin, reactObj);
          break;
        }

        case 'leave': {
          if (boundPin && boundPeerId) {
            removePeerFromRoom(boundPin, boundPeerId);
            boundPin = null;
            boundPeerId = null;
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error in WS message:', err);
    }
  });

  ws.on('close', () => {
    if (boundPin && boundPeerId) {
      const room = rooms.get(boundPin);
      if (room) {
        const peer = room.peers.get(boundPeerId);
        if (peer && peer.ws === ws) {
          peer.ws = null;
          // Don't immediately delete; allow 10s grace period for refresh or fallback polling
          setTimeout(() => {
            const currentRoom = rooms.get(boundPin!);
            if (currentRoom) {
              const currentPeer = currentRoom.peers.get(boundPeerId!);
              if (currentPeer && !currentPeer.ws && Date.now() - currentPeer.lastSeenAt > 10000) {
                removePeerFromRoom(boundPin!, boundPeerId!);
              }
            }
          }, 10000);
        }
      }
    }
  });
});

async function setupVite() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`PinCall WebRTC Server listening on http://0.0.0.0:${port}`);
  });
}

setupVite().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
