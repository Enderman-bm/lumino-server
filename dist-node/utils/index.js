"use strict";
/**
 * 工具函数
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateInviteCode = generateInviteCode;
exports.generateId = generateId;
exports.generateUserColor = generateUserColor;
exports.now = now;
exports.log = log;
exports.safeJsonParse = safeJsonParse;
exports.deepClone = deepClone;
exports.debounce = debounce;
exports.throttle = throttle;
const node_crypto_1 = require("node:crypto");
/**
 * 生成随机邀请码 (6位字母数字)
 */
function generateInviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[(0, node_crypto_1.randomInt)(chars.length)];
    }
    return code;
}
/**
 * 生成UUID
 */
function generateId() {
    return (0, node_crypto_1.randomBytes)(16).toString('hex');
}
/**
 * 为用户生成随机颜色
 */
function generateUserColor() {
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
    return colors[(0, node_crypto_1.randomInt)(colors.length)];
}
/**
 * 获取当前时间戳
 */
function now() {
    return Date.now();
}
/**
 * 格式化日志
 */
function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    switch (level) {
        case 'error':
            console.error(prefix, message, ...args);
            break;
        case 'warn':
            console.warn(prefix, message, ...args);
            break;
        case 'debug':
            console.debug(prefix, message, ...args);
            break;
        default:
            console.log(prefix, message, ...args);
    }
    // 广播到日志客户端（使用动态导入避免循环依赖）
    try {
        const indexModule = require('../index');
        if (indexModule.broadcastLog) {
            indexModule.broadcastLog(level, message, args.length > 0 ? args : undefined);
        }
    }
    catch (e) {
        // 忽略错误，可能是在启动阶段
    }
}
/**
 * 安全JSON解析
 */
function safeJsonParse(str) {
    try {
        return JSON.parse(str);
    }
    catch {
        return null;
    }
}
/**
 * 深克隆对象
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}
/**
 * 防抖函数
 */
function debounce(func, wait) {
    let timeout = null;
    return (...args) => {
        if (timeout)
            clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}
/**
 * 节流函数
 */
function throttle(func, limit) {
    let inThrottle = false;
    return (...args) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}
