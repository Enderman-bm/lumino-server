/**
 * 用户管理器
 */

import type { User, ExtendedWebSocket, MousePosition } from './types';
import { generateId, generateUserColor, now, log } from './utils';

export class UserManager {
  private users: Map<string, User> = new Map();
  private socketToUser: Map<string, string> = new Map();

  /**
   * 创建新用户 (Node.js version)
   */
  createUser(ws: ExtendedWebSocket, username: string): User {
    const userId = generateId();
    
    const user: User = {
      id: userId,
      username: username.trim().slice(0, 20), // 限制用户名长度
      socketId: ws.id,
      roomId: null,
      color: generateUserColor(),
      lastActive: now(),
      mousePosition: null,
    };

    this.users.set(userId, user);
    this.socketToUser.set(ws.id, userId);
    ws.userId = userId;

    log('info', `用户创建: ${user.username} (${userId})`);
    return user;
  }

  /**
   * 获取用户
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * 通过socket ID获取用户
   */
  getUserBySocket(socketId: string): User | undefined {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return undefined;
    return this.users.get(userId);
  }

  /**
   * 更新用户鼠标位置
   */
  updateMousePosition(userId: string, position: MousePosition): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    user.mousePosition = position;
    user.lastActive = now();
    return true;
  }

  /**
   * 更新用户最后活跃时间
   */
  updateLastActive(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.lastActive = now();
    }
  }

  /**
   * 删除用户
   */
  removeUser(userId: string): User | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;

    this.socketToUser.delete(user.socketId);
    this.users.delete(userId);

    log('info', `用户移除: ${user.username} (${userId})`);
    return user;
  }

  /**
   * 通过socket删除用户
   */
  removeUserBySocket(socketId: string): User | undefined {
    const userId = this.socketToUser.get(socketId);
    if (!userId) return undefined;
    return this.removeUser(userId);
  }

  /**
   * 检查用户名是否有效
   */
  validateUsername(username: string): { valid: boolean; error?: string } {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: '用户名不能为空' };
    }

    const trimmed = username.trim();
    
    if (trimmed.length === 0) {
      return { valid: false, error: '用户名不能为空' };
    }

    if (trimmed.length > 20) {
      return { valid: false, error: '用户名不能超过20个字符' };
    }

    // 检查非法字符
    if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-\s]+$/.test(trimmed)) {
      return { valid: false, error: '用户名包含非法字符' };
    }

    return { valid: true };
  }

  /**
   * 获取所有用户统计
   */
  getStats(): { totalUsers: number } {
    return {
      totalUsers: this.users.size,
    };
  }

  /**
   * 清理不活跃用户（可选的定时任务）
   */
  cleanupInactiveUsers(maxInactiveTime: number = 30 * 60 * 1000): number {
    const currentTime = now();
    let cleaned = 0;

    for (const [userId, user] of this.users.entries()) {
      if (currentTime - user.lastActive > maxInactiveTime) {
        this.removeUser(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log('info', `清理了 ${cleaned} 个不活跃用户`);
    }
    return cleaned;
  }
}

// 导出单例
export const userManager = new UserManager();
