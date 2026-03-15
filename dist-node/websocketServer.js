"use strict";
/**
 * WebSocket 服务器
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSocketServer = createWebSocketServer;
const ws_1 = require("ws");
const roomManager_1 = require("./roomManager");
const userManager_1 = require("./userManager");
const utils_1 = require("./utils");
const messageHandler = __importStar(require("./handlers/messageHandler"));
// 检查是否在开发模式
const isDevMode = true; // 强制启用开发日志
// 开发模式事件日志
function logEvent(direction, socketId, userId, message) {
    const timestamp = new Date().toISOString();
    const userInfo = userId ? `user:${userId}` : 'unauthenticated';
    const messageType = message.type || 'unknown';
    console.log(`[${timestamp}] [EVENT] ${direction} id:${socketId} ${userInfo} type:${messageType}`);
    // 打印完整消息内容以便调试
    try {
        const dataStr = JSON.stringify(message, null, 2);
        console.log(`  Data: ${dataStr.length > 1000 ? dataStr.substring(0, 1000) + '... (truncated)' : dataStr}`);
    }
    catch (e) {
        console.log(`  Data: [Error serializing message]`);
    }
}
// 存储socket到WebSocket的映射
const socketMap = new Map();
/**
 * 广播消息给房间内所有用户（带实际WebSocket发送）
 */
function broadcastToRoom(roomId, message, excludeUserId) {
    const room = roomManager_1.roomManager.getRoom(roomId);
    if (!room)
        return;
    const messageStr = JSON.stringify(message);
    for (const user of room.users.values()) {
        if (excludeUserId && user.id === excludeUserId)
            continue;
        // 通过socketId找到WebSocket连接
        const ws = socketMap.get(user.socketId);
        if (ws && ws.readyState === ws_1.WebSocket.OPEN) {
            // 开发模式：记录广播的消息
            logEvent('SEND', ws.id, ws.userId, message);
            ws.send(messageStr);
        }
    }
}
/**
 * 发送消息给特定用户
 */
function sendToUser(ws, message) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        // 开发模式：记录发送的消息
        logEvent('SEND', ws.id, ws.userId, message);
        const messageStr = JSON.stringify(message);
        console.log(`[${new Date().toISOString()}] [DEBUG] SENDING to ${ws.id}: ${messageStr.substring(0, 500)}`);
        ws.send(messageStr);
    }
    else {
        console.log(`[${new Date().toISOString()}] [ERROR] Cannot send to ${ws.id}: readyState=${ws.readyState}`);
    }
}
/**
 * 处理客户端消息
 */
function handleMessage(ws, data) {
    console.log(`[${new Date().toISOString()}] [DEBUG] RAW MESSAGE from ${ws.id}: ${data.substring(0, 500)}`);
    const message = (0, utils_1.safeJsonParse)(data);
    if (!message || !message.type) {
        console.log(`[${new Date().toISOString()}] [ERROR] Invalid message format from ${ws.id}`);
        sendToUser(ws, { type: 'error', error: '无效的消息格式' });
        return;
    }
    console.log(`[${new Date().toISOString()}] [DEBUG] Parsed message type: ${message.type} from ${ws.id}`);
    // 开发模式：记录接收到的消息
    logEvent('RECV', ws.id, ws.userId, message);
    // 记录原始数据字符串的一部分，以确保解析没有屏蔽掉东西
    if (isDevMode) {
        console.log(`  Raw: ${data.length > 200 ? data.substring(0, 200) + '...' : data}`);
    }
    const user = ws.userId ? userManager_1.userManager.getUser(ws.userId) : null;
    try {
        switch (message.type) {
            case 'auth': {
                const response = messageHandler.handleAuth(ws, message.username);
                sendToUser(ws, response);
                // 如果是认证成功，创建用户后重新获取
                if (response.type === 'authSuccess') {
                    const newUser = userManager_1.userManager.getUser(response.userId);
                    if (newUser) {
                        // 更新messageHandler中的broadcast函数
                    }
                }
                break;
            }
            case 'createRoom': {
                if (!user) {
                    sendToUser(ws, { type: 'roomError', error: '请先登录' });
                    return;
                }
                const response = messageHandler.handleCreateRoom(ws, user, message.name);
                sendToUser(ws, response);
                if (response.type === 'roomCreated') {
                    // 通知房间内其他用户（如果有的话）
                }
                break;
            }
            case 'joinRoom': {
                console.log(`[${new Date().toISOString()}] [DEBUG] Processing joinRoom for user ${user?.id}, inviteCode: ${message.inviteCode}`);
                if (!user) {
                    console.log(`[${new Date().toISOString()}] [ERROR] joinRoom failed: user not authenticated`);
                    sendToUser(ws, { type: 'roomError', error: '请先登录' });
                    return;
                }
                const response = messageHandler.handleJoinRoom(ws, user, message.inviteCode);
                console.log(`[${new Date().toISOString()}] [DEBUG] joinRoom response: ${response.type}`);
                sendToUser(ws, response);
                if (response.type === 'roomJoined') {
                    console.log(`[${new Date().toISOString()}] [INFO] User ${user.username} (${user.id}) joined room successfully`);
                    // 通知房间内其他用户有新用户加入
                    const room = roomManager_1.roomManager.getRoomByUser(user.id);
                    if (room) {
                        const joinMessage = {
                            type: 'userJoined',
                            user: {
                                id: user.id,
                                username: user.username,
                                color: user.color,
                                isHost: room.hostId === user.id,
                            },
                        };
                        broadcastToRoom(room.id, joinMessage, user.id);
                    }
                }
                else if (response.type === 'roomError') {
                    console.log(`[${new Date().toISOString()}] [ERROR] joinRoom failed: ${response.error}`);
                }
                break;
            }
            case 'leaveRoom': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    // 先广播离开消息
                    const leaveMessage = {
                        type: 'userLeft',
                        userId: user.id,
                    };
                    broadcastToRoom(room.id, leaveMessage, user.id);
                    // 然后处理离开逻辑
                    roomManager_1.roomManager.leaveRoom(user);
                    ws.roomId = null;
                }
                break;
            }
            case 'mouseMove': {
                if (!user)
                    return;
                userManager_1.userManager.updateMousePosition(user.id, message.position);
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    const updateMessage = {
                        type: 'mouseUpdate',
                        userId: user.id,
                        username: user.username,
                        position: message.position,
                        color: user.color,
                    };
                    broadcastToRoom(room.id, updateMessage, user.id);
                }
                break;
            }
            case 'noteBatch': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    // 更新项目状态
                    if (room.projectState.midiData) {
                        applyNoteOperation(room.projectState.midiData, message.notes);
                        roomManager_1.roomManager.updateProjectState(room.id, {}, user.id);
                    }
                    const updateMessage = {
                        type: 'noteBatchUpdate',
                        userId: user.id,
                        operation: message.notes,
                    };
                    broadcastToRoom(room.id, updateMessage, user.id);
                }
                break;
            }
            case 'midiEvent': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    const updateMessage = {
                        type: 'midiEventUpdate',
                        userId: user.id,
                        event: message.event,
                    };
                    broadcastToRoom(room.id, updateMessage, user.id);
                }
                break;
            }
            case 'midiEventBatch': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    const updateMessage = {
                        type: 'midiEventBatchUpdate',
                        userId: user.id,
                        events: message.events,
                    };
                    broadcastToRoom(room.id, updateMessage, user.id);
                }
                break;
            }
            case 'projectUpdate': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    // 应用更新到房间状态
                    if (message.update.type === 'viewState') {
                        roomManager_1.roomManager.updateProjectState(room.id, { viewState: message.update.data }, user.id);
                    }
                    const updateMessage = {
                        type: 'projectStateUpdate',
                        userId: user.id,
                        update: message.update,
                    };
                    broadcastToRoom(room.id, updateMessage, user.id);
                }
                break;
            }
            case 'requestSync': {
                if (!user)
                    return;
                const room = roomManager_1.roomManager.getRoomByUser(user.id);
                if (room) {
                    const syncMessage = {
                        type: 'fullSync',
                        projectState: room.projectState,
                        users: roomManager_1.roomManager.getUsersInfo(room),
                    };
                    sendToUser(ws, syncMessage);
                }
                break;
            }
            case 'ping': {
                messageHandler.handlePing(ws, message.timestamp);
                break;
            }
            case 'subscribeLogs': {
                // 标记为日志客户端
                ws.isLogClient = true;
                // 发送历史日志
                const { logBuffer } = require('./index');
                const historyMessage = {
                    type: 'logHistory',
                    logs: logBuffer.slice(-100), // 发送最近100条
                };
                sendToUser(ws, historyMessage);
                console.log(`[${new Date().toISOString()}] [INFO] Log client subscribed: ${ws.id}`);
                break;
            }
            default:
                sendToUser(ws, { type: 'error', error: `未知的消息类型: ${message.type}` });
        }
    }
    catch (error) {
        (0, utils_1.log)('error', '处理消息时出错:', error);
        sendToUser(ws, {
            type: 'error',
            error: error instanceof Error ? error.message : '处理消息失败'
        });
    }
}
/**
 * 应用音符操作到MIDI数据
 */
function applyNoteOperation(midiData, operation) {
    if (!midiData.tracks)
        return;
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
                    track.notes = track.notes.filter((n) => n.id !== note.id);
                }
            }
            break;
        case 'update':
            for (const note of operation.notes) {
                const track = midiData.tracks[note.trackIndex];
                if (track) {
                    const index = track.notes.findIndex((n) => n.id === note.id);
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
        case 'copy':
            // 复制操作不需要修改服务器状态，只是客户端操作
            break;
        case 'paste':
            // 粘贴操作 - 复制音符并添加到目标位置
            if (operation.targetTrack !== undefined) {
                const targetTrack = midiData.tracks[operation.targetTrack];
                if (targetTrack) {
                    for (const note of operation.notes) {
                        const newNote = {
                            ...note,
                            id: (0, utils_1.generateId)(),
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
/**
 * 创建WebSocket服务器
 */
function createWebSocketServer(server) {
    const wss = new ws_1.WebSocketServer({
        server,
        path: '/ws',
        perMessageDeflate: {
            zlibDeflateOptions: {
                chunkSize: 1024,
                memLevel: 7,
                level: 3,
            },
            zlibInflateOptions: {
                chunkSize: 10 * 1024,
            },
            clientNoContextTakeover: true,
            serverNoContextTakeover: true,
            serverMaxWindowBits: 10,
            concurrencyLimit: 10,
        },
    });
    // 心跳检测
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            const extWs = ws;
            if (!extWs.isAlive) {
                (0, utils_1.log)('info', `终止不活跃的连接: ${extWs.id}`);
                socketMap.delete(extWs.id);
                // 清理用户和房间
                if (extWs.userId) {
                    const user = userManager_1.userManager.getUser(extWs.userId);
                    if (user) {
                        const room = roomManager_1.roomManager.getRoomByUser(user.id);
                        if (room) {
                            const leaveMessage = {
                                type: 'userLeft',
                                userId: user.id,
                            };
                            broadcastToRoom(room.id, leaveMessage, user.id);
                        }
                        roomManager_1.roomManager.leaveRoom(user);
                        userManager_1.userManager.removeUser(user.id);
                    }
                }
                return extWs.terminate();
            }
            extWs.isAlive = false;
            extWs.ping();
        });
    }, 30000);
    wss.on('close', () => {
        clearInterval(interval);
    });
    wss.on('connection', (ws, req) => {
        const extWs = ws;
        extWs.id = (0, utils_1.generateId)();
        extWs.userId = null;
        extWs.roomId = null;
        extWs.isAlive = true;
        extWs.lastPing = (0, utils_1.now)();
        socketMap.set(extWs.id, extWs);
        const clientIp = req.socket.remoteAddress || 'unknown';
        (0, utils_1.log)('info', `新连接: ${extWs.id} from ${clientIp}`);
        // 心跳响应
        extWs.on('pong', () => {
            extWs.isAlive = true;
            extWs.lastPing = (0, utils_1.now)();
        });
        // 消息处理
        extWs.on('message', (data) => {
            try {
                const messageStr = data.toString('utf-8');
                if (isDevMode) {
                    console.log(`[${new Date().toISOString()}] [DEBUG] RAW MESSAGE RECV id:${extWs.id}: ${messageStr.substring(0, 500)}`);
                }
                handleMessage(extWs, messageStr);
            }
            catch (error) {
                (0, utils_1.log)('error', '处理消息失败:', error);
            }
        });
        // 连接关闭
        extWs.on('close', (code, reason) => {
            if (isDevMode) {
                console.log(`[${new Date().toISOString()}] [DEBUG] CONNECTION CLOSED id:${extWs.id} code: ${code} reason: ${reason.toString()}`);
            }
            (0, utils_1.log)('info', `连接关闭: ${extWs.id}, code: ${code}, reason: ${reason.toString()}`);
            socketMap.delete(extWs.id);
            // 清理用户和房间
            if (extWs.userId) {
                const user = userManager_1.userManager.getUser(extWs.userId);
                if (user) {
                    const room = roomManager_1.roomManager.getRoomByUser(user.id);
                    if (room) {
                        const leaveMessage = {
                            type: 'userLeft',
                            userId: user.id,
                        };
                        broadcastToRoom(room.id, leaveMessage, user.id);
                    }
                    roomManager_1.roomManager.leaveRoom(user);
                    userManager_1.userManager.removeUser(user.id);
                }
            }
        });
        // 错误处理
        extWs.on('error', (error) => {
            (0, utils_1.log)('error', `WebSocket错误 (${extWs.id}):`, error);
        });
    });
    return wss;
}
