/**
 * Room Durable Object - 管理单个房间的状态和所有 WebSocket 连接
 * 
 * 架构说明：
 * 1. 每个房间对应一个 RoomDurableObject 实例
 * 2. 所有房间的 WebSocket 连接都在此 Durable Object 内管理
 * 3. 消息广播在同一 Durable Object 内完成，避免了跨 Worker I/O 限制
 */

import type { UserInfo, ProjectState } from './types';

// RoomState 类型定义（内部使用）
interface RoomState {
  id: string;
  inviteCode: string;
  hostId: string;
  name: string;
  createdAt: number;
  maxUsers: number;
  projectState: ProjectState;
}

export class RoomDurableObject {
  private ctx: DurableObjectState;
  private env: any;
  private roomState: RoomState | null = null;
  // WebSocket -> userId 映射
  private wsConnections: Map<WebSocket, string> = new Map();
  // userId -> userInfo 映射
  private users: Map<string, UserInfo> = new Map();

  constructor(state: DurableObjectState, env: any) {
    this.ctx = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`[RoomDurableObject] ${request.method} ${path}`);

    // WebSocket 升级
    if (path === '/ws' || path === '/room/ws' || path === '/') {
      return this.handleWebSocketUpgrade(request);
    }

    // API: 创建房间
    if (path === '/room/create' && request.method === 'POST') {
      return this.handleCreateRoom(request);
    }

    // API: 获取房间状态
    if (path === '/room/state' && request.method === 'GET') {
      return this.handleGetRoomState();
    }

    // 404
    return new Response('Not Found', { status: 404 });
  }

  /**
   * 处理 WebSocket 升级
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    
    // 等待认证消息
    console.log('[RoomDurableObject] WebSocket connected, waiting for auth');
    
    // 设置认证超时
    const authTimeout = setTimeout(() => {
      console.log('[RoomDurableObject] Auth timeout, closing connection');
      try {
        server.close(1008, 'Authentication timeout');
      } catch (e) {
        // 连接可能已关闭
      }
    }, 10000);

    // 暂时存储连接，等待认证
    let userId: string | null = null;
    let userInfo: UserInfo | null = null;

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        // 处理认证消息
        if (data.type === 'auth') {
          clearTimeout(authTimeout);
          
          const newUserId = data.userId || this.generateUserId();
          const newUserInfo: UserInfo = {
            id: newUserId,
            username: data.username || 'Anonymous',
            color: data.color || this.generateRandomColor(),
            isHost: this.users.size === 0 || data.userId === this.roomState?.hostId,
          };
          
          // 更新外部变量
          userId = newUserId;
          userInfo = newUserInfo;

          // 检查房间是否已满
          if (this.users.size >= (this.roomState?.maxUsers || 10)) {
            server.send(JSON.stringify({
              type: 'error',
              error: 'Room is full'
            }));
            server.close(1008, 'Room is full');
            return;
          }

          // 注册连接
          this.wsConnections.set(server, newUserId);
          this.users.set(newUserId, newUserInfo);

          console.log(`[RoomDurableObject] User ${newUserInfo.username} (${newUserId}) authenticated`);

          // 发送认证成功消息
          server.send(JSON.stringify({
            type: 'authenticated',
            userId: newUserId,
            user: newUserInfo,
            room: this.getRoomInfo(),
            users: Array.from(this.users.values()),
          }));

          // 广播用户加入
          this.broadcast({
            type: 'userJoined',
            user: newUserInfo,
          }, newUserId);

          return;
        }

        // 如果未认证，忽略消息（除了 auth）
        if (!userId) {
          server.send(JSON.stringify({
            type: 'error',
            error: 'Not authenticated. Send auth message first.'
          }));
          return;
        }

        // 处理其他消息
        await this.handleClientMessage(server, userId, data);
        
      } catch (error) {
        console.error('[RoomDurableObject] Message handling error:', error);
        try {
          server.send(JSON.stringify({
            type: 'error',
            error: 'Failed to process message'
          }));
        } catch (e) {
          // 连接可能已关闭
        }
      }
    });

    server.addEventListener('close', () => {
      clearTimeout(authTimeout);
      
      if (userId) {
        console.log(`[RoomDurableObject] User ${userId} disconnected`);
        
        // 从房间中移除用户
        this.wsConnections.delete(server);
        this.users.delete(userId);
        
        // 广播用户离开
        this.broadcast({
          type: 'userLeft',
          userId,
        });

        // 如果没有用户了，清理房间状态
        if (this.users.size === 0) {
          console.log('[RoomDurableObject] Room is empty, clearing state');
          this.roomState = null;
        }
      }
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * 处理客户端消息
   */
  private async handleClientMessage(ws: WebSocket, userId: string, message: any): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;

    console.log(`[RoomDurableObject] Handling message type: ${message.type} from ${userId}`);

    switch (message.type) {
      case 'mouseMove':
        // 广播鼠标位置给房间内其他用户
        this.broadcast({
          type: 'mouseUpdate',
          userId,
          username: user.username,
          position: message.position,
          color: user.color,
        }, userId);
        break;

      case 'noteBatch':
        // 广播音符操作
        this.broadcast({
          type: 'noteBatchUpdate',
          userId,
          operation: message.notes,
        }, userId);
        break;

      case 'midiEvent':
        // 广播 MIDI 事件
        this.broadcast({
          type: 'midiEventUpdate',
          userId,
          event: message.event,
        }, userId);
        break;

      case 'midiEventBatch':
        // 批量 MIDI 事件
        this.broadcast({
          type: 'midiEventBatchUpdate',
          userId,
          events: message.events,
        }, userId);
        break;

      case 'projectUpdate':
        // 广播项目更新
        this.broadcast({
          type: 'projectStateUpdate',
          userId,
          update: message.update,
        }, userId);
        break;

      case 'requestSync':
        // 发送完整同步数据给请求者
        ws.send(JSON.stringify({
          type: 'fullSync',
          projectState: this.roomState?.projectState,
          users: Array.from(this.users.values()),
        }));
        break;

      case 'ping':
        // 心跳响应
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: message.timestamp,
          serverTime: Date.now(),
        }));
        break;

      case 'chat':
        // 广播聊天消息
        this.broadcast({
          type: 'chatMessage',
          userId,
          username: user.username,
          message: message.message,
          timestamp: Date.now(),
        });
        break;

      default:
        console.log(`[RoomDurableObject] Unknown message type: ${message.type}`);
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`
        }));
    }
  }

  /**
   * 广播消息给房间内所有用户
   * @param message 消息内容
   * @param excludeUserId 可选，排除的用户 ID（不发送给该用户）
   */
  private broadcast(message: any, excludeUserId?: string): void {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    this.wsConnections.forEach((userId, ws) => {
      if (excludeUserId && userId === excludeUserId) {
        return;
      }
      
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error(`[RoomDurableObject] Failed to send to ${userId}:`, error);
        }
      }
    });

    console.log(`[RoomDurableObject] Broadcasted to ${sentCount} users (excluded: ${excludeUserId || 'none'})`);
  }

  /**
   * 处理创建房间
   */
  private async handleCreateRoom(request: Request): Promise<Response> {
    try {
      const body: any = await request.json();
      
      const inviteCode = body.inviteCode || this.generateInviteCode();
      
      this.roomState = {
        id: inviteCode,
        inviteCode,
        hostId: body.hostId,
        name: body.name || `Room ${inviteCode}`,
        createdAt: Date.now(),
        users: new Map(),
        maxUsers: 10,
        projectState: {
          midiData: null,
          viewState: {
            scroll_x: 0,
            scroll_y: 0,
            zoom_x: 0.1,
            zoom_y: 20,
            total_ticks: 1920 * 4 * 100,
            key_count: 128,
            visible_key_count: 128,
            ppq: 1920,
            keyboard_width: 120,
            snap_precision: 960,
            default_note_length: 960,
          },
          lastModified: Date.now(),
          modifiedBy: null,
        },
      };

      console.log(`[RoomDurableObject] Room created: ${inviteCode}`);

      return new Response(
        JSON.stringify(this.roomState),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('[RoomDurableObject] Create room error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to create room' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  /**
   * 处理获取房间状态
   */
  private handleGetRoomState(): Response {
    if (!this.roomState) {
      return new Response(
        JSON.stringify({ error: 'Room not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ...this.roomState,
        users: Array.from(this.users.values()),
        userCount: this.users.size,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  /**
   * 获取房间信息（简化版）
   */
  private getRoomInfo(): any {
    if (!this.roomState) return null;
    
    return {
      id: this.roomState.id,
      inviteCode: this.roomState.inviteCode,
      name: this.roomState.name,
      hostId: this.roomState.hostId,
      userCount: this.users.size,
      maxUsers: this.roomState.maxUsers,
    };
  }

  /**
   * 生成邀请码
   */
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * 生成随机颜色
   */
  private generateRandomColor(): string {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * 生成用户 ID
   */
  private generateUserId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}

// RoomState 类型定义
interface RoomState {
  id: string;
  inviteCode: string;
  hostId: string;
  name: string;
  createdAt: number;
  users: Map<string, UserInfo>;
  maxUsers: number;
  projectState: ProjectState;
}
