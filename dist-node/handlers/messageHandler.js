"use strict";
/**
 * 消息处理器
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastToRoom = broadcastToRoom;
exports.sendToUser = sendToUser;
exports.handleAuth = handleAuth;
exports.handleCreateRoom = handleCreateRoom;
exports.handleJoinRoom = handleJoinRoom;
exports.handleLeaveRoom = handleLeaveRoom;
exports.handleMouseMove = handleMouseMove;
exports.handleNoteBatch = handleNoteBatch;
exports.handleMidiEvent = handleMidiEvent;
exports.handleMidiEventBatch = handleMidiEventBatch;
exports.handleProjectUpdate = handleProjectUpdate;
exports.handleRequestSync = handleRequestSync;
exports.handlePing = handlePing;
const roomManager_1 = require("../roomManager");
const userManager_1 = require("../userManager");
const utils_1 = require("../utils");
/**
 * 广播消息给房间内所有用户
 */
function broadcastToRoom(room, message, excludeUserId) {
    const messageStr = JSON.stringify(message);
    for (const user of room.users.values()) {
        if (excludeUserId && user.id === excludeUserId)
            continue;
        // 这里需要通过某种方式获取用户的WebSocket连接
        // 实际实现中我们会在连接管理器中维护这个映射
    }
}
/**
 * 发送消息给特定用户
 */
function sendToUser(ws, message) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
/**
 * 处理认证消息
 */
function handleAuth(ws, username) {
    const validation = userManager_1.userManager.validateUsername(username);
    if (!validation.valid) {
        return { type: 'authError', error: validation.error };
    }
    const user = userManager_1.userManager.createUser(ws, username);
    const inviteCode = (0, utils_1.generateInviteCode)();
    return {
        type: 'authSuccess',
        userId: user.id,
        inviteCode: inviteCode, // 返回一个邀请码供用户创建房间使用
    };
}
/**
 * 处理创建房间
 */
function handleCreateRoom(ws, user, name) {
    try {
        const room = roomManager_1.roomManager.createRoom(user, name);
        return {
            type: 'roomCreated',
            room: roomManager_1.roomManager.getRoomInfo(room),
        };
    }
    catch (error) {
        return {
            type: 'roomError',
            error: error instanceof Error ? error.message : '创建房间失败',
        };
    }
}
/**
 * 处理加入房间
 */
function handleJoinRoom(ws, user, inviteCode) {
    try {
        const room = roomManager_1.roomManager.joinRoom(inviteCode, user);
        if (!room) {
            return {
                type: 'roomError',
                error: '邀请码无效或房间不存在',
            };
        }
        return {
            type: 'roomJoined',
            room: roomManager_1.roomManager.getRoomInfo(room),
            users: roomManager_1.roomManager.getUsersInfo(room),
            projectState: room.projectState,
        };
    }
    catch (error) {
        return {
            type: 'roomError',
            error: error instanceof Error ? error.message : '加入房间失败',
        };
    }
}
/**
 * 处理离开房间
 */
function handleLeaveRoom(ws, user) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (room) {
        roomManager_1.roomManager.leaveRoom(user);
        // 通知房间内其他用户
        const leaveMessage = {
            type: 'userLeft',
            userId: user.id,
        };
        broadcastToRoom(room, leaveMessage, user.id);
    }
    return null;
}
/**
 * 处理鼠标移动
 */
function handleMouseMove(ws, user, position) {
    userManager_1.userManager.updateMousePosition(user.id, position);
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    const message = {
        type: 'mouseUpdate',
        userId: user.id,
        username: user.username,
        position,
        color: user.color,
    };
    broadcastToRoom(room, message, user.id);
}
/**
 * 处理音符批量操作
 */
function handleNoteBatch(ws, user, operation) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    // 更新项目状态
    if (room.projectState.midiData) {
        applyNoteOperation(room.projectState.midiData, operation);
        roomManager_1.roomManager.updateProjectState(room.id, {}, user.id);
    }
    const message = {
        type: 'noteBatchUpdate',
        userId: user.id,
        operation,
    };
    broadcastToRoom(room, message, user.id);
}
/**
 * 处理MIDI事件
 */
function handleMidiEvent(ws, user, event) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    const message = {
        type: 'midiEventUpdate',
        userId: user.id,
        event,
    };
    broadcastToRoom(room, message, user.id);
}
/**
 * 处理MIDI事件批量传输
 */
function handleMidiEventBatch(ws, user, events) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    const message = {
        type: 'midiEventBatchUpdate',
        userId: user.id,
        events,
    };
    broadcastToRoom(room, message, user.id);
}
/**
 * 处理项目状态更新
 */
function handleProjectUpdate(ws, user, update) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    // 应用更新到房间状态
    if (update.type === 'viewState') {
        roomManager_1.roomManager.updateProjectState(room.id, { viewState: update.data }, user.id);
    }
    const message = {
        type: 'projectStateUpdate',
        userId: user.id,
        update,
    };
    broadcastToRoom(room, message, user.id);
}
/**
 * 处理同步请求
 */
function handleRequestSync(ws, user) {
    const room = roomManager_1.roomManager.getRoomByUser(user.id);
    if (!room)
        return;
    const message = {
        type: 'fullSync',
        projectState: room.projectState,
        users: roomManager_1.roomManager.getUsersInfo(room),
    };
    sendToUser(ws, message);
}
/**
 * 处理ping
 */
function handlePing(ws, timestamp) {
    const message = {
        type: 'pong',
        timestamp,
        serverTime: (0, utils_1.now)(),
    };
    sendToUser(ws, message);
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
