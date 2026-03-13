/**
 * Simple WebSocket test worker
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Simple WebSocket echo server
    if (url.pathname === '/ws' && request.method === 'GET') {
      const upgradeHeader = request.headers.get('Upgrade');
      
      if (upgradeHeader === 'websocket') {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        server.accept();
        
        server.addEventListener('message', (event) => {
          console.log('Received message:', event.data);
          server.send(`Echo: ${event.data}`);
        });
        
        server.addEventListener('close', () => {
          console.log('WebSocket closed');
        });
        
        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }
      
      return new Response('WebSocket upgrade required', { status: 400 });
    }
    
    return new Response('Hello from simple worker!', { status: 200 });
  }
};
