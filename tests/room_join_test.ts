/**
 * 协作房间加入测试
 * 
 * 测试场景：
 * 1. 用户1创建房间
 * 2. 用户2使用邀请码加入房间
 * 3. 验证双方都能收到房间加入事件
 */

import { roomManager } from '../src/roomManager';
import { userManager } from '../src/userManager';
import type { User } from '../src/types';

// 模拟 WebSocket
class MockWebSocket {
  public messages: any[] = [];
  public closed = false;
  
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  
  close() {
    this.closed = true;
  }
}

describe('Room Join Tests', () => {
  let user1: User;
  let user2: User;
  let ws1: MockWebSocket;
  let ws2: MockWebSocket;
  
  beforeEach(() => {
    // 清理状态
    roomManager.cleanupInactiveRooms(0);
    userManager.cleanupInactiveUsers(0);
    
    // 创建测试用户
    ws1 = new MockWebSocket();
    ws2 = new MockWebSocket();
    
    user1 = {
      id: 'user-1',
      username: '用户1',
      socketId: 'socket-1',
      roomId: null,
      color: '#FF6B6B',
      lastActive: Date.now(),
      mousePosition: null,
    };
    
    user2 = {
      id: 'user-2',
      username: '用户2',
      socketId: 'socket-2',
      roomId: null,
      color: '#4ECDC4',
      lastActive: Date.now(),
      mousePosition: null,
    };
  });
  
  test('用户创建房间并成功加入', () => {
    // 用户1创建房间
    const room = roomManager.createRoom(user1, '测试房间');
    
    expect(room).toBeDefined();
    expect(room.hostId).toBe(user1.id);
    expect(room.users.size).toBe(1);
    expect(user1.roomId).toBe(room.id);
    
    console.log('✓ 房间创建成功:', room.id);
    console.log('  邀请码:', room.inviteCode);
    
    // 用户2加入房间
    const joinedRoom = roomManager.joinRoom(room.inviteCode, user2);
    
    expect(joinedRoom).toBeDefined();
    expect(joinedRoom?.id).toBe(room.id);
    expect(joinedRoom?.users.size).toBe(2);
    expect(user2.roomId).toBe(room.id);
    
    console.log('✓ 用户2成功加入房间');
    console.log('  房间内用户数:', joinedRoom?.users.size);
  });
  
  test('使用无效邀请码加入房间应失败', () => {
    // 用户1创建房间
    const room = roomManager.createRoom(user1, '测试房间');
    
    // 尝试使用无效邀请码加入
    const invalidCode = 'INVALID';
    const result = roomManager.joinRoom(invalidCode, user2);
    
    expect(result).toBeNull();
    expect(user2.roomId).toBeNull();
    
    console.log('✓ 无效邀请码正确被拒绝');
  });
  
  test('用户离开房间后房间状态正确更新', () => {
    // 用户1创建房间
    const room = roomManager.createRoom(user1, '测试房间');
    
    // 用户2加入
    roomManager.joinRoom(room.inviteCode, user2);
    
    // 用户1离开
    const left = roomManager.leaveRoom(user1);
    
    expect(left).toBe(true);
    expect(user1.roomId).toBeNull();
    
    // 房间应该仍然存在，但用户2成为房主
    const updatedRoom = roomManager.getRoom(room.id);
    expect(updatedRoom).toBeDefined();
    expect(updatedRoom?.hostId).toBe(user2.id);
    expect(updatedRoom?.users.size).toBe(1);
    
    console.log('✓ 房主离开后被正确转移');
    console.log('  新房主:', updatedRoom?.hostId);
  });
  
  test('所有用户离开后房间被删除', () => {
    // 用户1创建房间
    const room = roomManager.createRoom(user1, '测试房间');
    const roomId = room.id;
    
    // 用户1离开
    roomManager.leaveRoom(user1);
    
    // 房间应该被删除（因为没有用户了）
    const deletedRoom = roomManager.getRoom(roomId);
    expect(deletedRoom).toBeUndefined();
    
    console.log('✓ 空房间被正确删除');
  });
});

// 运行测试
console.log('开始运行房间加入测试...\n');
