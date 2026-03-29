/**
 * WebSocket 服务器
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { ExtendedWebSocket, ClientMessage, ServerMessage, User } from './types';
import { roomManager } from './roomManager';
import { userManager } from './userManager';
import { generateId, safeJsonParse, log, now } from './utils';
import * as messageHandler from './handlers/messageHandler';

// 检查是否在开发模式
const isDevMode = true; // 强制启用开发日志

// 开发模式事件日志
// 优化：减少序列化开销，只在需要时打印详细数据
function logEvent(direction: 'RECV' | 'SEND', socketId: string, userId: string | null, message: any): void {
  // 只记录基本信息，避免昂贵的JSON序列化
  const messageType = message?.type || 'unknown';
  console.log(`[EVENT] ${direction} id:${socketId} type:${messageType}`);
}

// 存储socket到WebSocket的映射
const socketMap = new Map<string, ExtendedWebSocket>();

/**
 * 广播消息给房间内所有用户（带实际WebSocket发送）
 * 优化：异步发送，带背压检查
 */
function broadcastToRoom(
  roomId: string,
  message: ServerMessage,
  excludeUserId?: string
): void {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const messageStr = JSON.stringify(message);
  const timestamp = Date.now();

  // 使用setImmediate异步发送，避免阻塞事件循环
  setImmediate(() => {
    for (const user of room.users.values()) {
      if (excludeUserId && user.id === excludeUserId) continue;

      // 通过socketId找到WebSocket连接
      const ws = socketMap.get(user.socketId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 背压检查：如果缓冲区过大，跳过或稍后发送
        if ((ws as any).bufferedAmount > MAX_BUFFERED_AMOUNT) {
          console.log(`[${new Date().toISOString()}] [WARN] Skipping message to ${ws.id}: buffer full`);
          continue;
        }

        try {
          ws.send(messageStr);
        } catch (error) {
          console.error(`[${new Date().toISOString()}] [ERROR] Failed to send to ${ws.id}:`, error);
        }
      }
    }
  });
}

/**
 * 发送消息给特定用户
 * 优化：带背压检查和错误处理
 */
function sendToUser(ws: ExtendedWebSocket, message: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    console.log(`[${new Date().toISOString()}] [ERROR] Cannot send to ${ws.id}: readyState=${ws.readyState}`);
    return;
  }

  // 背压检查
  if ((ws as any).bufferedAmount > MAX_BUFFERED_AMOUNT) {
    console.log(`[${new Date().toISOString()}] [WARN] Buffer full for ${ws.id}, dropping message`);
    return;
  }

  try {
    const messageStr = JSON.stringify(message);
    ws.send(messageStr);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ERROR] Failed to send to ${ws.id}:`, error);
  }
}

/**
 * 处理客户端消息
 */
function handleMessage(ws: ExtendedWebSocket, data: string): void {
  // 记录原始消息（限制长度）
  if (isDevMode && data.length < 10000) {
    console.log(`[MSG] ${ws.id}: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`);
  }
  
  const message = safeJsonParse<ClientMessage>(data);
  
  if (!message || !message.type) {
    sendToUser(ws, { type: 'error', error: '无效的消息格式' });
    return;
  }
  
  // 开发模式：记录接收到的消息
  logEvent('RECV', ws.id, ws.userId, message);

  const user = ws.userId ? userManager.getUser(ws.userId) : null;

  try {
    switch (message.type) {
      case 'auth': {
        const response = messageHandler.handleAuth(ws, message.username, ws.pendingRoomId);
        sendToUser(ws, response);
        
        // 如果是认证成功
        if (response.type === 'authenticated') {
          const newUser = userManager.getUser(response.userId);
          if (newUser && response.room) {
            // 用户已加入房间，更新 ws.roomId
            ws.roomId = response.room.id;
            
            // 通知房间内其他用户有新用户加入
            const joinMessage: ServerMessage = {
              type: 'userJoined',
              user: response.user,
            };
            broadcastToRoom(response.room.id, joinMessage, response.userId);
          }
        }
        break;
      }

      case 'createRoom': {
        if (!user) {
          sendToUser(ws, { type: 'roomError', error: '请先登录' });
          return;
        }
        const response = messageHandler.handleCreateRoom(ws, user, message.name);
        sendToUser(ws, response);
        
        if (response.type === 'roomCreated') {
          // 通知房间内其他用户（如果有的话）
        }
        break;
      }

      case 'joinRoom': {
        console.log(`[${new Date().toISOString()}] [DEBUG] Processing joinRoom for user ${user?.id}, inviteCode: ${message.inviteCode}`);
        if (!user) {
          console.log(`[${new Date().toISOString()}] [ERROR] joinRoom failed: user not authenticated`);
          sendToUser(ws, { type: 'roomError', error: '请先登录' });
          return;
        }
        const response = messageHandler.handleJoinRoom(ws, user, message.inviteCode);
        console.log(`[${new Date().toISOString()}] [DEBUG] joinRoom response: ${response.type}`);
        sendToUser(ws, response);
        
        if (response.type === 'roomJoined') {
          console.log(`[${new Date().toISOString()}] [INFO] User ${user.username} (${user.id}) joined room successfully`);
          // 通知房间内其他用户有新用户加入
          const room = roomManager.getRoomByUser(user.id);
          if (room) {
            const joinMessage: ServerMessage = {
              type: 'userJoined',
              user: {
                id: user.id,
                username: user.username,
                color: user.color,
                isHost: room.hostId === user.id,
              },
            };
            broadcastToRoom(room.id, joinMessage, user.id);
          }
        } else if (response.type === 'roomError') {
          console.log(`[${new Date().toISOString()}] [ERROR] joinRoom failed: ${response.error}`);
        }
        break;
      }

      case 'leaveRoom': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          // 先广播离开消息
          const leaveMessage: ServerMessage = {
            type: 'userLeft',
            userId: user.id,
          };
          broadcastToRoom(room.id, leaveMessage, user.id);
          
          // 然后处理离开逻辑
          roomManager.leaveRoom(user);
          ws.roomId = null;
        }
        break;
      }

      case 'mouseMove': {
        if (!user) return;
        userManager.updateMousePosition(user.id, message.position);
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          const updateMessage: ServerMessage = {
            type: 'mouseUpdate',
            userId: user.id,
            username: user.username,
            position: message.position,
            color: user.color,
          };
          broadcastToRoom(room.id, updateMessage, user.id);
        }
        break;
      }

      case 'noteBatch': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          // 更新项目状态
          if (room.projectState.midiData) {
            applyNoteOperation(room.projectState.midiData, message.notes);
            roomManager.updateProjectState(room.id, {}, user.id);
          }
          
          const updateMessage: ServerMessage = {
            type: 'noteBatchUpdate',
            userId: user.id,
            operation: message.notes,
          };
          broadcastToRoom(room.id, updateMessage, user.id);
        }
        break;
      }

      case 'midiEvent': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          const updateMessage: ServerMessage = {
            type: 'midiEventUpdate',
            userId: user.id,
            event: message.event,
          };
          broadcastToRoom(room.id, updateMessage, user.id);
        }
        break;
      }

      case 'midiEventBatch': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          const updateMessage: ServerMessage = {
            type: 'midiEventBatchUpdate',
            userId: user.id,
            events: message.events,
          };
          broadcastToRoom(room.id, updateMessage, user.id);
        }
        break;
      }

      case 'projectUpdate': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          // 应用更新到房间状态
          if (message.update.type === 'viewState') {
            roomManager.updateProjectState(
              room.id,
              { viewState: message.update.data as any },
              user.id
            );
          }
          
          const updateMessage: ServerMessage = {
            type: 'projectStateUpdate',
            userId: user.id,
            update: message.update,
          };
          broadcastToRoom(room.id, updateMessage, user.id);
        }
        break;
      }

      case 'requestSync': {
        if (!user) return;
        
        const room = roomManager.getRoomByUser(user.id);
        if (room) {
          const syncMessage: ServerMessage = {
            type: 'fullSync',
            projectState: room.projectState,
            users: roomManager.getUsersInfo(room),
          };
          sendToUser(ws, syncMessage);
        }
        break;
      }

      case 'ping': {
        messageHandler.handlePing(ws, message.timestamp);
        break;
      }

      case 'subscribeLogs': {
        // 标记为日志客户端
        (ws as any).isLogClient = true;
        
        // 发送历史日志
        const { logBuffer } = require('./index');
        const historyMessage = {
          type: 'logHistory',
          logs: logBuffer.slice(-100), // 发送最近100条
        };
        sendToUser(ws, historyMessage as any);
        
        console.log(`[${new Date().toISOString()}] [INFO] Log client subscribed: ${ws.id}`);
        break;
      }

      default:
        sendToUser(ws, { type: 'error', error: `未知的消息类型: ${(message as any).type}` });
    }
  } catch (error) {
    log('error', '处理消息时出错:', error);
    sendToUser(ws, { 
      type: 'error', 
      error: error instanceof Error ? error.message : '处理消息失败' 
    });
  }
}

/**
 * 应用音符操作到MIDI数据
 */
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

    case 'move': {
      const tickOffset = operation.tickOffset || 0;
      const keyOffset = operation.keyOffset || 0;
      for (const note of operation.notes) {
        const track = midiData.tracks[note.trackIndex];
        if (track) {
          const index = track.notes.findIndex(
            (n: any) => Math.abs(n.tick - note.tick) < 1 && n.key === note.key
          );
          if (index !== -1) {
            track.notes[index].tick += tickOffset;
            track.notes[index].key += keyOffset;
          }
        }
      }
      break;
    }

    case 'copy':
      // 复制操作不需要修改服务器状态，只是客户端操作
      break;

    case 'paste':
      // 粘贴操作 - 复制音符并添加到目标位置
      if (operation.targetTrack !== undefined) {
        const targetTrack = midiData.tracks[operation.targetTrack];
        if (targetTrack) {
          for (const note of operation.notes) {
            const newNote = {
              ...note,
              id: generateId(),
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

/**
 * 创建WebSocket服务器
 */
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB max message size
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16MB backpressure threshold

export function createWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ 
    server,
    path: '/ws',
    maxPayload: MAX_MESSAGE_SIZE,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 100,
    },
  });

  // 心跳检测 - 调整为60秒以适应密集请求场景
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (!extWs.isAlive) {
        log('info', `终止不活跃的连接: ${extWs.id}`);
        socketMap.delete(extWs.id);
        
        // 清理用户和房间
        if (extWs.userId) {
          const user = userManager.getUser(extWs.userId);
          if (user) {
            const room = roomManager.getRoomByUser(user.id);
            if (room) {
              const leaveMessage: ServerMessage = {
                type: 'userLeft',
                userId: user.id,
              };
              broadcastToRoom(room.id, leaveMessage, user.id);
            }
            roomManager.leaveRoom(user);
            userManager.removeUser(user.id);
          }
        }
        
        return extWs.terminate();
      }

      extWs.isAlive = false;
      extWs.ping();
    });
  }, 60000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const extWs = ws as ExtendedWebSocket;
    extWs.id = generateId();
    extWs.userId = null;
    extWs.roomId = null;
    extWs.isAlive = true;
    extWs.lastPing = now();

    // 解析 URL 中的 roomId 参数
    if (req.url) {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const roomId = url.searchParams.get('roomId');
        if (roomId) {
          extWs.pendingRoomId = roomId;
          console.log(`[CONN] Pending roomId from URL: ${roomId}`);
        }
      } catch (e) {
        // URL 解析失败，忽略
      }
    }

    socketMap.set(extWs.id, extWs);

    const clientIp = req.socket.remoteAddress || 'unknown';
    console.log(`[CONN] New connection: ${extWs.id} from ${clientIp}`);

    // 心跳响应
    extWs.on('pong', () => {
      extWs.isAlive = true;
      extWs.lastPing = now();
    });

    // 消息处理
    extWs.on('message', (data: Buffer) => {
      try {
        // 消息大小检查
        if (data.length > MAX_MESSAGE_SIZE) {
          console.log(`[${new Date().toISOString()}] [WARN] Message too large from ${extWs.id}: ${data.length} bytes`);
          sendToUser(extWs, { type: 'error', error: 'Message too large' });
          return;
        }

        const messageStr = data.toString('utf-8');
        handleMessage(extWs, messageStr);
      } catch (error) {
        log('error', '处理消息失败:', error);
      }
    });

    // 连接关闭
    extWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[CONN] Closed: ${extWs.id}, code: ${code}`);
      socketMap.delete(extWs.id);

      // 清理用户和房间 - 使用setImmediate避免阻塞
      if (extWs.userId) {
        setImmediate(() => {
          try {
            const user = userManager.getUser(extWs.userId!);
            if (user) {
              const room = roomManager.getRoomByUser(user.id);
              if (room) {
                const leaveMessage: ServerMessage = {
                  type: 'userLeft',
                  userId: user.id,
                };
                broadcastToRoom(room.id, leaveMessage, user.id);
              }
              roomManager.leaveRoom(user);
              userManager.removeUser(user.id);
            }
          } catch (error) {
            console.error(`[CONN] Error cleaning up ${extWs.id}:`, error);
          }
        });
      }
    });

    // 错误处理
    extWs.on('error', (error: Error) => {
      log('error', `WebSocket错误 (${extWs.id}):`, error);
    });
  });

  return wss;
}
