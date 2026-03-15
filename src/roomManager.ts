/**
 * 房间管理器
 */

import type { Room, User, ProjectState, RoomInfo, UserInfo, ExtendedWebSocket } from './types';
import { generateInviteCode, generateId, now, log } from './utils';

// 默认视图状态
const defaultViewState = {
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
};

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private inviteCodeToRoomId: Map<string, string> = new Map();
  private userToRoom: Map<string, string> = new Map();
  private readonly maxUsersPerRoom = 10;
  private kv: KVNamespace | null = null;

  constructor(kv?: KVNamespace) {
    this.kv = kv || null;
  }

  async loadFromKV(): Promise<void> {
    if (!this.kv) return;
    
    try {
      const roomsData = await this.kv.get('rooms', 'json');
      if (roomsData && Array.isArray(roomsData)) {
        // 恢复房间数据
        for (const room of roomsData) {
          // 重新创建 Map 对象
          const usersMap = new Map<string, any>();
          if (room.users) {
            for (const [userId, user] of Object.entries(room.users)) {
              usersMap.set(userId, user);
            }
          }
          room.users = usersMap;
          
          this.rooms.set(room.id, room);
          this.inviteCodeToRoomId.set(room.inviteCode, room.id);
          for (const [userId, user] of Object.entries(room.users || {})) {
            this.userToRoom.set(userId, room.id);
          }
        }
        console.log(`Loaded ${roomsData.length} rooms from KV`);
      }
    } catch (error) {
      console.error('Failed to load from KV:', error);
    }
  }

  async saveToKV(): Promise<void> {
    if (!this.kv) return;
    
    try {
      // 转换 Map 为普通对象以便序列化
      const roomsData = Array.from(this.rooms.values()).map(room => ({
        ...room,
        users: Object.fromEntries(room.users),
      }));
      await this.kv.put('rooms', JSON.stringify(roomsData));
      console.log(`Saved ${roomsData.length} rooms to KV`);
    } catch (error) {
      console.error('Failed to save to KV:', error);
    }
  }

  /**
   * 创建新房间
   */
  createRoom(hostUser: User, name: string): Room {
    const roomId = generateId();
    const inviteCode = this.generateUniqueInviteCode();

    const room: Room = {
      id: roomId,
      inviteCode,
      hostId: hostUser.id,
      name: name || `协作房间 ${inviteCode}`,
      createdAt: now(),
      users: new Map(),
      maxUsers: this.maxUsersPerRoom,
      projectState: {
        midiData: null,
        viewState: { ...defaultViewState },
        lastModified: now(),
        modifiedBy: null,
      },
    };

    // 添加房主到房间
    room.users.set(hostUser.id, hostUser);
    hostUser.roomId = roomId;

    this.rooms.set(roomId, room);
    this.inviteCodeToRoomId.set(inviteCode, roomId);
    this.userToRoom.set(hostUser.id, roomId);

    // 保存到 KV
    this.saveToKV().catch(console.error);

    log('info', `房间创建成功: ${roomId}, 邀请码: ${inviteCode}, 房主: ${hostUser.username}`);
    return room;
  }

  /**
   * 加入房间
   */
  joinRoom(inviteCode: string, user: User): Room | null {
    const roomId = this.inviteCodeToRoomId.get(inviteCode);
    if (!roomId) {
      return null;
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    // 检查房间是否已满
    if (room.users.size >= room.maxUsers) {
      throw new Error('房间已满');
    }

    // 如果用户已在其他房间，先离开
    if (user.roomId) {
      this.leaveRoom(user);
    }

    // 添加到新房间
    room.users.set(user.id, user);
    user.roomId = roomId;
    this.userToRoom.set(user.id, roomId);

    // 保存到 KV
    this.saveToKV().catch(console.error);

    log('info', `用户 ${user.username} 加入房间 ${roomId}`);
    return room;
  }

  /**
   * 离开房间
   */
  leaveRoom(user: User): boolean {
    const roomId = user.roomId;
    if (!roomId) return false;

    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.users.delete(user.id);
    this.userToRoom.delete(user.id);
    user.roomId = null;

    // 如果房间空了，删除房间
    if (room.users.size === 0) {
      this.deleteRoom(roomId);
    } else if (room.hostId === user.id) {
      // 如果房主离开，指定新房主
      const newHost = room.users.values().next().value;
      if (newHost) {
        room.hostId = newHost.id;
        log('info', `新房主: ${newHost.username}`);
      }
    }

    log('info', `用户离开房间 ${roomId}`);
    return true;
  }

  /**
   * 删除房间
   */
  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // 清理所有用户
    for (const user of room.users.values()) {
      user.roomId = null;
      this.userToRoom.delete(user.id);
    }

    this.inviteCodeToRoomId.delete(room.inviteCode);
    this.rooms.delete(roomId);

    log('info', `房间删除: ${roomId}`);
  }

  /**
   * 获取房间
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * 通过邀请码获取房间
   */
  getRoomByInviteCode(inviteCode: string): Room | undefined {
    const roomId = this.inviteCodeToRoomId.get(inviteCode);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  /**
   * 获取用户所在的房间
   */
  getRoomByUser(userId: string): Room | undefined {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return undefined;
    return this.rooms.get(roomId);
  }

  /**
   * 更新项目状态
   */
  updateProjectState(roomId: string, update: Partial<ProjectState>, modifiedBy: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.projectState = {
      ...room.projectState,
      ...update,
      lastModified: now(),
      modifiedBy,
    };
    return true;
  }

  /**
   * 获取房间信息（简化版）
   */
  getRoomInfo(room: Room): RoomInfo {
    return {
      id: room.id,
      inviteCode: room.inviteCode,
      name: room.name,
      hostId: room.hostId,
      userCount: room.users.size,
      maxUsers: room.maxUsers,
    };
  }

  /**
   * 获取房间内的用户信息列表
   */
  getUsersInfo(room: Room): UserInfo[] {
    return Array.from(room.users.values()).map((user: User) => ({
      id: user.id,
      username: user.username,
      color: user.color,
      isHost: user.id === room.hostId,
    }));
  }

  /**
   * 生成唯一邀请码
   */
  private generateUniqueInviteCode(): string {
    let code: string;
    do {
      code = generateInviteCode();
    } while (this.inviteCodeToRoomId.has(code));
    return code;
  }

  /**
   * 获取所有房间的统计信息
   */
  getStats(): { totalRooms: number; totalUsers: number } {
    let totalUsers = 0;
    for (const room of this.rooms.values()) {
      if (room.users && typeof room.users.size === 'number') {
        totalUsers += room.users.size;
      }
    }
    return {
      totalRooms: this.rooms.size,
      totalUsers: totalUsers,
    };
  }

  /**
   * 清理不活跃的房间（可选的定时任务）
   */
  cleanupInactiveRooms(maxInactiveTime: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [roomId, room] of this.rooms.entries()) {
      const inactiveTime = now - room.projectState.lastModified;
      if (room.users.size === 0 && inactiveTime > maxInactiveTime) {
        this.deleteRoom(roomId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log('info', `清理了 ${cleaned} 个不活跃房间`);
    }
    return cleaned;
  }
}

// 导出单例
export const roomManager = new RoomManager();
