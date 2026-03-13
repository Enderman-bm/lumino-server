/**
 * Minimal WebSocket test worker
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/ws' && request.method === 'GET') {
      const upgradeHeader = request.headers.get('Upgrade');
      
      if (upgradeHeader === 'websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        server.accept();
        
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
};
