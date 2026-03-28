/**
 * Lumino 协作服务器 - 主入口
 */

import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { createWebSocketServer } from './websocketServer';
import { roomManager } from './roomManager';
import { userManager } from './userManager';
import { log, generateInviteCode, generateId } from './utils';
import { handleCloudStorageRoute } from './handlers/cloudStorageHandler';
import { handleCloudUIRoute } from './handlers/cloudStorageUI';
import { authManager } from './authManager';

// 配置
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 检查是否在开发模式
const isDevMode = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true' || process.argv.includes('--dev');
if (isDevMode) {
  console.log('\n🚀 开发模式已启用 - 所有WebSocket事件将被记录\n');
}

// 创建HTTP服务器
const httpServer = createServer((req, res) => {
  // 设置CORS头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 云存储Web UI路由
  if (req.url?.startsWith('/cloud')) {
    if (handleCloudUIRoute(req, res)) {
      return;
    }
  }

  // 云存储API路由
  if (req.url?.startsWith('/api/auth/') || 
      req.url?.startsWith('/api/files') || 
      req.url?.startsWith('/api/admin/') ||
      req.url === '/api/stats') {
    handleCloudStorageRoute(req, res);
    return;
  }

  // 健康检查端点
  if (req.url === '/health' && req.method === 'GET') {
    // 获取服务器IP
    const interfaces = networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const config of iface) {
        if (config.family === 'IPv4' && !config.internal) {
          serverIp = config.address;
          break;
        }
      }
    }

    const stats = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      serverIp: serverIp,
      rooms: roomManager.getStats(),
      users: userManager.getStats(),
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // 服务器信息端点
  if (req.url === '/info' && req.method === 'GET') {
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
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return;
  }

  // 监控WebUI端点
  if (req.url === '/monitor' && req.method === 'GET') {
    const stats = roomManager.getStats();
    const userStats = userManager.getStats();
    
    // 获取服务器IP
    const interfaces = networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const config of iface) {
        if (config.family === 'IPv4' && !config.internal) {
          serverIp = config.address;
          break;
        }
      }
    }

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
            <div class="info-item">IP地址: <span id="server-ip">${serverIp}</span></div>
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

    res.writeHead(200, { 
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
    return;
  }

  // 日志查看WebUI端点
  if (req.url === '/logs' && req.method === 'GET') {
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lumino 服务器日志</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            background: #1e1e1e; 
            color: #d4d4d4;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header { 
            background: #252526; 
            padding: 15px 20px; 
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 { font-size: 1.2em; color: #fff; }
        .controls { display: flex; gap: 10px; align-items: center; }
        .controls button {
            background: #0e639c;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .controls button:hover { background: #1177bb; }
        .controls button.clear { background: #c75450; }
        .controls button.clear:hover { background: #d96864; }
        .filter-group { display: flex; gap: 5px; }
        .filter-group label {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 0.85em;
            cursor: pointer;
        }
        .filter-group input[type="checkbox"] { cursor: pointer; }
        .search-box {
            background: #3c3c3c;
            border: 1px solid #555;
            color: #d4d4d4;
            padding: 4px 8px;
            border-radius: 3px;
            width: 200px;
        }
        .log-container {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 0.85em;
            line-height: 1.5;
        }
        .log-entry {
            padding: 4px 8px;
            border-left: 3px solid transparent;
            margin-bottom: 2px;
            display: flex;
            gap: 10px;
        }
        .log-entry:hover { background: #2a2d2e; }
        .log-entry.debug { border-left-color: #858585; }
        .log-entry.info { border-left-color: #75beff; }
        .log-entry.warn { border-left-color: #ffcc00; }
        .log-entry.error { border-left-color: #f48771; }
        .log-time { color: #858585; min-width: 170px; }
        .log-level {
            min-width: 50px;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 0.8em;
        }
        .log-level.debug { color: #858585; }
        .log-level.info { color: #75beff; }
        .log-level.warn { color: #ffcc00; }
        .log-level.error { color: #f48771; }
        .log-message { flex: 1; word-break: break-all; }
        .log-data {
            margin-top: 4px;
            padding: 8px;
            background: #252526;
            border-radius: 3px;
            font-size: 0.9em;
            color: #9cdcfe;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .status-bar {
            background: #007acc;
            color: white;
            padding: 5px 20px;
            font-size: 0.85em;
            display: flex;
            justify-content: space-between;
        }
        .status-bar.disconnected { background: #c75450; }
        .status-bar.connecting { background: #ffcc00; color: #333; }
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📝 Lumino 服务器日志</h1>
        <div class="controls">
            <input type="text" class="search-box" id="searchBox" placeholder="搜索日志...">
            <div class="filter-group">
                <label><input type="checkbox" id="filterDebug" checked> Debug</label>
                <label><input type="checkbox" id="filterInfo" checked> Info</label>
                <label><input type="checkbox" id="filterWarn" checked> Warn</label>
                <label><input type="checkbox" id="filterError" checked> Error</label>
            </div>
            <button onclick="clearLogs()">清空</button>
            <button class="clear" onclick="reconnect()">重连</button>
        </div>
    </div>
    <div class="log-container" id="logContainer"></div>
    <div class="status-bar" id="statusBar">
        <span id="connectionStatus">正在连接...</span>
        <span id="logCount">0 条日志</span>
    </div>

    <script>
        let ws = null;
        let logEntries = [];
        const logContainer = document.getElementById('logContainer');
        const statusBar = document.getElementById('statusBar');
        const connectionStatus = document.getElementById('connectionStatus');
        const logCount = document.getElementById('logCount');
        
        // 获取当前WebSocket协议
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host + '/ws';
        
        function connect() {
            statusBar.className = 'status-bar connecting';
            connectionStatus.textContent = '正在连接...';
            
            ws = new WebSocket(wsUrl);
            
            ws.onopen = function() {
                statusBar.className = 'status-bar';
                connectionStatus.textContent = '已连接';
                // 订阅日志
                ws.send(JSON.stringify({ type: 'subscribeLogs' }));
                addLogEntry({
                    timestamp: new Date().toISOString(),
                    level: 'info',
                    message: '连接到日志服务器'
                });
            };
            
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'log') {
                        addLogEntry(data);
                    } else if (data.type === 'logHistory') {
                        // 接收历史日志
                        data.logs.forEach(log => addLogEntry(log));
                    }
                } catch (e) {
                    console.error('解析消息失败:', e);
                }
            };
            
            ws.onclose = function() {
                statusBar.className = 'status-bar disconnected';
                connectionStatus.textContent = '已断开';
                setTimeout(connect, 3000);
            };
            
            ws.onerror = function(error) {
                console.error('WebSocket错误:', error);
                statusBar.className = 'status-bar disconnected';
                connectionStatus.textContent = '连接错误';
            };
        }
        
        function addLogEntry(entry) {
            logEntries.push(entry);
            
            const div = document.createElement('div');
            div.className = 'log-entry ' + entry.level;
            div.dataset.level = entry.level;
            
            let html = '<span class="log-time">' + formatTime(entry.timestamp) + '</span>';
            html += '<span class="log-level ' + entry.level + '">' + entry.level + '</span>';
            html += '<span class="log-message">' + escapeHtml(entry.message) + '</span>';
            
            if (entry.data) {
                html += '<div class="log-data">' + JSON.stringify(entry.data, null, 2) + '</div>';
            }
            
            div.innerHTML = html;
            logContainer.appendChild(div);
            
            // 自动滚动到底部
            logContainer.scrollTop = logContainer.scrollHeight;
            
            // 更新计数
            logCount.textContent = logEntries.length + ' 条日志';
            
            // 应用过滤器
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
            logContainer.innerHTML = '';
            logCount.textContent = '0 条日志';
        }
        
        function reconnect() {
            if (ws) {
                ws.close();
            }
            connect();
        }
        
        function applyFilters() {
            const searchText = document.getElementById('searchBox').value.toLowerCase();
            const showDebug = document.getElementById('filterDebug').checked;
            const showInfo = document.getElementById('filterInfo').checked;
            const showWarn = document.getElementById('filterWarn').checked;
            const showError = document.getElementById('filterError').checked;
            
            const entries = logContainer.querySelectorAll('.log-entry');
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
        
        // 绑定事件
        document.getElementById('searchBox').addEventListener('input', applyFilters);
        document.getElementById('filterDebug').addEventListener('change', applyFilters);
        document.getElementById('filterInfo').addEventListener('change', applyFilters);
        document.getElementById('filterWarn').addEventListener('change', applyFilters);
        document.getElementById('filterError').addEventListener('change', applyFilters);
        
        // 启动连接
        connect();
    </script>
</body>
</html>`;
    
    res.writeHead(200, { 
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
    return;
  }

  // API: 创建房间
  if (req.url === '/api/room/create' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { name, hostId, hostName } = data;

        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required field: name' }));
          return;
        }

        // 生成邀请码
        const inviteCode = generateInviteCode();
        const roomId = generateId();

        // 获取服务器地址
        const interfaces = networkInterfaces();
        let serverIp = 'localhost';
        for (const name of Object.keys(interfaces)) {
          const iface = interfaces[name];
          if (!iface) continue;
          for (const config of iface) {
            if (config.family === 'IPv4' && !config.internal) {
              serverIp = config.address;
              break;
            }
          }
        }

        const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss:' : 'ws:';
        const host = req.headers.host || `${serverIp}:${PORT}`;
        const webSocketUrl = `${protocol}//${host}/ws?roomId=${inviteCode}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          room: {
            id: roomId,
            inviteCode,
            name,
            hostId: hostId || generateId(),
          },
          webSocketUrl,
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  // API: 获取房间信息
  if (req.url?.startsWith('/api/room/') && req.url.endsWith('/info') && req.method === 'GET') {
    const parts = req.url.split('/');
    const roomId = parts[3];
    
    const room = roomManager.getRoomByInviteCode(roomId) || roomManager.getRoom(roomId);
    
    if (!room) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Room not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: room.id,
      inviteCode: room.inviteCode,
      name: room.name,
      hostId: room.hostId,
      userCount: room.users.size,
      maxUsers: room.maxUsers,
    }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// 日志存储（最多保存1000条）
export const logBuffer: { timestamp: string; level: string; message: string; data?: any }[] = [];
export const maxLogBufferSize = 1000;

// 广播日志给所有连接的日志客户端
export function broadcastLog(level: string, message: string, data?: any) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    data,
  };
  
  // 添加到缓冲区
  logBuffer.push(logEntry);
  if (logBuffer.length > maxLogBufferSize) {
    logBuffer.shift();
  }
  
  // 广播给所有日志客户端
  const logMessage = JSON.stringify({
    type: 'log',
    ...logEntry,
  });
  
  // 通过全局 wss 广播
  if ((global as any).wss) {
    (global as any).wss.clients.forEach((client: any) => {
      if (client.readyState === 1 && client.isLogClient) {
        client.send(logMessage);
      }
    });
  }
}

// 创建WebSocket服务器
const wss = createWebSocketServer(httpServer);
(global as any).wss = wss;

// 初始化云存储系统
async function initializeCloudStorage() {
  try {
    await authManager.initializeAdmin();
    log('info', '云存储系统初始化完成');
    log('info', '管理员账户: admin / 初始密码: 123456');
    log('info', '云存储Web UI: http://' + HOST + ':' + PORT + '/cloud');
  } catch (error) {
    log('error', '云存储系统初始化失败', { error });
  }
}

// 启动服务器
httpServer.listen(PORT, HOST, async () => {
  log('info', `=================================`);
  log('info', `Lumino 协作服务器已启动`);
  if (isDevMode) {
    log('info', `模式: 开发模式 (事件日志已启用)`);
  }
  log('info', `HTTP: http://${HOST}:${PORT}`);
  log('info', `WebSocket: ws://${HOST}:${PORT}/ws`);
  log('info', `云存储: http://${HOST}:${PORT}/cloud`);
  log('info', `=================================`);

  // 初始化云存储
  await initializeCloudStorage();
});

// 优雅关闭
process.on('SIGTERM', () => {
  log('info', '收到SIGTERM信号，正在关闭服务器...');
  
  wss.close(() => {
    log('info', 'WebSocket服务器已关闭');
  });
  
  httpServer.close(() => {
    log('info', 'HTTP服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('info', '收到SIGINT信号，正在关闭服务器...');
  
  wss.close(() => {
    log('info', 'WebSocket服务器已关闭');
  });
  
  httpServer.close(() => {
    log('info', 'HTTP服务器已关闭');
    process.exit(0);
  });
});

// 定期清理任务（每30分钟）
setInterval(() => {
  log('info', '执行定期清理任务...');
  roomManager.cleanupInactiveRooms(24 * 60 * 60 * 1000); // 24小时
  userManager.cleanupInactiveUsers(60 * 60 * 1000); // 1小时
}, 30 * 60 * 1000);

// 未捕获的异常处理
process.on('uncaughtException', (error) => {
  log('error', '未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', '未处理的Promise拒绝:', reason);
});
