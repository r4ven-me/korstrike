'use strict';

const { WebSocketServer } = require('ws');
const { URL } = require('url');

// WebSocket auth uses short-lived one-time tokens (issued by GET /api/ws-token
// to an already-authenticated session) rather than parsing the session
// cookie during the raw HTTP upgrade — much simpler than wiring express-session
// into the upgrade handler, and plenty secure for a single-admin LAN panel.
function setupWebSocket(server, { wsTokens }) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url, 'http://internal');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const token = searchParams.get('token');
    const entry = token ? wsTokens.get(token) : null;
    if (!entry || entry.expires < Date.now()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wsTokens.delete(token);
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  function broadcast(data) {
    const payload = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  return { broadcast };
}

module.exports = { setupWebSocket };
