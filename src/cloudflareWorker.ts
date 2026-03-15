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

    // 处理 WebSocket 升级请求 - 直接路由到 RoomDurableObject
    if (path === '/ws') {
      return handleWebSocketRequest(request, env);
    }

    // API: 健康检查
    if (path === '/health' && request.method === 'GET') {
      return handleHealthCheck(env);
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

  // 直接转发到 RoomDurableObject 处理 WebSocket 升级
  const roomDurableObject = getRoomDurableObject(env, roomId);
  return roomDurableObject.fetch(request);
}

/**
 * 处理健康检查
 */
async function handleHealthCheck(env: Env): Promise<Response> {
  try {
    const stats = roomManager.getStats();
    
    return new Response(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        serverIp: 'lumino-collaborative-server.enderman-bm.workers.dev',
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
    
    return new Response(
      JSON.stringify({
        success: true,
        room: {
          id: roomData.id,
          inviteCode: roomData.inviteCode,
          name: roomData.name,
          hostId: roomData.hostId,
        },
        webSocketUrl: `wss://lumino-collaborative-server.enderman-bm.workers.dev/ws?roomId=${inviteCode}`,
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
