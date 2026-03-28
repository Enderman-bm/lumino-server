/**
 * 备份管理器
 * 处理文件上传、下载、删除等操作
 */

import { PrismaClient } from './generated/prisma';
import { calculateFileHash } from './utils/encryption';
import { log } from './utils';
import { authManager } from './authManager';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  log('info', `创建上传目录: ${UPLOAD_DIR}`);
}

export interface UploadResult {
  success: boolean;
  file?: {
    id: string;
    filename: string;
    fileSize: number;
    uploadDate: string;
    description?: string;
  };
  error?: string;
}

export interface FileListResult {
  success: boolean;
  files?: Array<{
    id: string;
    filename: string;
    fileSize: number;
    fileHash?: string;
    description?: string;
    uploadDate: string;
    version: number;
    userId: string;
    username?: string;
  }>;
  totalSize?: number;
  usedStorage?: number;
  storageQuota?: number;
  storagePercent?: number;
  error?: string;
}

export class BackupManager {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * 上传文件
   */
  async uploadFile(
    userId: string,
    filename: string,
    buffer: Buffer,
    description?: string
  ): Promise<UploadResult> {
    try {
      // 获取用户信息
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        return { success: false, error: '用户不存在' };
      }

      // 计算文件大小 (MB)
      const fileSizeBytes = buffer.length;
      const fileSizeMB = Math.ceil(fileSizeBytes / (1024 * 1024));

      // 检查存储空间
      const remainingStorage = user.storageQuota - user.usedStorage;
      if (fileSizeMB > remainingStorage) {
        return { 
          success: false, 
          error: `存储空间不足。需要 ${fileSizeMB}MB，剩余 ${remainingStorage}MB` 
        };
      }

      // 计算文件哈希
      const fileHash = calculateFileHash(buffer);

      // 生成唯一文件名
      const ext = path.extname(filename);
      const basename = uuidv4() + ext;
      const userDir = path.join(UPLOAD_DIR, userId);

      // 确保用户目录存在
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      const filepath = path.join(userDir, basename);

      // 保存文件
      fs.writeFileSync(filepath, buffer);

      // 获取当前版本号
      const existingFiles = await this.prisma.backup.findMany({
        where: { userId, filename },
        orderBy: { version: 'desc' },
        take: 1
      });
      const nextVersion = existingFiles.length > 0 ? existingFiles[0].version + 1 : 1;

      // 记录到数据库
      const backup = await this.prisma.backup.create({
        data: {
          userId,
          filename,
          filepath: path.join(userId, basename),
          fileSize: fileSizeBytes,
          fileHash,
          description: description || null,
          version: nextVersion
        }
      });

      // 更新用户已用空间
      await this.prisma.user.update({
        where: { id: userId },
        data: { usedStorage: { increment: fileSizeMB } }
      });

      log('info', `文件上传: ${filename} (${user.username})`, { 
        fileSize: fileSizeMB, 
        fileHash,
        backupId: backup.id 
      });

      return {
        success: true,
        file: {
          id: backup.id,
          filename: backup.filename,
          fileSize: backup.fileSize,
          uploadDate: backup.uploadDate.toISOString(),
          description: backup.description || undefined
        }
      };
    } catch (error) {
      log('error', '文件上传失败', { userId, filename, error });
      return { success: false, error: '文件上传失败' };
    }
  }

  /**
   * 获取用户文件列表
   */
  async getFiles(userId: string, isAdmin: boolean = false): Promise<FileListResult> {
    try {
      let files;

      if (isAdmin) {
        // 管理员可以看到所有文件
        files = await this.prisma.backup.findMany({
          include: {
            user: {
              select: { username: true }
            }
          },
          orderBy: { uploadDate: 'desc' }
        });
      } else {
        // 普通用户只能看到自己的文件
        files = await this.prisma.backup.findMany({
          where: { userId },
          orderBy: { uploadDate: 'desc' }
        });
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      return {
        success: true,
        files: files.map(f => ({
          id: f.id,
          filename: f.filename,
          fileSize: f.fileSize,
          fileHash: f.fileHash || undefined,
          description: f.description || undefined,
          uploadDate: f.uploadDate.toISOString(),
          version: f.version,
          userId: f.userId,
          username: isAdmin ? (f as any).user?.username : undefined
        })),
        totalSize: files.reduce((sum, f) => sum + f.fileSize, 0),
        usedStorage: user?.usedStorage || 0,
        storageQuota: user?.storageQuota || 0,
        storagePercent: user ? Math.round((user.usedStorage / user.storageQuota) * 100) : 0
      };
    } catch (error) {
      log('error', '获取文件列表失败', { userId, error });
      return { success: false, error: '获取文件列表失败' };
    }
  }

  /**
   * 获取文件内容 (下载)
   */
  async getFile(fileId: string, userId: string, isAdmin: boolean = false): Promise<{
    success: boolean;
    buffer?: Buffer;
    filename?: string;
    fileSize?: number;
    error?: string;
  }> {
    try {
      const backup = await this.prisma.backup.findUnique({
        where: { id: fileId }
      });

      if (!backup) {
        return { success: false, error: '文件不存在' };
      }

      // 权限检查: 管理员可以下载任何文件，普通用户只能下载自己的
      if (!isAdmin && backup.userId !== userId) {
        return { success: false, error: '没有权限访问此文件' };
      }

      const filepath = path.join(UPLOAD_DIR, backup.filepath);

      // 检查文件是否存在
      if (!fs.existsSync(filepath)) {
        log('error', '文件系统中找不到文件', { filepath });
        return { success: false, error: '文件在服务器上不存在' };
      }

      const buffer = fs.readFileSync(filepath);

      log('info', `文件下载: ${backup.filename}`, { fileId, userId });

      return {
        success: true,
        buffer,
        filename: backup.filename,
        fileSize: backup.fileSize
      };
    } catch (error) {
      log('error', '文件下载失败', { fileId, error });
      return { success: false, error: '文件下载失败' };
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string, userId: string, isAdmin: boolean = false): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const backup = await this.prisma.backup.findUnique({
        where: { id: fileId }
      });

      if (!backup) {
        return { success: false, error: '文件不存在' };
      }

      // 权限检查: 管理员可以删除任何文件，普通用户只能删除自己的
      if (!isAdmin && backup.userId !== userId) {
        return { success: false, error: '没有权限删除此文件' };
      }

      // 删除文件系统中的文件
      const filepath = path.join(UPLOAD_DIR, backup.filepath);
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      // 删除数据库记录
      await this.prisma.backup.delete({
        where: { id: fileId }
      });

      // 更新用户已用空间
      const fileSizeMB = Math.ceil(backup.fileSize / (1024 * 1024));
      await this.prisma.user.update({
        where: { id: backup.userId },
        data: { usedStorage: { decrement: fileSizeMB } }
      });

      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      log('info', `文件删除: ${backup.filename}`, { fileId, username: user?.username });

      return { success: true };
    } catch (error) {
      log('error', '文件删除失败', { fileId, error });
      return { success: false, error: '文件删除失败' };
    }
  }

  /**
   * 管理员添加文件到用户空间
   */
  async adminAddFile(
    adminId: string,
    targetUserId: string,
    filename: string,
    buffer: Buffer,
    description?: string
  ): Promise<UploadResult> {
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

      // 为用户上传文件
      return await this.uploadFile(targetUserId, filename, buffer, description);
    } catch (error) {
      log('error', '管理员添加文件失败', { adminId, targetUserId, filename, error });
      return { success: false, error: '管理员添加文件失败' };
    }
  }

  /**
   * 获取文件统计
   */
  async getStats(userId: string, isAdmin: boolean = false): Promise<{
    success: boolean;
    totalFiles?: number;
    totalSize?: number;
    userCount?: number;
    error?: string;
  }> {
    try {
      if (isAdmin) {
        const totalFiles = await this.prisma.backup.count();
        const totalUsers = await this.prisma.user.count();
        const backups = await this.prisma.backup.findMany({
          select: { fileSize: true }
        });
        const totalSize = backups.reduce((sum, b) => sum + b.fileSize, 0);

        return {
          success: true,
          totalFiles,
          totalSize,
          userCount: totalUsers
        };
      } else {
        const totalFiles = await this.prisma.backup.count({
          where: { userId }
        });
        const backups = await this.prisma.backup.findMany({
          where: { userId },
          select: { fileSize: true }
        });
        const totalSize = backups.reduce((sum, b) => sum + b.fileSize, 0);

        return {
          success: true,
          totalFiles,
          totalSize
        };
      }
    } catch (error) {
      log('error', '获取统计信息失败', { userId, error });
      return { success: false, error: '获取统计信息失败' };
    }
  }
}

// 导出单例
export const backupManager = new BackupManager();
