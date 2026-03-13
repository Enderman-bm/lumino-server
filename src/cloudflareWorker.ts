/**
 * Cloudflare Worker entry point for Lumino Collaborative Server
 */

import { roomManager } from './roomManager';
import { userManager } from './userManager';
import { log } from './utils';
import type { ServerMessage, ClientMessage, User } from './types';

// WebSocket connection manager
const wsConnections = new Map<string, WebSocket>();

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    log('info', `Received request: ${request.method} ${url.pathname}`);

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      const stats = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        rooms: roomManager.getStats(),
        users: userManager.getStats(),
      };
      
      return new Response(JSON.stringify(stats), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Server info endpoint
    if (url.pathname === '/info' && request.method === 'GET') {
      const info = {
        name: 'Lumino Collaborative Server',
        version: '1.0.0',
        websocket: {
          path: '/ws',
          protocol: 'json',
        },
        features: [
          'real-time-collaboration',
          'mouse-tracking',
          'note-batch-operations',
          'midi-event-sync',
          'project-state-sync',
        ],
      };
      
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // WebSocket upgrade endpoint
    if (url.pathname === '/ws' && request.method === 'GET') {
      log('info', `WebSocket upgrade request received`);
      // Check if it's a WebSocket upgrade request
      const upgradeHeader = request.headers.get('Upgrade');
      log('info', `Upgrade header: ${upgradeHeader}`);
      if (upgradeHeader === 'websocket') {
        log('info', `Creating WebSocket pair`);
        // Create WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        // Accept the WebSocket connection
        server.accept();
        log('info', `WebSocket server accepted`);
        
        // Handle WebSocket connection
        handleWebSocketConnection(server);
        
        log('info', `Returning WebSocket upgrade response`);
        // Return the client WebSocket - this is the key fix
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
      
      // If not a WebSocket upgrade, return error
      log('info', `WebSocket upgrade header not found, returning 400`);
      return new Response('WebSocket upgrade required', { status: 400 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};

function handleWebSocketConnection(ws: WebSocket) {
  const userId = generateUserId();
  wsConnections.set(userId, ws);

  log('info', `New WebSocket connection initialized for user ${userId}`);
  
  // Set up message listener
  ws.addEventListener('message', (event) => {
    log('info', `WebSocket message event triggered for user ${userId}`);
    try {
      const data = JSON.parse(event.data as string);
      log('info', `Received message from ${userId}:`, JSON.stringify(data));
      handleClientMessage(userId, ws, data);
    } catch (error) {
      log('error', 'Failed to parse WebSocket message:', error);
      log('error', 'Raw message data:', event.data);
      try {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      } catch (sendError) {
        log('error', 'Failed to send error response:', sendError);
      }
    }
  });

  ws.addEventListener('close', () => {
    log('info', `WebSocket connection closed for user ${userId}`);
    wsConnections.delete(userId);
    
    // Clean up user from rooms
    const user = userManager.getUser(userId);
    if (user) {
      const room = roomManager.getRoomByUser(userId);
      if (room) {
        roomManager.leaveRoom(user);
        const leaveMessage: ServerMessage = {
          type: 'userLeft',
          userId: userId,
        };
        broadcastToRoom(room, leaveMessage, userId);
      }
      userManager.deleteUser(userId);
    }
  });

  ws.addEventListener('error', (error) => {
    log('error', `WebSocket error for user ${userId}:`, error);
  });
}

function generateUserId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function handleClientMessage(userId: string, ws: WebSocket, message: any): void {
  const type = message.type;
  log('info', `Processing message type: ${type} for user ${userId}`);
  
  switch (type) {
    case 'auth':
      log('info', `Handling auth for username: ${message.username}`);
      handleAuth(ws, userId, message.username);
      break;
    case 'createRoom':
      handleCreateRoom(ws, userId, message.name);
      break;
    case 'joinRoom':
      handleJoinRoom(ws, userId, message.inviteCode);
      break;
    case 'leaveRoom':
      handleLeaveRoom(ws, userId);
      break;
    case 'mouseMove':
      handleMouseMove(ws, userId, message.position);
      break;
    case 'noteBatch':
      handleNoteBatch(ws, userId, message.operation);
      break;
    case 'midiEvent':
      handleMidiEvent(ws, userId, message.event);
      break;
    case 'midiEventBatch':
      handleMidiEventBatch(ws, userId, message.events);
      break;
    case 'projectUpdate':
      handleProjectUpdate(ws, userId, message.update);
      break;
    case 'requestSync':
      handleRequestSync(ws, userId);
      break;
    case 'ping':
      handlePing(ws, userId, message.timestamp);
      break;
    default:
      log('warn', `Unknown message type: ${type}`);
      ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
  }
}

function handleAuth(ws: WebSocket, userId: string, username: string): void {
  log('info', `handleAuth called for userId: ${userId}, username: ${username}`);
  
  const validation = userManager.validateUsername(username);
  log('info', `Username validation result:`, JSON.stringify(validation));
  
  if (!validation.valid) {
    log('warn', `Username validation failed: ${validation.error}`);
    ws.send(JSON.stringify({ type: 'authError', error: validation.error! }));
    return;
  }

  const user = userManager.createCloudflareUser(userId, username);
  log('info', `User created: ${user.id}`);
  
  const response = {
    type: 'authSuccess',
    userId: user.id,
    inviteCode: generateInviteCode(),
  };
  
  log('info', `Sending auth response:`, JSON.stringify(response));
  try {
    ws.send(JSON.stringify(response));
    log('info', `Auth response sent successfully`);
  } catch (error) {
    log('error', `Failed to send auth response:`, error);
  }
}

function handleCreateRoom(ws: WebSocket, userId: string, name: string): void {
  const user = userManager.getUser(userId);
  if (!user) {
    ws.send(JSON.stringify({ type: 'roomError', error: 'User not authenticated' }));
    return;
  }

  try {
    const room = roomManager.createRoom(user, name);
    ws.send(JSON.stringify({
      type: 'roomCreated',
      room: roomManager.getRoomInfo(room),
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'roomError',
      error: error instanceof Error ? error.message : '创建房间失败',
    }));
  }
}

function handleJoinRoom(ws: WebSocket, userId: string, inviteCode: string): void {
  const user = userManager.getUser(userId);
  if (!user) {
    ws.send(JSON.stringify({ type: 'roomError', error: 'User not authenticated' }));
    return;
  }

  try {
    const room = roomManager.joinRoom(inviteCode, user);
    
    if (!room) {
      ws.send(JSON.stringify({
        type: 'roomError',
        error: '邀请码无效或房间不存在',
      }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'roomJoined',
      room: roomManager.getRoomInfo(room),
      users: roomManager.getUsersInfo(room),
      projectState: room.projectState,
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'roomError',
      error: error instanceof Error ? error.message : '加入房间失败',
    }));
  }
}

function handleLeaveRoom(ws: WebSocket, userId: string): void {
  const user = userManager.getUser(userId);
  if (!user) return;

  const room = roomManager.getRoomByUser(userId);
  if (room) {
    roomManager.leaveRoom(user);
    const leaveMessage: ServerMessage = {
      type: 'userLeft',
      userId: userId,
    };
    broadcastToRoom(room, leaveMessage, userId);
  }
}

function handleMouseMove(ws: WebSocket, userId: string, position: any): void {
  userManager.updateMousePosition(userId, position);
  
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const user = userManager.getUser(userId);
  const message: ServerMessage = {
    type: 'mouseUpdate',
    userId: userId,
    username: user?.username || 'Unknown',
    position,
    color: user?.color || '#000000',
  };

  broadcastToRoom(room, message, userId);
}

function handleNoteBatch(ws: WebSocket, userId: string, operation: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  if (room.projectState.midiData) {
    applyNoteOperation(room.projectState.midiData, operation);
    roomManager.updateProjectState(room.id, {}, userId);
  }

  const message: ServerMessage = {
    type: 'noteBatchUpdate',
    userId: userId,
    operation,
  };

  broadcastToRoom(room, message, userId);
}

function handleMidiEvent(ws: WebSocket, userId: string, event: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventUpdate',
    userId: userId,
    event,
  };

  broadcastToRoom(room, message, userId);
}

function handleMidiEventBatch(ws: WebSocket, userId: string, events: any[]): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventBatchUpdate',
    userId: userId,
    events,
  };

  broadcastToRoom(room, message, userId);
}

function handleProjectUpdate(ws: WebSocket, userId: string, update: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  if (update.type === 'viewState') {
    roomManager.updateProjectState(
      room.id,
      { viewState: update.data },
      userId
    );
  }

  const message: ServerMessage = {
    type: 'projectStateUpdate',
    userId: userId,
    update,
  };

  broadcastToRoom(room, message, userId);
}

function handleRequestSync(ws: WebSocket, userId: string): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'fullSync',
    projectState: room.projectState,
    users: roomManager.getUsersInfo(room),
  };

  ws.send(JSON.stringify(message));
}

function handlePing(ws: WebSocket, userId: string, timestamp: number): void {
  const message: ServerMessage = {
    type: 'pong',
    timestamp,
    serverTime: Date.now(),
  };

  ws.send(JSON.stringify(message));
}

function broadcastToRoom(room: any, message: ServerMessage, excludeUserId: string): void {
  const messageStr = JSON.stringify(message);
  
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    
    const ws = wsConnections.get(user.id);
    if (ws) {
      ws.send(messageStr);
    }
  }
}

function applyNoteOperation(midiData: any, operation: any): void {
  if (!midiData.tracks) return;

  switch (operation.action) {
    case 'add':
      for (const note of operation.notes) {
        const track = midiData.tracks[note.trackIndex];
        if (track) {
          track.notes.push(note);
        }
      }
      break;

    case 'delete':
      for (const note of operation.notes) {
        const track = midiData.tracks[note.trackIndex];
        if (track) {
          track.notes = track.notes.filter((n: any) => n.id !== note.id);
        }
      }
      break;

    case 'update':
      for (const note of operation.notes) {
        const track = midiData.tracks[note.trackIndex];
        if (track) {
          const index = track.notes.findIndex((n: any) => n.id === note.id);
          if (index !== -1) {
            track.notes[index] = note;
          }
        }
      }
      break;

    case 'move':
      for (const note of operation.notes) {
        note.tick += operation.tickOffset || 0;
        note.key += operation.keyOffset || 0;
      }
      break;

    case 'paste':
      if (operation.targetTrack !== undefined) {
        const targetTrack = midiData.tracks[operation.targetTrack];
        if (targetTrack) {
          for (const note of operation.notes) {
            const newNote = {
              ...note,
              id: Math.random().toString(36).substring(2, 15),
              tick: note.tick + (operation.tickOffset || 0),
              key: note.key + (operation.keyOffset || 0),
              trackIndex: operation.targetTrack,
            };
            targetTrack.notes.push(newNote);
          }
        }
      }
      break;
  }
}

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
