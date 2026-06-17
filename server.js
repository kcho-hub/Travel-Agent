/**
 * Travel Finder — Local Proxy Server
 * Requires only Node.js built-ins (no npm install needed).
 *
 * Usage:  node server.js
 * Then open the URL printed in the console.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const PORT = 3001;

// ── Request handler ──────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // CORS — allow any origin including null (file://)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Serve index.html ────────────────────────────────────────────────────
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Could not read index.html'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── Proxy POST /api/messages  →  Anthropic API ──────────────────────────
  if (req.method === 'POST' && req.url === '/api/messages') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const apiKey = req.headers['x-api-key'] || '';
      if (!apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing x-api-key header' } }));
        return;
      }

      const bodyBuf = Buffer.from(body);
      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':       'application/json',
          'x-api-key':          apiKey,
          'anthropic-version':  '2023-06-01',
          'Content-Length':     bodyBuf.length
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode,
          { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', err => {
        console.error('Proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }));
      });

      proxyReq.write(bodyBuf);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n========================================');
  console.log('  ✈️  AI Travel Finder — Local Server');
  console.log('========================================');
  console.log(`\n  Open this URL in your browser:\n\n    ${url}\n`);
  console.log('  Press Ctrl+C to stop the server.\n');

  // Auto-open browser on Windows / Mac / Linux
  try {
    const cmd = process.platform === 'win32' ? `start ${url}`
              : process.platform === 'darwin' ? `open ${url}`
              : `xdg-open ${url}`;
    execSync(cmd);
  } catch (_) { /* ignore if auto-open fails */ }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Either stop the other process or open http://localhost:${PORT} directly.\n`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
