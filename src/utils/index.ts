/**
 * 工具函数
 */

import { randomBytes, randomInt } from 'node:crypto';

/**
 * 生成随机邀请码 (6位字母数字)
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomInt(chars.length)];
  }
  return code;
}

/**
 * 生成UUID
 */
export function generateId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 为用户生成随机颜色
 */
export function generateUserColor(): string {
  const colors = [
    '#FF6B6B', // 红色
    '#4ECDC4', // 青色
    '#45B7D1', // 蓝色
    '#96CEB4', // 绿色
    '#FFEAA7', // 黄色
    '#DDA0DD', // 紫色
    '#98D8C8', // 薄荷绿
    '#F7DC6F', // 金色
    '#BB8FCE', // 淡紫
    '#85C1E9', // 天蓝
    '#F8C471', // 橙色
    '#82E0AA', // 浅绿
  ];
  return colors[randomInt(colors.length)];
}

/**
 * 获取当前时间戳
 */
export function now(): number {
  return Date.now();
}

/**
 * 格式化日志
 */
export function log(level: 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  switch (level) {
    case 'error':
      console.error(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    default:
      console.log(prefix, message, ...args);
  }
}

/**
 * 安全JSON解析
 */
export function safeJsonParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * 深克隆对象
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * 节流函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
