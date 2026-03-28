/**
 * 消息处理器
 */

import type { 
  ExtendedWebSocket, 
  ClientMessage, 
  ServerMessage,
  User,
  Room,
  MousePosition,
  NoteBatchOperation,
  MidiEvent,
  ProjectUpdate
} from '../types';
import { roomManager } from '../roomManager';
import { userManager } from '../userManager';
import { safeJsonParse, log, now, generateId, generateInviteCode } from '../utils';

/**
 * 广播消息给房间内所有用户
 */
export function broadcastToRoom(
  room: Room, 
  message: ServerMessage, 
  excludeUserId?: string
): void {
  const messageStr = JSON.stringify(message);
  
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    
    // 这里需要通过某种方式获取用户的WebSocket连接
    // 实际实现中我们会在连接管理器中维护这个映射
  }
}

/**
 * 发送消息给特定用户
 */
export function sendToUser(ws: ExtendedWebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * 处理认证消息
 */
export function handleAuth(ws: ExtendedWebSocket, username: string, roomId?: string): ServerMessage {
  const validation = userManager.validateUsername(username);
  
  if (!validation.valid) {
    return { type: 'authError', error: validation.error! };
  }

  const user = userManager.createUser(ws, username);
  
  // 构建用户信息
  const userInfo = {
    id: user.id,
    username: user.username,
    color: user.color,
    isHost: false,
  };

  // 如果提供了 roomId，尝试加入或创建房间
  if (roomId) {
    try {
      const room = roomManager.getOrCreateRoom(roomId, user);
      userInfo.isHost = room.hostId === user.id;
      return {
        type: 'authenticated',
        userId: user.id,
        user: userInfo,
        room: {
          id: room.id,
          inviteCode: room.inviteCode,
          name: room.name,
          hostId: room.hostId,
          userCount: room.users.size,
          maxUsers: room.maxUsers,
        },
        users: roomManager.getUsersInfo(room),
      };
    } catch (error) {
      // 加入房间失败（如房间已满），返回基本认证信息
      log('warn', `用户 ${username} 加入房间 ${roomId} 失败: ${error}`);
    }
  }

  // 没有房间或加入失败，返回基本认证信息
  return {
    type: 'authenticated',
    userId: user.id,
    user: userInfo,
    room: null,
    users: [],
  };
}

/**
 * 处理创建房间
 */
export function handleCreateRoom(ws: ExtendedWebSocket, user: User, name: string): ServerMessage {
  try {
    const room = roomManager.createRoom(user, name);
    
    return {
      type: 'roomCreated',
      room: roomManager.getRoomInfo(room),
    };
  } catch (error) {
    return {
      type: 'roomError',
      error: error instanceof Error ? error.message : '创建房间失败',
    };
  }
}

/**
 * 处理加入房间
 */
export function handleJoinRoom(
  ws: ExtendedWebSocket, 
  user: User, 
  inviteCode: string
): ServerMessage {
  try {
    const room = roomManager.joinRoom(inviteCode, user);
    
    if (!room) {
      return {
        type: 'roomError',
        error: '邀请码无效或房间不存在',
      };
    }

    return {
      type: 'roomJoined',
      room: roomManager.getRoomInfo(room),
      users: roomManager.getUsersInfo(room),
      projectState: room.projectState,
    };
  } catch (error) {
    return {
      type: 'roomError',
      error: error instanceof Error ? error.message : '加入房间失败',
    };
  }
}

/**
 * 处理离开房间
 */
export function handleLeaveRoom(ws: ExtendedWebSocket, user: User): ServerMessage | null {
  const room = roomManager.getRoomByUser(user.id);
  
  if (room) {
    roomManager.leaveRoom(user);
    
    // 通知房间内其他用户
    const leaveMessage: ServerMessage = {
      type: 'userLeft',
      userId: user.id,
    };
    
    broadcastToRoom(room, leaveMessage, user.id);
  }

  return null;
}

/**
 * 处理鼠标移动
 */
export function handleMouseMove(
  ws: ExtendedWebSocket,
  user: User,
  position: MousePosition
): void {
  userManager.updateMousePosition(user.id, position);
  
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  const message: ServerMessage = {
    type: 'mouseUpdate',
    userId: user.id,
    username: user.username,
    position,
    color: user.color,
  };

  broadcastToRoom(room, message, user.id);
}

/**
 * 处理音符批量操作
 */
export function handleNoteBatch(
  ws: ExtendedWebSocket,
  user: User,
  operation: NoteBatchOperation
): void {
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  // 更新项目状态
  if (room.projectState.midiData) {
    applyNoteOperation(room.projectState.midiData, operation);
    roomManager.updateProjectState(room.id, {}, user.id);
  }

  const message: ServerMessage = {
    type: 'noteBatchUpdate',
    userId: user.id,
    operation,
  };

  broadcastToRoom(room, message, user.id);
}

/**
 * 处理MIDI事件
 */
export function handleMidiEvent(
  ws: ExtendedWebSocket,
  user: User,
  event: MidiEvent
): void {
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventUpdate',
    userId: user.id,
    event,
  };

  broadcastToRoom(room, message, user.id);
}

/**
 * 处理MIDI事件批量传输
 */
export function handleMidiEventBatch(
  ws: ExtendedWebSocket,
  user: User,
  events: MidiEvent[]
): void {
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventBatchUpdate',
    userId: user.id,
    events,
  };

  broadcastToRoom(room, message, user.id);
}

/**
 * 处理项目状态更新
 */
export function handleProjectUpdate(
  ws: ExtendedWebSocket,
  user: User,
  update: ProjectUpdate
): void {
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  // 应用更新到房间状态
  if (update.type === 'viewState') {
    roomManager.updateProjectState(
      room.id,
      { viewState: update.data as any },
      user.id
    );
  }

  const message: ServerMessage = {
    type: 'projectStateUpdate',
    userId: user.id,
    update,
  };

  broadcastToRoom(room, message, user.id);
}

/**
 * 处理同步请求
 */
export function handleRequestSync(ws: ExtendedWebSocket, user: User): void {
  const room = roomManager.getRoomByUser(user.id);
  if (!room) return;

  const message: ServerMessage = {
    type: 'fullSync',
    projectState: room.projectState,
    users: roomManager.getUsersInfo(room),
  };

  sendToUser(ws, message);
}

/**
 * 处理ping
 */
export function handlePing(ws: ExtendedWebSocket, timestamp: number): void {
  const message: ServerMessage = {
    type: 'pong',
    timestamp,
    serverTime: now(),
  };

  sendToUser(ws, message);
}

/**
 * 应用音符操作到MIDI数据
 */
function applyNoteOperation(midiData: any, operation: NoteBatchOperation): void {
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
