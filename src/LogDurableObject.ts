/**
 * LogDurableObject - Durable Object for cross-request real-time log broadcasting
 *
 * This Durable Object maintains a persistent state across all requests,
 * enabling real-time log broadcasting to all connected log clients.
 */

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data?: unknown[];
}

export class LogDurableObject {
  private ctx: DurableObjectState;
  private logClients: Set<WebSocket> = new Set();
  private logBuffer: LogEntry[] = [];
  private readonly maxLogBufferSize = 200;
  private websocketConnections: Map<WebSocket, { userId: string }> = new Map();

  constructor(state: DurableObjectState, env?: unknown) {
    this.ctx = state;
  }

  /**
   * Handle HTTP requests - primarily for WebSocket upgrades
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade endpoint for log clients
    if (url.pathname === '/logs/ws' && request.method === 'GET') {
      return this.handleWebSocketUpgrade(request);
    }

    // API endpoint to broadcast a log message
    if (url.pathname === '/logs/broadcast' && request.method === 'POST') {
      return this.handleBroadcastLog(request);
    }

    // API endpoint to get current log buffer
    if (url.pathname === '/logs/buffer' && request.method === 'GET') {
      return new Response(JSON.stringify({
        logs: this.logBuffer,
        clientCount: this.logClients.size,
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle WebSocket upgrade requests for log clients
   */
  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 400 });
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket connection
    server.accept();

    // Handle the log client WebSocket connection
    this.handleLogClientWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Handle log client WebSocket connections
   */
  private handleLogClientWebSocket(ws: WebSocket): void {
    const clientId = this.generateClientId();
    
    // Add to clients set
    this.logClients.add(ws);
    this.websocketConnections.set(ws, { userId: clientId });

    console.log(`[LogDurableObject] Log client connected: ${clientId}. Total clients: ${this.logClients.size}`);

    // Send recent log history to the new client
    if (this.logBuffer.length > 0) {
      const historyMessage = {
        type: 'logHistory',
        logs: this.logBuffer.slice(-50),
      };
      try {
        ws.send(JSON.stringify(historyMessage));
      } catch (e) {
        console.error('[LogDurableObject] Failed to send log history:', e);
      }
    }

    // Send connection confirmation
    this.sendToClient(ws, {
      type: 'log',
      timestamp: new Date().toISOString(),
      level: 'info',
      message: '已连接到日志服务器',
    });

    // Set up message handler
    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data as string);
        this.handleClientMessage(ws, data);
      } catch (error) {
        console.error('[LogDurableObject] Failed to parse client message:', error);
      }
    });

    // Handle close
    ws.addEventListener('close', () => {
      console.log(`[LogDurableObject] Log client disconnected: ${clientId}`);
      this.logClients.delete(ws);
      this.websocketConnections.delete(ws);
    });

    // Handle error
    ws.addEventListener('error', (error) => {
      console.error(`[LogDurableObject] WebSocket error for client ${clientId}:`, error);
      this.logClients.delete(ws);
      this.websocketConnections.delete(ws);
    });
  }

  /**
   * Handle messages from log clients
   */
  private handleClientMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'subscribeLogs':
        // Client already subscribed by connecting, but we can handle additional logic here
        console.log('[LogDurableObject] Client requested log subscription');
        this.sendToClient(ws, {
          type: 'log',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: '日志订阅已确认',
        });
        break;

      case 'ping':
        this.sendToClient(ws, {
          type: 'pong',
          timestamp: message.timestamp,
          serverTime: Date.now(),
        });
        break;

      case 'clearLogs':
        // Optional: clear the log buffer
        this.logBuffer = [];
        this.broadcastToAllClients({
          type: 'log',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: '日志缓冲区已清空',
        });
        break;

      default:
        console.log('[LogDurableObject] Unknown message type:', message.type);
    }
  }

  /**
   * Handle broadcast log API requests from the Worker
   */
  private async handleBroadcastLog(request: Request): Promise<Response> {
    try {
      const logEntry: LogEntry = await request.json();
      
      // Add to buffer
      this.addToBuffer(logEntry);
      
      // Broadcast to all clients
      this.broadcastLog(logEntry);

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      console.error('[LogDurableObject] Failed to broadcast log:', error);
      return new Response(JSON.stringify({ error: 'Invalid log entry' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  /**
   * Add a log entry to the buffer
   */
  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxLogBufferSize) {
      this.logBuffer.shift();
    }
  }

  /**
   * Broadcast a log entry to all connected clients
   */
  public broadcastLog(entry: LogEntry): void {
    const message = JSON.stringify({
      type: 'log',
      ...entry,
    });

    const deadClients: WebSocket[] = [];

    this.logClients.forEach((ws) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        } else {
          deadClients.push(ws);
        }
      } catch (e) {
        console.error('[LogDurableObject] Failed to send log to client:', e);
        deadClients.push(ws);
      }
    });

    // Clean up dead clients
    deadClients.forEach((ws) => {
      this.logClients.delete(ws);
      this.websocketConnections.delete(ws);
    });
  }

  /**
   * Send a message to a specific client
   */
  private sendToClient(ws: WebSocket, message: any): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (e) {
      console.error('[LogDurableObject] Failed to send message to client:', e);
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcastToAllClients(message: any): void {
    const messageStr = JSON.stringify(message);
    const deadClients: WebSocket[] = [];

    this.logClients.forEach((ws) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(messageStr);
        } else {
          deadClients.push(ws);
        }
      } catch (e) {
        deadClients.push(ws);
      }
    });

    // Clean up dead clients
    deadClients.forEach((ws) => {
      this.logClients.delete(ws);
      this.websocketConnections.delete(ws);
    });
  }

  /**
   * Get the current log buffer
   */
  public getLogBuffer(): LogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * Get the number of connected log clients
   */
  public getClientCount(): number {
    return this.logClients.size;
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `log-client-${Math.random().toString(36).substring(2, 15)}`;
  }
}
