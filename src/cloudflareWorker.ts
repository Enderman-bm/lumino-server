/**
 * Cloudflare Worker entry point for Lumino Collaborative Server
 * 
 * 架构说明：
 * 1. Worker 处理初始 HTTP 请求（健康检查、创建房间等）
 * 2. WebSocket 连接直接升级到 RoomDurableObject
 * 3. RoomDurableObject 内部处理所有消息和广播
 */

import { roomManager } from './roomManager';
import { userManager } from './userManager';
import type { ServerMessage, UserInfo } from './types';
import { LogDurableObject } from './LogDurableObject';
import { RoomDurableObject } from './RoomDurableObject';

// Export the Durable Object classes for Cloudflare Workers runtime
export { LogDurableObject, RoomDurableObject };

// Environment interface with Durable Object binding
export interface Env {
  LOG_DURABLE_OBJECT: DurableObjectNamespace;
  ROOM_DURABLE_OBJECT: DurableObjectNamespace;
  LUMINO_KV: KVNamespace;
}

// Durable Object stub cache
let logDurableObjectStub: DurableObjectStub | null = null;
const roomDurableObjectStubs: Map<string, DurableObjectStub> = new Map();

/**
 * Get or create the LogDurableObject stub
 */
function getLogDurableObject(env: Env): DurableObjectStub {
  if (!logDurableObjectStub) {
    const id = env.LOG_DURABLE_OBJECT.idFromName('log-broadcaster');
    logDurableObjectStub = env.LOG_DURABLE_OBJECT.get(id);
  }
  return logDurableObjectStub;
}

/**
 * Get or create a Room Durable Object stub for a specific room
 */
function getRoomDurableObject(env: Env, roomId: string): DurableObjectStub {
  let stub = roomDurableObjectStubs.get(roomId);
  if (!stub) {
    const id = env.ROOM_DURABLE_OBJECT.idFromName(roomId);
    stub = env.ROOM_DURABLE_OBJECT.get(id);
    roomDurableObjectStubs.set(roomId, stub);
  }
  return stub;
}

// 生成用户 ID
function generateUserId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 生成邀请码
function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    console.log(`[Worker] ${request.method} ${path}`);

    // 处理 WebSocket 升级请求 - 日志 WebSocket 路由到 LogDurableObject
    if (path === '/logs/ws') {
      return handleLogWebSocketRequest(request, env);
    }

    // 处理 WebSocket 升级请求 - 直接路由到 RoomDurableObject
    if (path === '/ws') {
      return handleWebSocketRequest(request, env);
    }

    // API: 健康检查
    if (path === '/health' && request.method === 'GET') {
      return handleHealthCheck(request, env);
    }

    // API: 创建房间
    if (path === '/api/room/create' && request.method === 'POST') {
      return handleCreateRoom(request, env);
    }

    // API: 获取房间信息
    if (path.startsWith('/api/room/') && path.endsWith('/info') && request.method === 'GET') {
      const roomId = path.split('/')[3];
      return handleGetRoomInfo(roomId, env);
    }

    // 主页
    if (path === '/' && request.method === 'GET') {
      return handleHome(request);
    }

    // 监控面板
    if (path === '/monitor' && request.method === 'GET') {
      return handleMonitor(request, env);
    }

    // 日志查看WebUI端点
    if (path === '/logs' && request.method === 'GET') {
      return handleLogs(request, env);
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

/**
 * 处理日志 WebSocket 请求
 * 将连接升级到 LogDurableObject
 */
async function handleLogWebSocketRequest(request: Request, env: Env): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 400 });
  }

  console.log('[Worker] Upgrading WebSocket for log client');

  try {
    // 直接转发到 LogDurableObject 处理 WebSocket 升级
    const logDurableObject = getLogDurableObject(env);
    const response = await logDurableObject.fetch(request);
    console.log(`[Worker] LogDurableObject response status: ${response.status}`);
    return response;
  } catch (error) {
    console.error('[Worker] Error calling LogDurableObject:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 处理 WebSocket 请求
 * 将连接升级到 RoomDurableObject
 */
async function handleWebSocketRequest(request: Request, env: Env): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return new Response('WebSocket upgrade required', { status: 400 });
  }

  // 获取房间 ID 从查询参数
  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId');
  
  if (!roomId) {
    return new Response(JSON.stringify({ 
      error: 'Missing roomId parameter',
      message: 'WebSocket connection requires a roomId. First create or join a room via HTTP API.'
    }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  console.log(`[Worker] Upgrading WebSocket for room ${roomId}`);

  try {
    // 直接转发到 RoomDurableObject 处理 WebSocket 升级
    const roomDurableObject = getRoomDurableObject(env, roomId);
    const response = await roomDurableObject.fetch(request);
    console.log(`[Worker] RoomDurableObject response status: ${response.status}`);
    return response;
  } catch (error) {
    console.error('[Worker] Error calling RoomDurableObject:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 处理健康检查
 */
async function handleHealthCheck(request: Request, env: Env): Promise<Response> {
  try {
    const stats = roomManager.getStats();
    const url = new URL(request.url);
    
    return new Response(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        serverIp: url.hostname,
        rooms: stats,
        users: { totalUsers: userManager.getStats().totalUsers },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[Worker] Health check error:', error);
    return new Response(
      JSON.stringify({ status: 'error', error: String(error) }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * 处理创建房间请求
 */
async function handleCreateRoom(request: Request, env: Env): Promise<Response> {
  try {
    const body: any = await request.json();
    const { name, hostId, hostName } = body;

    if (!name || !hostId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, hostId' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 创建邀请码
    const inviteCode = generateInviteCode();
    
    // 使用邀请码作为 RoomDurableObject 的 ID
    const roomDurableObject = getRoomDurableObject(env, inviteCode);
    
    // 在 RoomDurableObject 中创建房间
    const response = await roomDurableObject.fetch('http://internal/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        hostId,
        inviteCode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(
        JSON.stringify({ error: 'Failed to create room', details: error }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const roomData: any = await response.json();
    
    // 动态生成 WebSocket URL
    const url = new URL(request.url);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const webSocketUrl = `${protocol}//${url.host}/ws?roomId=${inviteCode}`;
    
    return new Response(
      JSON.stringify({
        success: true,
        room: {
          id: roomData.id,
          inviteCode: roomData.inviteCode,
          name: roomData.name,
          hostId: roomData.hostId,
        },
        webSocketUrl: webSocketUrl,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[Worker] Create room error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: String(error) }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * 处理获取房间信息
 */
async function handleGetRoomInfo(roomId: string, env: Env): Promise<Response> {
  try {
    const roomDurableObject = getRoomDurableObject(env, roomId);
    const response = await roomDurableObject.fetch('http://internal/room/state');
    
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: 'Room not found' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const roomData: any = await response.json();
    
    return new Response(
      JSON.stringify({
        id: roomData.id,
        inviteCode: roomData.inviteCode,
        name: roomData.name,
        hostId: roomData.hostId,
        userCount: roomData.users?.size || roomData.users?.length || 0,
        maxUsers: roomData.maxUsers || 10,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[Worker] Get room info error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * 处理监控面板请求
 */
async function handleMonitor(request: Request, env: Env): Promise<Response> {
  const stats = roomManager.getStats();
  const userStats = userManager.getStats();
  
  // 获取服务器主机名
  const url = new URL(request.url);
  const serverIp = url.hostname;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>分析 - Lumino Server</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root {
            --cf-orange: #F48120;
            --cf-blue: #0055FF;
            --cf-navy: #1D1F20;
            --cf-gray-100: #F7F7F8;
            --cf-gray-200: #E5E5E5;
            --cf-gray-300: #D1D1D1;
            --cf-gray-600: #6B7280;
            --cf-gray-800: #1F2937;
            --cf-success: #67C23A;
            --cf-warning: #E6A23C;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--cf-gray-100);
            color: var(--cf-gray-800);
            line-height: 1.5;
        }
        .header {
            background: white;
            border-bottom: 1px solid var(--cf-gray-200);
            padding: 0 24px;
            height: 64px;
            display: flex;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 20px;
            font-weight: 600;
            color: var(--cf-navy);
            text-decoration: none;
        }
        .logo-icon {
            width: 32px;
            height: 32px;
            background: var(--cf-orange);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 16px;
        }
        .nav {
            margin-left: 48px;
            display: flex;
            gap: 32px;
        }
        .nav a {
            color: var(--cf-gray-600);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            padding: 8px 0;
            border-bottom: 2px solid transparent;
        }
        .nav a:hover, .nav a.active {
            color: var(--cf-navy);
            border-bottom-color: var(--cf-orange);
        }
        .main {
            max-width: 1200px;
            margin: 0 auto;
            padding: 32px 24px;
        }
        .page-header {
            margin-bottom: 24px;
        }
        .page-title {
            font-size: 24px;
            font-weight: 600;
            color: var(--cf-navy);
            margin-bottom: 8px;
        }
        .page-subtitle {
            color: var(--cf-gray-600);
            font-size: 14px;
        }
        .status-bar {
            background: white;
            border: 1px solid var(--cf-gray-200);
            border-radius: 8px;
            padding: 16px 20px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .status-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--cf-success);
        }
        .status-label {
            font-size: 13px;
            color: var(--cf-gray-600);
        }
        .status-value {
            font-size: 13px;
            font-weight: 500;
            color: var(--cf-navy);
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 24px;
            margin-bottom: 32px;
        }
        .metric-card {
            background: white;
            border: 1px solid var(--cf-gray-200);
            border-radius: 8px;
            padding: 24px;
        }
        .metric-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        .metric-title {
            font-size: 14px;
            color: var(--cf-gray-600);
            font-weight: 500;
        }
        .metric-icon {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
        }
        .metric-icon.blue { background: rgba(0, 85, 255, 0.1); color: var(--cf-blue); }
        .metric-icon.green { background: rgba(103, 194, 58, 0.1); color: var(--cf-success); }
        .metric-icon.orange { background: rgba(230, 162, 60, 0.1); color: var(--cf-warning); }
        .metric-value {
            font-size: 36px;
            font-weight: 600;
            color: var(--cf-navy);
            margin-bottom: 8px;
        }
        .metric-label {
            font-size: 13px;
            color: var(--cf-gray-600);
        }
        .chart-section {
            background: white;
            border: 1px solid var(--cf-gray-200);
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 24px;
        }
        .chart-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
        }
        .chart-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--cf-navy);
        }
        .chart-legend {
            display: flex;
            gap: 20px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--cf-gray-600);
        }
        .legend-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .chart-container {
            position: relative;
            height: 280px;
        }
        .update-time {
            text-align: right;
            font-size: 12px;
            color: var(--cf-gray-600);
            margin-top: 16px;
        }
    </style>
</head>
<body>
    <header class="header">
        <a href="/" class="logo">
            <div class="logo-icon">L</div>
            <span>Lumino Server</span>
        </a>
        <nav class="nav">
            <a href="/">概览</a>
            <a href="/monitor" class="active">分析</a>
            <a href="/logs">日志</a>
        </nav>
    </header>
    
    <main class="main">
        <div class="page-header">
            <h1 class="page-title">分析</h1>
            <p class="page-subtitle">实时服务器指标和历史趋势</p>
        </div>
        
        <div class="status-bar">
            <div class="status-item">
                <div class="status-indicator"></div>
                <span class="status-label">状态</span>
                <span class="status-value">健康</span>
            </div>
            <div class="status-item">
                <span class="status-label">主机</span>
                <span class="status-value">${serverIp}</span>
            </div>
            <div class="status-item">
                <span class="status-label">最后更新</span>
                <span class="status-value" id="update-time">${new Date().toLocaleString()}</span>
            </div>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-header">
                    <span class="metric-title">活跃房间</span>
                    <div class="metric-icon blue">R</div>
                </div>
                <div class="metric-value" id="room-count">${stats.totalRooms}</div>
                <div class="metric-label">当前活跃的协作房间</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-header">
                    <span class="metric-title">在线用户</span>
                    <div class="metric-icon green">U</div>
                </div>
                <div class="metric-value" id="user-count">${userStats.totalUsers}</div>
                <div class="metric-label">总连接用户数</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-header">
                    <span class="metric-title">房间用户</span>
                    <div class="metric-icon orange">G</div>
                </div>
                <div class="metric-value" id="total-users">${stats.totalUsers}</div>
                <div class="metric-label">当前在房间内的用户</div>
            </div>
        </div>
        
        <div class="chart-section">
            <div class="chart-header">
                <h3 class="chart-title">房间趋势</h3>
            </div>
            <div class="chart-container">
                <canvas id="roomChart"></canvas>
            </div>
            <div class="update-time">每5秒自动更新</div>
        </div>
        
        <div class="chart-section">
            <div class="chart-header">
                <h3 class="chart-title">用户趋势</h3>
                <div class="chart-legend">
                    <div class="legend-item">
                        <div class="legend-dot" style="background: var(--cf-success);"></div>
                        <span>在线</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-dot" style="background: var(--cf-warning);"></div>
                        <span>在房间</span>
                    </div>
                </div>
            </div>
            <div class="chart-container">
                <canvas id="userChart"></canvas>
            </div>
        </div>
    </main>

    <script>
        const historyData = {
            labels: [],
            rooms: [],
            users: [],
            usersInRooms: []
        };
        
        const maxDataPoints = 20;
        
        Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        Chart.defaults.color = '#6B7280';
        
        const roomCtx = document.getElementById('roomChart').getContext('2d');
        const userCtx = document.getElementById('userChart').getContext('2d');
        
        const roomChart = new Chart(roomCtx, {
            type: 'line',
            data: {
                labels: historyData.labels,
                datasets: [{
                    label: '活跃房间',
                    data: historyData.rooms,
                    borderColor: '#0055FF',
                    backgroundColor: 'rgba(0, 85, 255, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        grid: { color: '#E5E5E5' }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
        
        const userChart = new Chart(userCtx, {
            type: 'line',
            data: {
                labels: historyData.labels,
                datasets: [
                    {
                        label: '在线用户',
                        data: historyData.users,
                        borderColor: '#67C23A',
                        backgroundColor: 'rgba(103, 194, 58, 0.05)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    },
                    {
                        label: '房间用户',
                        data: historyData.usersInRooms,
                        borderColor: '#E6A23C',
                        backgroundColor: 'rgba(230, 162, 60, 0.05)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        grid: { color: '#E5E5E5' }
                    }
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                }
            }
        });
        
        function updateStats() {
            const now = new Date();
            const timeLabel = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            
            fetch('/health')
                .then(res => {
                    if (!res.ok) throw new Error('Network response was not ok');
                    return res.json();
                })
                .then(data => {
                    document.getElementById('room-count').textContent = data.rooms.totalRooms;
                    document.getElementById('user-count').textContent = data.users.totalUsers;
                    document.getElementById('total-users').textContent = data.rooms.totalUsers;
                    document.getElementById('update-time').textContent = now.toLocaleString();
                    
                    historyData.labels.push(timeLabel);
                    historyData.rooms.push(data.rooms.totalRooms);
                    historyData.users.push(data.users.totalUsers);
                    historyData.usersInRooms.push(data.rooms.totalUsers);
                    
                    if (historyData.labels.length > maxDataPoints) {
                        historyData.labels.shift();
                        historyData.rooms.shift();
                        historyData.users.shift();
                        historyData.usersInRooms.shift();
                    }
                    
                    roomChart.update('none');
                    userChart.update('none');
                })
                .catch(error => {
                    console.error('Failed to fetch stats:', error);
                    document.getElementById('update-time').textContent = now.toLocaleString();
                });
        }
        
        updateStats();
        setInterval(updateStats, 5000);
    </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * 处理日志查看WebUI端点
 */
async function handleLogs(request: Request, env: Env): Promise<Response> {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>日志 - Lumino Server</title>
    <style>
        :root {
            --cf-orange: #F48120;
            --cf-blue: #0055FF;
            --cf-navy: #1D1F20;
            --cf-gray-100: #F7F7F8;
            --cf-gray-200: #E5E5E5;
            --cf-gray-300: #D1D1D1;
            --cf-gray-600: #6B7280;
            --cf-gray-800: #1F2937;
            --log-debug: #909399;
            --log-info: #0055FF;
            --log-warn: #E6A23C;
            --log-error: #F56C6C;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--cf-gray-100);
            color: var(--cf-gray-800);
            line-height: 1.5;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            background: white;
            border-bottom: 1px solid var(--cf-gray-200);
            padding: 0 24px;
            height: 64px;
            display: flex;
            align-items: center;
            flex-shrink: 0;
        }
        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 20px;
            font-weight: 600;
            color: var(--cf-navy);
            text-decoration: none;
        }
        .logo-icon {
            width: 32px;
            height: 32px;
            background: var(--cf-orange);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 16px;
        }
        .nav {
            margin-left: 48px;
            display: flex;
            gap: 32px;
        }
        .nav a {
            color: var(--cf-gray-600);
            text-decoration: none;
            font-size: 14px;
            font-weight: 500;
            padding: 20px 0;
            border-bottom: 2px solid transparent;
        }
        .nav a:hover, .nav a.active {
            color: var(--cf-navy);
            border-bottom-color: var(--cf-orange);
        }
        .toolbar {
            background: white;
            border-bottom: 1px solid var(--cf-gray-200);
            padding: 16px 24px;
            display: flex;
            align-items: center;
            gap: 16px;
            flex-shrink: 0;
        }
        .search-box {
            flex: 1;
            max-width: 400px;
            padding: 8px 12px;
            border: 1px solid var(--cf-gray-300);
            border-radius: 6px;
            font-size: 14px;
            outline: none;
        }
        .search-box:focus {
            border-color: var(--cf-blue);
        }
        .filter-group {
            display: flex;
            gap: 12px;
        }
        .filter-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border: 1px solid var(--cf-gray-300);
            border-radius: 6px;
            background: white;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .filter-btn:hover {
            border-color: var(--cf-blue);
        }
        .filter-btn input {
            cursor: pointer;
        }
        .filter-btn.active {
            background: var(--cf-gray-100);
        }
        .btn {
            padding: 8px 16px;
            border: 1px solid var(--cf-gray-300);
            border-radius: 6px;
            background: white;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn:hover {
            background: var(--cf-gray-100);
        }
        .btn-primary {
            background: var(--cf-blue);
            color: white;
            border-color: var(--cf-blue);
        }
        .btn-primary:hover {
            background: #0044CC;
        }
        .log-container {
            flex: 1;
            overflow-y: auto;
            background: white;
            padding: 0;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
            font-size: 13px;
        }
        .log-table {
            width: 100%;
            border-collapse: collapse;
        }
        .log-row {
            border-bottom: 1px solid var(--cf-gray-200);
            cursor: pointer;
        }
        .log-row:hover {
            background: var(--cf-gray-100);
        }
        .log-row.hidden {
            display: none;
        }
        .log-cell {
            padding: 10px 16px;
            vertical-align: top;
        }
        .log-time {
            color: var(--cf-gray-600);
            white-space: nowrap;
            width: 160px;
            font-size: 12px;
        }
        .log-level {
            width: 80px;
        }
        .level-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .level-debug { background: rgba(144, 147, 153, 0.15); color: var(--log-debug); }
        .level-info { background: rgba(0, 85, 255, 0.15); color: var(--log-info); }
        .level-warn { background: rgba(230, 162, 60, 0.15); color: var(--log-warn); }
        .level-error { background: rgba(245, 108, 108, 0.15); color: var(--log-error); }
        .log-message {
            color: var(--cf-navy);
            word-break: break-word;
        }
        .log-data {
            margin-top: 8px;
            padding: 12px;
            background: #1e1e1e;
            border-radius: 6px;
            color: #d4d4d4;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-all;
            display: none;
        }
        .log-row.expanded .log-data {
            display: block;
        }
        .status-bar {
            background: white;
            border-top: 1px solid var(--cf-gray-200);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 13px;
            flex-shrink: 0;
        }
        .status-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .status-dot.connected { background: var(--cf-success); }
        .status-dot.connecting { background: var(--cf-warning); }
        .status-dot.disconnected { background: var(--log-error); }
        .status-text {
            color: var(--cf-gray-600);
        }
        .status-value {
            font-weight: 500;
            color: var(--cf-navy);
        }
    </style>
</head>
<body>
    <header class="header">
        <a href="/" class="logo">
            <div class="logo-icon">L</div>
            <span>Lumino Server</span>
        </a>
        <nav class="nav">
            <a href="/">概览</a>
            <a href="/monitor">分析</a>
            <a href="/logs" class="active">日志</a>
        </nav>
    </header>
    
    <div class="toolbar">
        <input type="text" class="search-box" id="searchBox" placeholder="搜索日志...">
        <div class="filter-group">
            <label class="filter-btn">
                <input type="checkbox" id="filterDebug" checked>
                <span>DEBUG</span>
            </label>
            <label class="filter-btn">
                <input type="checkbox" id="filterInfo" checked>
                <span>INFO</span>
            </label>
            <label class="filter-btn">
                <input type="checkbox" id="filterWarn" checked>
                <span>WARN</span>
            </label>
            <label class="filter-btn">
                <input type="checkbox" id="filterError" checked>
                <span>ERROR</span>
            </label>
        </div>
        <div style="flex: 1;"></div>
        <button class="btn" onclick="clearLogs()">清空</button>
        <button class="btn btn-primary" onclick="reconnect()">重连</button>
    </div>
    
    <div class="log-container" id="logContainer">
        <table class="log-table">
            <tbody id="logTableBody"></tbody>
        </table>
    </div>
    
    <div class="status-bar">
        <div class="status-left">
            <div class="status-indicator">
                <div class="status-dot connecting" id="statusDot"></div>
                <span class="status-text">状态:</span>
                <span class="status-value" id="connectionStatus">连接中...</span>
            </div>
        </div>
        <span id="logCount">0 条日志</span>
    </div>

    <script>
        let ws = null;
        let logEntries = [];
        const logTableBody = document.getElementById('logTableBody');
        const statusDot = document.getElementById('statusDot');
        const connectionStatus = document.getElementById('connectionStatus');
        const logCount = document.getElementById('logCount');
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/logs/ws';
        
        function connect() {
            statusDot.className = 'status-dot connecting';
            connectionStatus.textContent = '连接中...';
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                statusDot.className = 'status-dot connected';
                connectionStatus.textContent = '已连接';
                ws.send(JSON.stringify({ type: 'subscribeLogs' }));
                addLogEntry({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: '已连接到日志服务器'
                });
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'log') {
                        addLogEntry(data);
                    } else if (data.type === 'logHistory') {
                        data.logs.forEach(log => addLogEntry(log));
                    }
                } catch (e) {
                    console.error('解析错误:', e);
                }
            };
            
            ws.onclose = function() {
                statusDot.className = 'status-dot disconnected';
                connectionStatus.textContent = '已断开';
                setTimeout(connect, 3000);
            };
            
            ws.onerror = function(error) {
                statusDot.className = 'status-dot disconnected';
                connectionStatus.textContent = '错误';
            };
        }
        
        function addLogEntry(entry) {
            logEntries.push(entry);
            
            const row = document.createElement('tr');
            row.className = 'log-row ' + entry.level;
            row.dataset.level = entry.level;
            row.onclick = function() { this.classList.toggle('expanded'); };
            
            let html = '<td class="log-cell log-time">' + formatTime(entry.timestamp) + '</td>';
            html += '<td class="log-cell log-level"><span class="level-badge level-' + entry.level + '">' + entry.level + '</span></td>';
            html += '<td class="log-cell log-message">' + escapeHtml(entry.message);
            
            if (entry.data) {
                html += '<div class="log-data">' + JSON.stringify(entry.data, null, 2) + '</div>';
            }
            
            html += '</td>';
            
            row.innerHTML = html;
            logTableBody.appendChild(row);
            
            logTableBody.parentElement.parentElement.scrollTop = logTableBody.parentElement.parentElement.scrollHeight;
            logCount.textContent = logEntries.length + ' 条日志';
            
            applyFilters();
        }
        
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toISOString().replace('T', ' ').substring(0, 23);
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function clearLogs() {
            logEntries = [];
            logTableBody.innerHTML = '';
            logCount.textContent = '0 entries';
        }
        
        function reconnect() {
            if (ws) {
                ws.close();
            }
        }
        
        function applyFilters() {
            const searchText = document.getElementById('searchBox').value.toLowerCase();
            const showDebug = document.getElementById('filterDebug').checked;
            const showInfo = document.getElementById('filterInfo').checked;
            const showWarn = document.getElementById('filterWarn').checked;
            const showError = document.getElementById('filterError').checked;
            
            const entries = logTableBody.querySelectorAll('.log-row');
            let visibleCount = 0;
            
            entries.forEach(entry => {
                const level = entry.dataset.level;
                const text = entry.textContent.toLowerCase();
                
                let visible = true;
                if (level === 'debug' && !showDebug) visible = false;
                if (level === 'info' && !showInfo) visible = false;
                if (level === 'warn' && !showWarn) visible = false;
                if (level === 'error' && !showError) visible = false;
                if (searchText && !text.includes(searchText)) visible = false;
                
                entry.classList.toggle('hidden', !visible);
                if (visible) visibleCount++;
            });
            
            logCount.textContent = visibleCount + ' / ' + logEntries.length + ' 条日志';
        }
        
        document.getElementById('searchBox').addEventListener('input', applyFilters);
        document.getElementById('filterDebug').addEventListener('change', applyFilters);
        document.getElementById('filterInfo').addEventListener('change', applyFilters);
        document.getElementById('filterWarn').addEventListener('change', applyFilters);
        document.getElementById('filterError').addEventListener('change', applyFilters);
        
        connect();
    </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * 处理主页请求
 */
async function handleHome(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const host = url.host;
  
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumino Server</title>
    <style>
        :root {
            --cf-orange: #F48120;
            --cf-blue: #0055FF;
            --cf-navy: #1D1F20;
            --cf-gray-100: #F7F7F8;
            --cf-gray-200: #E5E5E5;
            --cf-gray-300: #D1D1D1;
            --cf-gray-600: #6B7280;
            --cf-gray-800: #1F2937;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: var(--cf-gray-100);
            color: var(--cf-gray-800);
            line-height: 1.5;
        }
        .header {
            background: white;
            border-bottom: 1px solid var(--cf-gray-200);
            padding: 0 24px;
            height: 64px;
            display: flex;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 20px;
            font-weight: 600;
            color: var(--cf-navy);
        }
        .logo-icon {
            width: 32px;
            height: 32px;
            background: var(--cf-orange);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 16px;
        }
        .main {
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 24px;
        }
        .page-title {
            font-size: 28px;
            font-weight: 600;
            color: var(--cf-navy);
            margin-bottom: 8px;
        }
        .page-subtitle {
            color: var(--cf-gray-600);
            font-size: 14px;
            margin-bottom: 32px;
        }
        .cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 24px;
        }
        .card {
            background: white;
            border-radius: 8px;
            border: 1px solid var(--cf-gray-200);
            padding: 24px;
            transition: all 0.2s ease;
            cursor: pointer;
            text-decoration: none;
            color: inherit;
            display: block;
        }
        .card:hover {
            border-color: var(--cf-blue);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }
        .card-header {
            display: flex;
            align-items: flex-start;
            gap: 16px;
            margin-bottom: 16px;
        }
        .card-icon {
            width: 48px;
            height: 48px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
        }
        .card-icon.blue {
            background: rgba(0, 85, 255, 0.1);
            color: var(--cf-blue);
        }
        .card-icon.dark {
            background: var(--cf-navy);
            color: white;
        }
        .card-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--cf-navy);
            margin-bottom: 4px;
        }
        .card-desc {
            font-size: 14px;
            color: var(--cf-gray-600);
            line-height: 1.5;
        }
        .card-arrow {
            margin-top: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--cf-blue);
            font-size: 14px;
            font-weight: 500;
        }
        .footer {
            margin-top: 48px;
            padding-top: 24px;
            border-top: 1px solid var(--cf-gray-200);
            text-align: center;
            color: var(--cf-gray-600);
            font-size: 13px;
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="logo">
            <div class="logo-icon">L</div>
            <span>Lumino Server</span>
        </div>
    </header>
    
    <main class="main">
        <h1 class="page-title">概览</h1>
        <p class="page-subtitle">${host} &middot; 实时服务器监控和日志</p>
        
        <div class="cards-grid">
            <a href="/monitor" class="card">
                <div class="card-header">
                    <div class="card-icon blue">M</div>
                    <div>
                        <div class="card-title">分析</div>
                        <div class="card-desc">监控服务器指标、活跃房间和用户统计，含历史图表</div>
                    </div>
                </div>
                <div class="card-arrow">
                    查看分析 &rarr;
                </div>
            </a>
            
            <a href="/logs" class="card">
                <div class="card-header">
                    <div class="card-icon dark">L</div>
                    <div>
                        <div class="card-title">日志</div>
                        <div class="card-desc">实时日志流，支持按级别过滤、搜索功能和历史记录</div>
                    </div>
                </div>
                <div class="card-arrow">
                    查看日志 &rarr;
                </div>
            </a>
        </div>
        
        <div class="footer">
            Lumino Collaborative Server
        </div>
    </main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache',
    },
  });
}
