
const http = require('http');
const { spawn } = require('child_process');

const PORT = 5000;

const sendJson = (res, status, data) => {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
};

const server = http.createServer((req, res) => {
  const start = Date.now();
  console.log(`[REQ] ${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    console.log('[REQ] Preflight handled');
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(data || '{}');
        const previousFen = typeof payload.fen === 'string'
          ? payload.fen
          : (payload.previous_fen || payload.current_fen || null);
        const { side, depth } = payload;

        if (!previousFen) {
          return sendJson(res, 400, { error: 'Missing fen' });
        }

        const py = spawn('python', [
          __dirname + '/stockfish_bridge.py',
          previousFen,
          side || 'b',
          String(depth || 12),
        ]);
        let out = '';
        let err = '';
        py.stdout.on('data', (d) => { out += d.toString(); });
        py.stderr.on('data', (d) => { err += d.toString(); });
        py.on('close', (code) => {
          if (code !== 0) {
            return sendJson(res, 500, { error: 'Engine error', detail: err.trim() });
          }
          try {
            const result = JSON.parse(out || '{}');
            let bestmove = null;
            if (Array.isArray(result.lines) && result.lines.length > 0) {
              const parts = String(result.lines[0]).trim().split(/\s+/);
              const pvIdx = parts.indexOf('pv');
              if (pvIdx !== -1 && pvIdx + 1 < parts.length) {
                bestmove = parts[pvIdx + 1];
              }
            }
            sendJson(res, 200, { bestmove });
          } catch (e) {
            sendJson(res, 500, { error: 'Invalid bridge output', detail: out.trim() });
          }
        });
        py.on('error', (e) => {
          sendJson(res, 500, { error: 'Engine spawn error', detail: String(e.message || e) });
        });

      } catch (e) {
        console.error('[AI] JSON parse error', e);
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`AI backend listening on http://localhost:${PORT}`);
});
