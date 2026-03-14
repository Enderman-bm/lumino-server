/**
 * Cloudflare Worker entry point for Lumino Collaborative Server
 */

import { roomManager } from './roomManager';
import { userManager } from './userManager';
import { log } from './utils';
import type { ServerMessage, ClientMessage, User } from './types';

// WebSocket connection manager
const wsConnections = new Map<string, WebSocket>();

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    log('info', `Received request: ${request.method} ${url.pathname}`);

    // Health check endpoint
    if (url.pathname === '/health' && request.method === 'GET') {
      // Get server IP/Host from request headers
      const serverIp = request.headers.get('host') || 'unknown';

      const stats = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        serverIp: serverIp,
        rooms: roomManager.getStats(),
        users: userManager.getStats(),
      };
      
      return new Response(JSON.stringify(stats), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Server info endpoint
    if (url.pathname === '/info' && request.method === 'GET') {
      const info = {
        name: 'Lumino Collaborative Server',
        version: '1.0.0',
        websocket: {
          path: '/ws',
          protocol: 'json',
        },
        features: [
          'real-time-collaboration',
          'mouse-tracking',
          'note-batch-operations',
          'midi-event-sync',
          'project-state-sync',
        ],
      };
      
      return new Response(JSON.stringify(info), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 监控WebUI端点
    if (url.pathname === '/monitor' && request.method === 'GET') {
      const stats = roomManager.getStats();
      const userStats = userManager.getStats();
      
      // 从请求头获取服务器IP/主机名
      const serverIp = request.headers.get('host') || '未知';

      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumino 服务器监控</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 10px; }
        .subtitle { color: #666; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .stat-card { background: #f8f9fa; padding: 20px; border-radius: 6px; border-left: 4px solid #007bff; cursor: pointer; transition: transform 0.2s; }
        .stat-card:hover { transform: translateY(-2px); }
        .stat-value { font-size: 2em; font-weight: bold; color: #333; }
        .stat-label { color: #666; font-size: 0.9em; }
        .server-info { background: #e7f3ff; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
        .info-item { margin: 5px 0; }
        .refresh-info { text-align: center; color: #999; font-size: 0.85em; margin-top: 20px; }
        .badge { display: inline-block; padding: 4px 8px; background: #28a745; color: white; border-radius: 4px; font-size: 0.8em; }
        .chart-container { position: relative; height: 300px; margin-bottom: 30px; }
        .chart-wrapper { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
        .chart-title { font-size: 1.1em; font-weight: bold; color: #333; margin-bottom: 15px; }
        .stats-details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
        .detail-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .detail-label { color: #666; }
        .detail-value { font-weight: bold; color: #333; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🖥️ Lumino 服务器监控</h1>
        <p class="subtitle">实时服务器统计与监控 - 带历史折线图</p>
        
        <div class="server-info">
            <strong>服务器信息:</strong>
            <div class="info-item">主机: <span id="server-ip">${serverIp}</span></div>
            <div class="info-item">状态: <span class="badge">运行中</span></div>
            <div class="info-item">更新时间: <span id="update-time">${new Date().toLocaleString()}</span></div>
        </div>

        <div class="stats-grid">
            <div class="stat-card" style="border-left-color: #007bff;">
                <div class="stat-value" id="room-count">${stats.totalRooms}</div>
                <div class="stat-label">活跃房间数</div>
            </div>
            <div class="stat-card" style="border-left-color: #28a745;">
                <div class="stat-value" id="user-count">${userStats.totalUsers}</div>
                <div class="stat-label">在线用户数</div>
            </div>
            <div class="stat-card" style="border-left-color: #ffc107;">
                <div class="stat-value" id="total-users">${stats.totalUsers}</div>
                <div class="stat-label">房间内用户数</div>
            </div>
        </div>

        <div class="chart-wrapper">
            <div class="chart-title">📊 房间数历史趋势</div>
            <div class="chart-container">
                <canvas id="roomChart"></canvas>
            </div>
        </div>

        <div class="chart-wrapper">
            <div class="chart-title">👥 用户数历史趋势</div>
            <div class="chart-container">
                <canvas id="userChart"></canvas>
            </div>
        </div>

        <div class="refresh-info">
            每5秒自动刷新数据...
        </div>
    </div>

    <script>
        // 历史数据存储
        const historyData = {
            labels: [],
            rooms: [],
            users: [],
            usersInRooms: []
        };
        
        const maxDataPoints = 20;
        
        // 初始化图表
        const roomCtx = document.getElementById('roomChart').getContext('2d');
        const userCtx = document.getElementById('userChart').getContext('2d');
        
        const roomChart = new Chart(roomCtx, {
            type: 'line',
            data: {
                labels: historyData.labels,
                datasets: [{
                    label: '活跃房间数',
                    data: historyData.rooms,
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
        
        const userChart = new Chart(userCtx, {
            type: 'line',
            data: {
                labels: historyData.labels,
                datasets: [
                    {
                        label: '在线用户数',
                        data: historyData.users,
                        borderColor: '#28a745',
                        backgroundColor: 'rgba(40, 167, 69, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    },
                    {
                        label: '房间内用户数',
                        data: historyData.usersInRooms,
                        borderColor: '#ffc107',
                        backgroundColor: 'rgba(255, 193, 7, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: true,
                        position: 'top'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 }
                    }
                }
            }
        });
        
        function updateStats() {
            const now = new Date();
            const timeLabel = now.toLocaleTimeString();
            
            fetch('/health')
                .then(res => {
                    if (!res.ok) throw new Error('Network response was not ok');
                    return res.json();
                })
                .then(data => {
                    // 更新当前数值
                    document.getElementById('room-count').textContent = data.rooms.totalRooms;
                    document.getElementById('user-count').textContent = data.users.totalUsers;
                    document.getElementById('total-users').textContent = data.rooms.totalUsers;
                    document.getElementById('update-time').textContent = now.toLocaleString();
                    
                    // 更新历史数据
                    historyData.labels.push(timeLabel);
                    historyData.rooms.push(data.rooms.totalRooms);
                    historyData.users.push(data.users.totalUsers);
                    historyData.usersInRooms.push(data.rooms.totalUsers);
                    
                    // 限制数据点数量
                    if (historyData.labels.length > maxDataPoints) {
                        historyData.labels.shift();
                        historyData.rooms.shift();
                        historyData.users.shift();
                        historyData.usersInRooms.shift();
                    }
                    
                    // 更新图表
                    roomChart.update();
                    userChart.update();
                })
                .catch(error => {
                    console.error('获取统计数据失败:', error);
                    // 即使失败也更新时间
                    document.getElementById('update-time').textContent = now.toLocaleString();
                });
        }
        
        // 初始加载
        updateStats();
        // 每5秒刷新一次
        setInterval(updateStats, 5000);
    </script>
</body>
</html>`;

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // WebSocket upgrade endpoint
    if (url.pathname === '/ws' && request.method === 'GET') {
      log('info', `WebSocket upgrade request received`);
      // Check if it's a WebSocket upgrade request
      const upgradeHeader = request.headers.get('Upgrade');
      log('info', `Upgrade header: ${upgradeHeader}`);
      if (upgradeHeader === 'websocket') {
        log('info', `Creating WebSocket pair`);
        // Create WebSocket pair
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        // Accept the WebSocket connection
        server.accept();
        log('info', `WebSocket server accepted`);
        
        // Handle WebSocket connection
        handleWebSocketConnection(server);
        
        log('info', `Returning WebSocket upgrade response`);
        // Return the client WebSocket - this is the key fix
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
      
      // If not a WebSocket upgrade, return error
      log('info', `WebSocket upgrade header not found, returning 400`);
      return new Response('WebSocket upgrade required', { status: 400 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // 404
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};

function handleWebSocketConnection(ws: WebSocket) {
  const userId = generateUserId();
  wsConnections.set(userId, ws);

  log('info', `New WebSocket connection initialized for user ${userId}`);
  
  // Set up message listener
  ws.addEventListener('message', (event) => {
    log('info', `WebSocket message event triggered for user ${userId}`);
    try {
      const data = JSON.parse(event.data as string);
      log('info', `Received message from ${userId}:`, JSON.stringify(data));
      handleClientMessage(userId, ws, data);
    } catch (error) {
      log('error', 'Failed to parse WebSocket message:', error);
      log('error', 'Raw message data:', event.data);
      try {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      } catch (sendError) {
        log('error', 'Failed to send error response:', sendError);
      }
    }
  });

  ws.addEventListener('close', () => {
    log('info', `WebSocket connection closed for user ${userId}`);
    wsConnections.delete(userId);
    
    // Clean up user from rooms
    const user = userManager.getUser(userId);
    if (user) {
      const room = roomManager.getRoomByUser(userId);
      if (room) {
        roomManager.leaveRoom(user);
        const leaveMessage: ServerMessage = {
          type: 'userLeft',
          userId: userId,
        };
        broadcastToRoom(room, leaveMessage, userId);
      }
      userManager.deleteUser(userId);
    }
  });

  ws.addEventListener('error', (error) => {
    log('error', `WebSocket error for user ${userId}:`, error);
  });
}

function generateUserId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function handleClientMessage(userId: string, ws: WebSocket, message: any): void {
  const type = message.type;
  log('info', `Processing message type: ${type} for user ${userId}`);
  
  switch (type) {
    case 'auth':
      log('info', `Handling auth for username: ${message.username}`);
      handleAuth(ws, userId, message.username);
      break;
    case 'createRoom':
      handleCreateRoom(ws, userId, message.name);
      break;
    case 'joinRoom':
      handleJoinRoom(ws, userId, message.inviteCode);
      break;
    case 'leaveRoom':
      handleLeaveRoom(ws, userId);
      break;
    case 'mouseMove':
      handleMouseMove(ws, userId, message.position);
      break;
    case 'noteBatch':
      handleNoteBatch(ws, userId, message.operation);
      break;
    case 'midiEvent':
      handleMidiEvent(ws, userId, message.event);
      break;
    case 'midiEventBatch':
      handleMidiEventBatch(ws, userId, message.events);
      break;
    case 'projectUpdate':
      handleProjectUpdate(ws, userId, message.update);
      break;
    case 'requestSync':
      handleRequestSync(ws, userId);
      break;
    case 'ping':
      handlePing(ws, userId, message.timestamp);
      break;
    default:
      log('warn', `Unknown message type: ${type}`);
      ws.send(JSON.stringify({ type: 'error', error: 'Unknown message type' }));
  }
}

function handleAuth(ws: WebSocket, userId: string, username: string): void {
  log('info', `handleAuth called for userId: ${userId}, username: ${username}`);
  
  const validation = userManager.validateUsername(username);
  log('info', `Username validation result:`, JSON.stringify(validation));
  
  if (!validation.valid) {
    log('warn', `Username validation failed: ${validation.error}`);
    ws.send(JSON.stringify({ type: 'authError', error: validation.error! }));
    return;
  }

  const user = userManager.createCloudflareUser(userId, username);
  log('info', `User created: ${user.id}`);
  
  const response = {
    type: 'authSuccess',
    userId: user.id,
    inviteCode: generateInviteCode(),
  };
  
  log('info', `Sending auth response:`, JSON.stringify(response));
  try {
    ws.send(JSON.stringify(response));
    log('info', `Auth response sent successfully`);
  } catch (error) {
    log('error', `Failed to send auth response:`, error);
  }
}

function handleCreateRoom(ws: WebSocket, userId: string, name: string): void {
  const user = userManager.getUser(userId);
  if (!user) {
    ws.send(JSON.stringify({ type: 'roomError', error: 'User not authenticated' }));
    return;
  }

  try {
    const room = roomManager.createRoom(user, name);
    ws.send(JSON.stringify({
      type: 'roomCreated',
      room: roomManager.getRoomInfo(room),
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'roomError',
      error: error instanceof Error ? error.message : '创建房间失败',
    }));
  }
}

function handleJoinRoom(ws: WebSocket, userId: string, inviteCode: string): void {
  const user = userManager.getUser(userId);
  if (!user) {
    ws.send(JSON.stringify({ type: 'roomError', error: 'User not authenticated' }));
    return;
  }

  try {
    const room = roomManager.joinRoom(inviteCode, user);
    
    if (!room) {
      ws.send(JSON.stringify({
        type: 'roomError',
        error: '邀请码无效或房间不存在',
      }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'roomJoined',
      room: roomManager.getRoomInfo(room),
      users: roomManager.getUsersInfo(room),
      projectState: room.projectState,
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'roomError',
      error: error instanceof Error ? error.message : '加入房间失败',
    }));
  }
}

function handleLeaveRoom(ws: WebSocket, userId: string): void {
  const user = userManager.getUser(userId);
  if (!user) return;

  const room = roomManager.getRoomByUser(userId);
  if (room) {
    roomManager.leaveRoom(user);
    const leaveMessage: ServerMessage = {
      type: 'userLeft',
      userId: userId,
    };
    broadcastToRoom(room, leaveMessage, userId);
  }
}

function handleMouseMove(ws: WebSocket, userId: string, position: any): void {
  userManager.updateMousePosition(userId, position);
  
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const user = userManager.getUser(userId);
  const message: ServerMessage = {
    type: 'mouseUpdate',
    userId: userId,
    username: user?.username || 'Unknown',
    position,
    color: user?.color || '#000000',
  };

  broadcastToRoom(room, message, userId);
}

function handleNoteBatch(ws: WebSocket, userId: string, operation: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  if (room.projectState.midiData) {
    applyNoteOperation(room.projectState.midiData, operation);
    roomManager.updateProjectState(room.id, {}, userId);
  }

  const message: ServerMessage = {
    type: 'noteBatchUpdate',
    userId: userId,
    operation,
  };

  broadcastToRoom(room, message, userId);
}

function handleMidiEvent(ws: WebSocket, userId: string, event: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventUpdate',
    userId: userId,
    event,
  };

  broadcastToRoom(room, message, userId);
}

function handleMidiEventBatch(ws: WebSocket, userId: string, events: any[]): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'midiEventBatchUpdate',
    userId: userId,
    events,
  };

  broadcastToRoom(room, message, userId);
}

function handleProjectUpdate(ws: WebSocket, userId: string, update: any): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  if (update.type === 'viewState') {
    roomManager.updateProjectState(
      room.id,
      { viewState: update.data },
      userId
    );
  }

  const message: ServerMessage = {
    type: 'projectStateUpdate',
    userId: userId,
    update,
  };

  broadcastToRoom(room, message, userId);
}

function handleRequestSync(ws: WebSocket, userId: string): void {
  const room = roomManager.getRoomByUser(userId);
  if (!room) return;

  const message: ServerMessage = {
    type: 'fullSync',
    projectState: room.projectState,
    users: roomManager.getUsersInfo(room),
  };

  ws.send(JSON.stringify(message));
}

function handlePing(ws: WebSocket, userId: string, timestamp: number): void {
  const message: ServerMessage = {
    type: 'pong',
    timestamp,
    serverTime: Date.now(),
  };

  ws.send(JSON.stringify(message));
}

function broadcastToRoom(room: any, message: ServerMessage, excludeUserId: string): void {
  const messageStr = JSON.stringify(message);
  
  for (const user of room.users.values()) {
    if (excludeUserId && user.id === excludeUserId) continue;
    
    const ws = wsConnections.get(user.id);
    if (ws) {
      ws.send(messageStr);
    }
  }
}

function applyNoteOperation(midiData: any, operation: any): void {
  if (!midiData.tracks) return;

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
          track.notes = track.notes.filter((n: any) => n.id !== note.id);
        }
      }
      break;

    case 'update':
      for (const note of operation.notes) {
        const track = midiData.tracks[note.trackIndex];
        if (track) {
          const index = track.notes.findIndex((n: any) => n.id === note.id);
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
      if (operation.targetTrack !== undefined) {
        const targetTrack = midiData.tracks[operation.targetTrack];
        if (targetTrack) {
          for (const note of operation.notes) {
            const newNote = {
              ...note,
              id: Math.random().toString(36).substring(2, 15),
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

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}
