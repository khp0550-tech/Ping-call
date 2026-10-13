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
  ws?: WebSocket;
  audioEnabled: boolean;
  videoEnabled: boolean;
  isScreenSharing: boolean;
  joinedAt: number;
}

interface Room {
  pin: string;
  createdAt: number;
  peers: Map<string, Peer>;
}

// In-memory rooms repository
const rooms = new Map<string, Room>();

// Polling fallback message queue for non-WS or fallback scenarios
const fallbackMessageQueues = new Map<string, any[]>();

// Helper to get or create room
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

// Helper to generate a random 4-digit pin that is preferably empty
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

// REST endpoints
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

// HTTP fallback signaling in case WebSockets fail or are blocked
app.post('/api/signaling/send', (req: Request, res: Response) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message"' });
  }
  let queue = fallbackMessageQueues.get(to);
  if (!queue) {
    queue = [];
    fallbackMessageQueues.set(to, queue);
  }
  queue.push(message);
  // Keep queue bounded
  if (queue.length > 50) queue.shift();
  res.json({ success: true });
});

app.get('/api/signaling/poll/:peerId', (req: Request, res: Response) => {
  const peerId = req.params.peerId;
  const queue = fallbackMessageQueues.get(peerId) || [];
  fallbackMessageQueues.set(peerId, []);
  res.json({ messages: queue });
});

// WebSocket Server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
  if (pathname === '/ws' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

wss.on('connection', (ws: WebSocket) => {
  let currentPeerId: string | null = null;
  let currentPin: string | null = null;

  const send = (socket: WebSocket, data: any) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  };

  const broadcastToRoom = (pin: string, data: any, excludePeerId?: string) => {
    const room = rooms.get(pin);
    if (!room) return;
    for (const [id, peer] of room.peers.entries()) {
      if (id !== excludePeerId && peer.ws) {
        send(peer.ws, data);
      }
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

          currentPeerId = peerId;
          currentPin = pin;

          const room = getOrCreateRoom(pin);
          if (room.peers.size >= 8) {
            return send(ws, { type: 'error', message: 'Room is full (max 8 participants)' });
          }

          const existingPeersList = Array.from(room.peers.values()).map((p) => ({
            id: p.id,
            name: p.name,
            audioEnabled: p.audioEnabled,
            videoEnabled: p.videoEnabled,
            isScreenSharing: p.isScreenSharing,
          }));

          const newPeer: Peer = {
            id: peerId,
            name: userName || `Guest-${peerId.slice(0, 4)}`,
            pin,
            ws,
            audioEnabled: audioEnabled !== false,
            videoEnabled: videoEnabled !== false,
            isScreenSharing: false,
            joinedAt: Date.now(),
          };

          room.peers.set(peerId, newPeer);

          // Confirm join to the new peer with existing peers
          send(ws, {
            type: 'joined',
            pin,
            peerId,
            peers: existingPeersList,
          });

          // Notify existing peers about the newcomer
          broadcastToRoom(
            pin,
            {
              type: 'peer-joined',
              peer: {
                id: newPeer.id,
                name: newPeer.name,
                audioEnabled: newPeer.audioEnabled,
                videoEnabled: newPeer.videoEnabled,
                isScreenSharing: false,
              },
            },
            peerId
          );
          break;
        }

        case 'signal': {
          const { to, data } = msg;
          if (!to || !currentPeerId || !currentPin) return;

          const room = rooms.get(currentPin);
          if (room) {
            const targetPeer = room.peers.get(to);
            if (targetPeer && targetPeer.ws) {
              send(targetPeer.ws, {
                type: 'signal',
                from: currentPeerId,
                data,
              });
            }
          }
          break;
        }

        case 'media-state': {
          if (!currentPin || !currentPeerId) return;
          const { audioEnabled, videoEnabled, isScreenSharing } = msg;
          const room = rooms.get(currentPin);
          if (room) {
            const peer = room.peers.get(currentPeerId);
            if (peer) {
              if (audioEnabled !== undefined) peer.audioEnabled = audioEnabled;
              if (videoEnabled !== undefined) peer.videoEnabled = videoEnabled;
              if (isScreenSharing !== undefined) peer.isScreenSharing = isScreenSharing;

              broadcastToRoom(
                currentPin,
                {
                  type: 'peer-media-state',
                  peerId: currentPeerId,
                  audioEnabled: peer.audioEnabled,
                  videoEnabled: peer.videoEnabled,
                  isScreenSharing: peer.isScreenSharing,
                },
                currentPeerId
              );
            }
          }
          break;
        }

        case 'chat': {
          if (!currentPin || !currentPeerId) return;
          const { text, userName } = msg;
          if (!text || !text.trim()) return;

          broadcastToRoom(currentPin, {
            type: 'chat',
            id: 'chat_' + Math.random().toString(36).substring(2, 9),
            peerId: currentPeerId,
            userName: userName || 'Someone',
            text: text.trim().slice(0, 500),
            timestamp: Date.now(),
          });
          break;
        }

        case 'reaction': {
          if (!currentPin || !currentPeerId) return;
          const { emoji } = msg;
          if (!emoji) return;

          broadcastToRoom(currentPin, {
            type: 'reaction',
            peerId: currentPeerId,
            emoji,
            id: 'react_' + Math.random().toString(36).substring(2, 9),
            timestamp: Date.now(),
          });
          break;
        }

        case 'leave': {
          cleanupPeer();
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  const cleanupPeer = () => {
    if (currentPin && currentPeerId) {
      const room = rooms.get(currentPin);
      if (room) {
        room.peers.delete(currentPeerId);
        broadcastToRoom(currentPin, {
          type: 'peer-left',
          peerId: currentPeerId,
        });
        if (room.peers.size === 0) {
          rooms.delete(currentPin);
        }
      }
      currentPeerId = null;
      currentPin = null;
    }
  };

  ws.on('close', cleanupPeer);
  ws.on('error', cleanupPeer);
});

// Vite Middleware or Production Static Handler
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
