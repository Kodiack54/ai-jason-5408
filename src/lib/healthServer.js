/**
 * Jason Health Server
 * Exposes /health endpoint for dashboard monitoring
 */

const http = require('http');

/**
 * Start a minimal health check server
 * @param {Object} options
 * @param {number} options.port - Port to listen on
 * @param {Function} options.getStatus - Function that returns current status
 */
function startHealthServer({ port, getStatus }) {
  if (!port) return null;

  const server = http.createServer((req, res) => {
    // CORS headers for dashboard access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/health' || req.url === '/') {
      const status = getStatus ? getStatus() : {};
      const payload = {
        ok: true,
        service: 'ai-jason-5408',
        role: 'Guardrailed Extraction Scheduler',
        timestamp: new Date().toISOString(),
        ...status
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    if (req.url === '/status') {
      const status = getStatus ? getStatus() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[Jason] Health server listening on :${port} (/health)`);
  });

  server.on('error', (err) => {
    console.error(`[Jason] Health server error:`, err.message);
  });

  return server;
}

module.exports = { startHealthServer };
