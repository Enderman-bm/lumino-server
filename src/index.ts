/**
 * Lumino 协作服务器 - 主入口
 */

import { createServer } from 'http';
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
    const stats = {
      status: 'ok',
      timestamp: new Date().toISOString(),
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
