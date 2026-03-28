/**
 * 认证管理器
 * 处理用户登录、注册、密码验证和管理
 */

import { PrismaClient, type User } from './generated/prisma';
import { hashPassword, verifyPassword, generateRandomToken } from './utils/encryption';
import { log } from './utils';

export interface AuthResult {
  success: boolean;
  userId?: string;
  username?: string;
  isAdmin?: boolean;
  mustResetPwd?: boolean;
  error?: string;
  token?: string;
}

export class AuthManager {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * 初始化管理员用户 (首次启动时调用)
   */
  async initializeAdmin(): Promise<void> {
    try {
      const adminUsername = 'admin';
      const existingAdmin = await this.prisma.user.findUnique({
        where: { username: adminUsername }
      });

      if (!existingAdmin) {
        // 创建管理员用户
        const adminPassword = process.env.ADMIN_PASSWORD || '123456';
        const hashedPassword = await hashPassword(adminPassword);
        
        await this.prisma.user.create({
          data: {
            username: adminUsername,
            passwordHash: hashedPassword,
            isAdmin: true,
            storageQuota: 10240, // 管理员 10GB
            usedStorage: 0,
            mustResetPwd: true, // 首次登录必须修改密码
          }
        });

        log('info', `管理员账户创建成功: ${adminUsername} / 初始密码: ${adminPassword}`);
      } else {
        log('info', `管理员账户已存在: ${adminUsername}`);
      }
    } catch (error) {
      log('error', '初始化管理员账户失败', { error });
    }
  }

  /**
   * 用户登录
   */
  async login(username: string, password: string): Promise<AuthResult> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { username }
      });

      if (!user) {
        return { success: false, error: '用户名或密码错误' };
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return { success: false, error: '用户名或密码错误' };
      }

      // 更新最后登录时间
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() }
      });

      // 生成登录Token
      const token = generateRandomToken(32);

      log('info', `用户登录成功: ${username}`, { userId: user.id });

      return {
        success: true,
        userId: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        mustResetPwd: user.mustResetPwd,
        token
      };
    } catch (error) {
      log('error', '登录失败', { username, error });
      return { success: false, error: '登录过程中发生错误' };
    }
  }

  /**
   * 用户注册
   */
  async register(username: string, password: string): Promise<AuthResult> {
    try {
      // 验证用户名格式
      if (!username || username.length < 3) {
        return { success: false, error: '用户名至少需要3个字符' };
      }

      if (!password || password.length < 6) {
        return { success: false, error: '密码至少需要6个字符' };
      }

      // 检查用户名是否存在
      const existingUser = await this.prisma.user.findUnique({
        where: { username }
      });

      if (existingUser) {
        return { success: false, error: '用户名已存在' };
      }

      // 哈希密码
      const hashedPassword = await hashPassword(password);

      // 创建用户
      const user = await this.prisma.user.create({
        data: {
          username,
          passwordHash: hashedPassword,
          isAdmin: false,
          storageQuota: 2048, // 默认 2GB
          usedStorage: 0,
          mustResetPwd: false,
        }
      });

      log('info', `新用户注册: ${username}`, { userId: user.id });

      const token = generateRandomToken(32);

      return {
        success: true,
        userId: user.id,
        username: user.username,
        isAdmin: false,
        mustResetPwd: false,
        token
      };
    } catch (error) {
      log('error', '注册失败', { username, error });
      return { success: false, error: '注册过程中发生错误' };
    }
  }

  /**
   * 修改密码
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<AuthResult> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return { success: false, error: '用户不存在' };
      }

      // 验证旧密码
      const isValid = await verifyPassword(oldPassword, user.passwordHash);
      if (!isValid) {
        return { success: false, error: '原密码错误' };
      }

      // 验证新密码强度
      if (newPassword.length < 6) {
        return { success: false, error: '新密码至少需要6个字符' };
      }

      // 哈希新密码
      const hashedPassword = await hashPassword(newPassword);

      // 更新密码
      await this.prisma.user.update({
        where: { id: userId },
        data: { 
          passwordHash: hashedPassword,
          mustResetPwd: false 
        }
      });

      log('info', `用户修改密码: ${user.username}`);

      return {
        success: true,
        userId: user.id,
        username: user.username
      };
    } catch (error) {
      log('error', '修改密码失败', { userId, error });
      return { success: false, error: '修改密码过程中发生错误' };
    }
  }

  /**
   * 管理员重置用户密码
   */
  async adminResetPassword(adminId: string, targetUserId: string, newPassword: string): Promise<AuthResult> {
    try {
      // 验证管理员权限
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId }
      });

      if (!admin || !admin.isAdmin) {
        return { success: false, error: '没有管理员权限' };
      }

      // 验证目标用户
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetUserId }
      });

      if (!targetUser) {
        return { success: false, error: '目标用户不存在' };
      }

      // 不能重置自己的密码
      if (targetUserId === adminId) {
        return { success: false, error: '不能重置自己的密码' };
      }

      // 哈希新密码
      const hashedPassword = await hashPassword(newPassword);

      // 更新密码并设置必须修改标记
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { 
          passwordHash: hashedPassword,
          mustResetPwd: true
        }
      });

      log('info', `管理员重置用户密码: ${admin.username} -> ${targetUser.username}`);

      return {
        success: true,
        userId: targetUser.id,
        username: targetUser.username
      };
    } catch (error) {
      log('error', '管理员重置密码失败', { adminId, targetUserId, error });
      return { success: false, error: '重置密码过程中发生错误' };
    }
  }

  /**
   * 获取用户列表 (管理员专用)
   */
  async getUsers(adminId: string) {
    try {
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId }
      });

      if (!admin || !admin.isAdmin) {
        return { success: false, error: '没有管理员权限' };
      }

      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          username: true,
          isAdmin: true,
          storageQuota: true,
          usedStorage: true,
          mustResetPwd: true,
          createdAt: true,
          lastLogin: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        users: users.map((u: {
          id: string;
          username: string;
          isAdmin: boolean;
          storageQuota: number;
          usedStorage: number;
          mustResetPwd: boolean;
          createdAt: Date;
          lastLogin: Date | null;
        }) => ({
          ...u,
          storageRemaining: u.storageQuota - u.usedStorage,
          storagePercent: u.storageQuota > 0 ? Math.round((u.usedStorage / u.storageQuota) * 100) : 0
        }))
      };
    } catch (error) {
      log('error', '获取用户列表失败', { adminId, error });
      return { success: false, error: '获取用户列表失败' };
    }
  }

  /**
   * 更新用户存储配额 (管理员)
   */
  async updateUserQuota(adminId: string, userId: string, newQuota: number): Promise<AuthResult> {
    try {
      // 验证管理员权限
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId }
      });

      if (!admin || !admin.isAdmin) {
        return { success: false, error: '没有管理员权限' };
      }

      // 更新配额
      await this.prisma.user.update({
        where: { id: userId },
        data: { storageQuota: newQuota }
      });

      const user = await this.prisma.user.findUnique({ where: { id: userId } });

      log('info', `管理员更新用户配额: ${admin.username} -> ${user?.username} (${newQuota}MB)`);

      return {
        success: true,
        userId: user?.id,
        username: user?.username
      };
    } catch (error) {
      log('error', '更新配额失败', { adminId, userId, newQuota, error });
      return { success: false, error: '更新配额失败' };
    }
  }

  /**
   * 删除用户 (管理员)
   */
  async deleteUser(adminId: string, userId: string): Promise<AuthResult> {
    try {
      // 验证管理员权限
      const admin = await this.prisma.user.findUnique({
        where: { id: adminId }
      });

      if (!admin || !admin.isAdmin) {
        return { success: false, error: '没有管理员权限' };
      }

      // 不能删除自己
      if (userId === adminId) {
        return { success: false, error: '不能删除自己的账户' };
      }

      // 不能删除主管理员
      const targetUser = await this.prisma.user.findUnique({ where: { id: userId } });
      if (targetUser?.username === 'admin') {
        return { success: false, error: '不能删除主管理员账户' };
      }

      // 删除用户及其所有备份 (通过关系删除)
      await this.prisma.user.delete({
        where: { id: userId }
      });

      log('info', `管理员删除用户: ${admin.username} -> ${targetUser?.username}`);

      return {
        success: true,
        userId,
        username: targetUser?.username
      };
    } catch (error) {
      log('error', '删除用户失败', { adminId, userId, error });
      return { success: false, error: '删除用户失败' };
    }
  }

  /**
   * 验证用户会话
   */
  async validateUser(userId: string): Promise<{ valid: boolean; user?: any; error?: string }> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          isAdmin: true,
          storageQuota: true,
          usedStorage: true,
          mustResetPwd: true
        }
      });

      if (!user) {
        return { valid: false, error: '用户不存在' };
      }

      return { valid: true, user };
    } catch (error) {
      log('error', '验证用户会话失败', { userId, error });
      return { valid: false, error: '验证失败' };
    }
  }
}

// 导出单例
export const authManager = new AuthManager();
