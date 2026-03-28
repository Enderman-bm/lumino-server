/**
 * 加密工具模块
 * 用于密码哈希和文件加密
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { log } from './index';

const SALT_ROUNDS = 10;

/**
 * 密码哈希 - 使用bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  try {
    return await bcrypt.hash(password, SALT_ROUNDS);
  } catch (error) {
    log('error', '密码哈希失败', { error });
    throw new Error('密码加密失败');
  }
}

/**
 * 密码验证
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    log('error', '密码验证失败', { error });
    return false;
  }
}

/**
 * 生成文件哈希 (SHA256)
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 生成随机Token
 */
export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * 加密敏感数据 (用于传输)
 */
export function encryptData(data: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', 
    crypto.createHash('sha256').update(key).digest(), 
    iv
  );
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 解密数据
 */
export function decryptData(encrypted: string, key: string): string {
  try {
    const [ivHex, encryptedData] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', 
      crypto.createHash('sha256').update(key).digest(), 
      iv
    );
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    log('error', '数据解密失败', { error });
    return '';
  }
}
