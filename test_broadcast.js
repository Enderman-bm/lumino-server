/**
 * 协作服务器广播功能测试脚本
 * 
 * 使用方法: node test_broadcast.js
 */

const WebSocket = require('ws');

const SERVER_URL = 'wss://lumino-collaborative-server.enderman-bm.workers.dev';
const HTTP_URL = 'https://lumino-collaborative-server.enderman-bm.workers.dev';

// 创建房间
async function createRoom(name, hostId) {
  console.log(`[HTTP] Creating room: ${name}`);
  
  const response = await fetch(`${HTTP_URL}/api/room/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, hostId, hostName: 'Test User' })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  
  const data = await response.json();
  console.log(`[HTTP] Room created:`, data.room);
  return data;
}

// 连接 WebSocket
function connectWebSocket(roomId, userId, username, onMessage) {
  return new Promise((resolve, reject) => {
    const wsUrl = `${SERVER_URL}/ws?roomId=${roomId}`;
    console.log(`[WS] Connecting to ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      console.log(`[WS ${username}] Connected`);
      
      // 发送认证消息
      ws.send(JSON.stringify({
        type: 'auth',
        userId,
        username,
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
      }));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        console.log(`[WS ${username}] Received:`, msg.type);
        
        if (onMessage) {
          onMessage(ws, msg);
        }
        
        // 认证成功后 resolve
        if (msg.type === 'authenticated') {
          resolve(ws);
        }
      } catch (e) {
        console.error(`[WS ${username}] Parse error:`, e);
      }
    });
    
    ws.on('error', (err) => {
      console.error(`[WS ${username}] Error:`, err);
      reject(err);
    });
    
    ws.on('close', () => {
      console.log(`[WS ${username}] Closed`);
    });
  });
}

// 测试广播
async function testBroadcast() {
  console.log('========================================');
  console.log('  协作服务器广播功能测试');
  console.log('========================================\n');
  
  try {
    // 步骤1: 创建房间
    console.log('步骤1: 创建房间');
    const roomData = await createRoom('Test Room', 'host123');
    const roomId = roomData.room.inviteCode;
    console.log(`房间ID: ${roomId}\n`);
    
    // 步骤2: 用户01连接
    console.log('步骤2: 用户01连接');
    const user1Received = [];
    const ws1 = await connectWebSocket(roomId, 'user1', 'User 01', (ws, msg) => {
      user1Received.push(msg);
    });
    console.log('✓ 用户01已连接\n');
    
    // 等待一下确保连接稳定
    await new Promise(r => setTimeout(r, 500));
    
    // 步骤3: 用户02连接
    console.log('步骤3: 用户02连接');
    const user2Received = [];
    const ws2 = await connectWebSocket(roomId, 'user2', 'User 02', (ws, msg) => {
      user2Received.push(msg);
    });
    console.log('✓ 用户02已连接\n');
    
    // 等待用户加入消息
    await new Promise(r => setTimeout(r, 1000));
    
    // 步骤4: 用户01发送鼠标位置
    console.log('步骤4: 用户01发送鼠标位置');
    ws1.send(JSON.stringify({
      type: 'mouseMove',
      position: { x: 100, y: 200 }
    }));
    
    // 等待广播
    await new Promise(r => setTimeout(r, 1000));
    
    // 检查用户02是否收到
    const mouseUpdate = user2Received.find(m => m.type === 'mouseUpdate');
    if (mouseUpdate) {
      console.log('✓ 用户02收到鼠标位置更新:', mouseUpdate);
    } else {
      console.log('✗ 用户02未收到鼠标位置更新');
      console.log('  收到的消息:', user2Received.map(m => m.type));
    }
    
    console.log('\n========================================');
    console.log('  测试完成');
    console.log('========================================');
    
    // 关闭连接
    ws1.close();
    ws2.close();
    
  } catch (error) {
    console.error('测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testBroadcast();
