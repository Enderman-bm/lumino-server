/**
 * Lumino 协作服务器 - 主入口
 */

import { createServer } from 'http';
import { networkInterfaces } from 'os';
import { createWebSocketServer } from './websocketServer';
import { roomManager } from './roomManager';
import { userManager } from './userManager';
import { log } from './utils';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
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

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// 创建WebSocket服务器
const wss = createWebSocketServer(httpServer);

// 启动服务器
httpServer.listen(PORT, HOST, () => {
  log('info', `=================================`);
  log('info', `Lumino 协作服务器已启动`);
  if (isDevMode) {
    log('info', `模式: 开发模式 (事件日志已启用)`);
  }
  log('info', `HTTP: http://${HOST}:${PORT}`);
  log('info', `WebSocket: ws://${HOST}:${PORT}/ws`);
  log('info', `=================================`);
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
