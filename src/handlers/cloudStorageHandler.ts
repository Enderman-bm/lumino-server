/**
 * 云存储HTTP处理器
 * 处理文件上传、下载、删除和用户管理等REST API
 */

import { IncomingMessage, ServerResponse } from 'http';
import { authManager } from '../authManager';
import { backupManager } from '../backupManager';
import { log } from '../utils';

// 用户会话存储 (简单实现，生产环境建议用Redis)
const sessions: Map<string, { userId: string; isAdmin: boolean }> = new Map();

/**
 * 解析multipart/form-data上传
 */
async function parseMultipartForm(req: IncomingMessage): Promise<{
  fields: Record<string, string>;
  file?: { filename: string; buffer: Buffer };
}> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      const contentType = req.headers['content-type'] || '';
      
      if (contentType.includes('multipart/form-data')) {
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
          reject(new Error('No boundary found'));
          return;
        }

        const fullBuffer = Buffer.concat(chunks);
        const parts = fullBuffer.toString('binary').split(`--${boundary}`);
        
        const fields: Record<string, string> = {};
        let fileData: { filename: string; buffer: Buffer } | undefined;

        for (const part of parts) {
          if (part.includes('Content-Disposition')) {
            const headerEnd = part.indexOf('\r\n\r\n');
            const header = part.substring(0, headerEnd);
            const body = part.substring(headerEnd + 4).replace(/\r\n--$/, '');

            const nameMatch = header.match(/name="([^"]+)"/);
            const filenameMatch = header.match(/filename="([^"]+)"/);

            if (nameMatch) {
              const name = nameMatch[1];
              if (filenameMatch) {
                // 这是文件字段
                fileData = {
                  filename: filenameMatch[1],
                  buffer: Buffer.from(body, 'binary')
                };
              } else {
                // 普通字段
                fields[name] = body.replace(/\r\n$/, '');
              }
            }
          }
        }

        resolve({ fields, file: fileData });
      } else {
        // JSON body
        try {
          const body = Buffer.concat(chunks).toString();
          const fields = JSON.parse(body);
          resolve({ fields, file: undefined });
        } catch {
          resolve({ fields: {}, file: undefined });
        }
      }
    });

    req.on('error', reject);
  });
}

/**
 * 验证会话
 */
function getSession(req: IncomingMessage): { userId: string; isAdmin: boolean } | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;

  const token = authHeader.replace('Bearer ', '');
  return sessions.get(token) || null;
}

/**
 * 设置CORS头
 */
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * JSON响应
 */
function jsonResponse(res: ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * 处理云存储API路由
 */
export async function handleCloudStorageRoute(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url || '';
  const method = req.method || '';

  // 设置CORS头
  setCorsHeaders(res);

  // 处理预检请求
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return true;
  }

  // 登录
  if (url === '/api/auth/login' && method === 'POST') {
    try {
      const body = await parseMultipartForm(req);
      const { username, password } = body.fields;

      if (!username || !password) {
        jsonResponse(res, 400, { success: false, error: '用户名和密码不能为空' });
        return true;
      }

      const result = await authManager.login(username, password);
      
      if (result.success && result.userId) {
        // 创建会话
        const token = require('crypto').randomBytes(32).toString('hex');
        sessions.set(token, { 
          userId: result.userId, 
          isAdmin: result.isAdmin || false 
        });

        log('info', `用户登录: ${username}`, { userId: result.userId });

        jsonResponse(res, 200, {
          success: true,
          userId: result.userId,
          username: result.username,
          isAdmin: result.isAdmin,
          mustResetPwd: result.mustResetPwd,
          token
        });
      } else {
        jsonResponse(res, 401, { success: false, error: result.error });
      }
    } catch (error) {
      log('error', '登录处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 注册
  if (url === '/api/auth/register' && method === 'POST') {
    try {
      const body = await parseMultipartForm(req);
      const { username, password } = body.fields;

      if (!username || !password) {
        jsonResponse(res, 400, { success: false, error: '用户名和密码不能为空' });
        return true;
      }

      const result = await authManager.register(username, password);
      
      if (result.success && result.userId) {
        // 创建会话
        const token = require('crypto').randomBytes(32).toString('hex');
        sessions.set(token, { 
          userId: result.userId, 
          isAdmin: false 
        });

        log('info', `新用户注册: ${username}`, { userId: result.userId });

        jsonResponse(res, 200, {
          success: true,
          userId: result.userId,
          username: result.username,
          isAdmin: false,
          mustResetPwd: false,
          token
        });
      } else {
        jsonResponse(res, 400, { success: false, error: result.error });
      }
    } catch (error) {
      log('error', '注册处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 修改密码
  if (url === '/api/auth/change-password' && method === 'POST') {
    try {
      const session = getSession(req);
      if (!session) {
        jsonResponse(res, 401, { success: false, error: '未登录' });
        return true;
      }

      const body = await parseMultipartForm(req);
      const { oldPassword, newPassword } = body.fields;

      if (!oldPassword || !newPassword) {
        jsonResponse(res, 400, { success: false, error: '原密码和新密码不能为空' });
        return true;
      }

      const result = await authManager.changePassword(session.userId, oldPassword, newPassword);
      
      if (result.success) {
        jsonResponse(res, 200, { success: true });
      } else {
        jsonResponse(res, 400, { success: false, error: result.error });
      }
    } catch (error) {
      log('error', '修改密码处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 登出
  if (url === '/api/auth/logout' && method === 'POST') {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      sessions.delete(token);
    }
    jsonResponse(res, 200, { success: true });
    return true;
  }

  // 获取当前用户信息
  if (url === '/api/auth/me' && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    const result = await authManager.validateUser(session.userId);
    if (result.valid && result.user) {
      jsonResponse(res, 200, {
        success: true,
        ...result.user
      });
    } else {
      sessions.delete(req.headers['authorization']?.replace('Bearer ', '') || '');
      jsonResponse(res, 401, { success: false, error: '用户不存在' });
    }
    return true;
  }

  // 管理员: 获取用户列表
  if (url === '/api/admin/users' && method === 'GET') {
    const session = getSession(req);
    if (!session || !session.isAdmin) {
      jsonResponse(res, 403, { success: false, error: '没有管理员权限' });
      return true;
    }

    const result = await authManager.getUsers(session.userId);
    jsonResponse(res, result.success ? 200 : 400, result);
    return true;
  }

  // 管理员: 更新用户配额
  if (url.match(/^\/api\/admin\/users\/[^/]+\/quota$/) && method === 'PUT') {
    const session = getSession(req);
    if (!session || !session.isAdmin) {
      jsonResponse(res, 403, { success: false, error: '没有管理员权限' });
      return true;
    }

    try {
      const userId = url.split('/')[4];
      const body = await parseMultipartForm(req);
      const quota = parseInt(body.fields.quota);

      if (isNaN(quota) || quota < 0) {
        jsonResponse(res, 400, { success: false, error: '无效的配额值' });
        return true;
      }

      const result = await authManager.updateUserQuota(session.userId, userId, quota);
      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '更新配额处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 管理员: 重置用户密码
  if (url.match(/^\/api\/admin\/users\/[^/]+\/reset-password$/) && method === 'POST') {
    const session = getSession(req);
    if (!session || !session.isAdmin) {
      jsonResponse(res, 403, { success: false, error: '没有管理员权限' });
      return true;
    }

    try {
      const userId = url.split('/')[4];
      const body = await parseMultipartForm(req);
      const newPassword = body.fields.newPassword || '123456';

      const result = await authManager.adminResetPassword(session.userId, userId, newPassword);
      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '重置密码处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 管理员: 删除用户
  if (url.match(/^\/api\/admin\/users\/[^/]+$/) && method === 'DELETE') {
    const session = getSession(req);
    if (!session || !session.isAdmin) {
      jsonResponse(res, 403, { success: false, error: '没有管理员权限' });
      return true;
    }

    try {
      const userId = url.split('/')[4];
      const result = await authManager.deleteUser(session.userId, userId);

      if (result.success) {
        // 清理该用户的所有会话
        for (const [token, s] of sessions.entries()) {
          if (s.userId === userId) {
            sessions.delete(token);
          }
        }
      }

      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '删除用户处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '服务器错误' });
    }
    return true;
  }

  // 获取文件列表
  if (url === '/api/files' && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    const result = await backupManager.getFiles(session.userId, session.isAdmin);
    jsonResponse(res, result.success ? 200 : 400, result);
    return true;
  }

  // 上传文件
  if (url === '/api/files/upload' && method === 'POST') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    try {
      const formData = await parseMultipartForm(req);
      
      if (!formData.file) {
        jsonResponse(res, 400, { success: false, error: '没有选择文件' });
        return true;
      }

      const result = await backupManager.uploadFile(
        session.userId,
        formData.file.filename,
        formData.file.buffer,
        formData.fields.description
      );

      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '文件上传处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '文件上传失败' });
    }
    return true;
  }

  // 管理员: 为用户上传文件
  if (url.match(/^\/api\/admin\/files\/upload\/[^/]+$/) && method === 'POST') {
    const session = getSession(req);
    if (!session || !session.isAdmin) {
      jsonResponse(res, 403, { success: false, error: '没有管理员权限' });
      return true;
    }

    try {
      const targetUserId = url.split('/')[5];
      const formData = await parseMultipartForm(req);
      
      if (!formData.file) {
        jsonResponse(res, 400, { success: false, error: '没有选择文件' });
        return true;
      }

      const result = await backupManager.adminAddFile(
        session.userId,
        targetUserId,
        formData.file.filename,
        formData.file.buffer,
        formData.fields.description
      );

      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '管理员文件上传处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '文件上传失败' });
    }
    return true;
  }

  // 下载文件
  if (url.match(/^\/api\/files\/[^/]+\/download$/) && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    try {
      const fileId = url.split('/')[3];
      const result = await backupManager.getFile(fileId, session.userId, session.isAdmin);

      if (result.success && result.buffer) {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename || 'download')}"`,
          'Content-Length': result.buffer.length.toString()
        });
        res.end(result.buffer);
      } else {
        jsonResponse(res, 404, { success: false, error: result.error });
      }
    } catch (error) {
      log('error', '文件下载处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '文件下载失败' });
    }
    return true;
  }

  // 删除文件
  if (url.match(/^\/api\/files\/[^/]+$/) && method === 'DELETE') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    try {
      const fileId = url.split('/')[3];
      const result = await backupManager.deleteFile(fileId, session.userId, session.isAdmin);
      jsonResponse(res, result.success ? 200 : 400, result);
    } catch (error) {
      log('error', '文件删除处理错误', { error });
      jsonResponse(res, 500, { success: false, error: '文件删除失败' });
    }
    return true;
  }

  // 获取统计信息
  if (url === '/api/stats' && method === 'GET') {
    const session = getSession(req);
    if (!session) {
      jsonResponse(res, 401, { success: false, error: '未登录' });
      return true;
    }

    const result = await backupManager.getStats(session.userId, session.isAdmin);
    jsonResponse(res, result.success ? 200 : 400, result);
    return true;
  }

  // 未匹配到路由
  return false;
}

// 导出会话存储用于外部访问
export { sessions };
