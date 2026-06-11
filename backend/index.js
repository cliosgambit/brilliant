const originalEmit = process.emit;
process.emit = function emit(event, warning, ...rest) {
  if (
    event === 'warning' &&
    warning?.name === 'ExperimentalWarning' &&
    String(warning?.message || '').includes('SQLite')
  ) {
    return false;
  }
  return originalEmit.call(this, event, warning, ...rest);
};

require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { db, dbPath } = require('./db/database');
const { mountAnalysisHistoryRoutes } = require('./routes/analysisHistory');
const { mountLichessPgnsRoutes } = require('./routes/lichessPgns');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const start = Date.now();
  const meta = { ip: req.ip, method: req.method, url: req.originalUrl, query: req.query, length: parseInt(req.headers['content-length'] || '0', 10) };
  console.log('[REQ]', meta);
  res.on('finish', () => {
    console.log('[RES]', { status: res.statusCode, ms: Date.now() - start, url: req.originalUrl });
  });
  next();
});

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from Node.js backend!' });
});

let workingPython = 'python';

class PersistentStockfish {
  constructor() {
    this.exePath = path.join(__dirname, '..', 'stockfish', 'stockfish-windows-x86-64-avx2.exe');
    this.proc = null;
    this.queue = [];
    this.isProcessing = false;
    this.stdoutBuffer = '';
    this.currentTask = null;
    this.initPromise = null;
  }

  async ensureInitialized() {
    if (this.proc && !this.proc.killed) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (!fs.existsSync(this.exePath)) {
        return reject(new Error(`Stockfish not found at ${this.exePath}`));
      }

      console.log('[SF] Starting persistent engine...');
      this.proc = spawn(this.exePath);
      this.proc.stdin.setEncoding('utf-8');

      this.proc.stdout.on('data', (data) => {
        this.stdoutBuffer += data.toString();
        this.processBuffer();
      });

      this.proc.on('error', (err) => {
        console.error('[SF PERSISTENT ERROR]', err);
        if (this.currentTask) {
          this.currentTask.reject(err);
          this.cleanupTask();
        }
      });

      this.proc.on('exit', (code) => {
        console.log(`[SF] Persistent engine exited with code ${code}`);
        this.proc = null;
        this.initPromise = null;
        if (this.currentTask) {
          this.currentTask.reject(new Error('Engine exited unexpectedly'));
          this.cleanupTask();
        }
      });

      // UCI init
      this.send('uci');
      this.send('isready');
      
      const checkReady = (data) => {
        if (data.toString().includes('readyok')) {
          this.proc.stdout.removeListener('data', checkReady);
          console.log('[SF] Persistent engine ready');
          resolve();
        }
      };
      this.proc.stdout.on('data', checkReady);
    });

    return this.initPromise;
  }

  send(cmd) {
    if (this.proc && this.proc.stdin.writable) {
      this.proc.stdin.write(cmd + '\n');
    }
  }

  processBuffer() {
    if (!this.currentTask) return;

    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop(); // Keep last partial line

    for (const line of lines) {
      if (!line) continue;
      this.currentTask.lines.push(line);
      console.log('[SF PERSISTENT]', line);

      if (line.startsWith('bestmove')) {
        try {
          const result = parseEngineLines(this.currentTask.lines);
          this.currentTask.resolve(result);
        } catch (e) {
          this.currentTask.reject(e);
        }
        this.cleanupTask();
        this.processQueue();
        return;
      }
    }
  }

  cleanupTask() {
    if (this.currentTask?.timer) clearTimeout(this.currentTask.timer);
    this.currentTask = null;
    this.isProcessing = false;
  }

  async runAnalysis(opts) {
    return new Promise((resolve, reject) => {
      this.queue.push({ opts, resolve, reject, lines: [] });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    try {
      await this.ensureInitialized();
      this.currentTask = this.queue.shift();
      
      const { fen, depth, movetime, multipv, searchmoves, moves } = this.currentTask.opts;
      
      this.send('ucinewgame');
      this.send('isready');

      if (parseInt(multipv || 0, 10) > 1) {
        this.send(`setoption name MultiPV value ${parseInt(multipv, 10)}`);
      } else {
        this.send('setoption name MultiPV value 1');
      }

      if (moves) {
        this.send(`position startpos moves ${moves}`);
      } else if (fen) {
        this.send(`position fen ${fen}`);
      }

      const goCmd = movetime 
        ? `go movetime ${movetime} ${searchmoves ? 'searchmoves ' + searchmoves : ''}`
        : `go depth ${depth || 20} ${searchmoves ? 'searchmoves ' + searchmoves : ''}`;
      
      const timerMs = movetime ? Math.max(3000, parseInt(movetime, 10) + 3000) : Math.max(15000, (parseInt(depth || 20, 10) * 1000));
      this.currentTask.timer = setTimeout(() => {
        if (this.currentTask) {
          this.currentTask.reject(new Error('Engine timeout after ' + timerMs + 'ms'));
          this.cleanupTask();
          this.processQueue();
        }
      }, timerMs);

      this.send(goCmd);
    } catch (e) {
      this.currentTask.reject(e);
      this.cleanupTask();
      this.processQueue();
    }
  }
}

const sfEngine = new PersistentStockfish();
const sfBackgroundEngine = new PersistentStockfish(); // Second engine for background tasks

const analysisCache = new Map();

function runEngineDirect(opts, useBackground = false) {
  const engine = useBackground ? sfBackgroundEngine : sfEngine;
  return engine.runAnalysis(opts);
}

async function runEngineWithFallbacks(primaryOpts, fallbackOptsList = [], useBackground = false) {
  const attempts = [primaryOpts, ...fallbackOptsList].filter(Boolean);
  let lastErr = null;

  for (const opts of attempts) {
    try {
      return await runEngineDirect(opts, useBackground);
    } catch (err) {
      lastErr = err;
      console.warn('[ANALYZE][RETRY]', {
        fen: opts?.fen,
        depth: opts?.depth,
        movetime: opts?.movetime,
        multipv: opts?.multipv,
        error: err?.message || String(err),
      });
    }
  }

  throw lastErr || new Error('Engine analysis failed');
}

function parseEngineLines(lines) {
  let score = null;
  let outDepth = 0;
  let bestmove = null;
  let ponder = null;
  let pv = null;
  const multi = {};

  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(/\s+/);
    
    if (line.startsWith('bestmove')) {
      bestmove = parts[1] === '(none)' ? null : parts[1];
      ponder = parts[3] && parts[2] === 'ponder' ? parts[3] : null;
      continue;
    }
    
    if (!line.startsWith('info ')) continue;
    
    const mpIdx = parts.indexOf('multipv');
    const hasMulti = mpIdx !== -1 && mpIdx + 1 < parts.length;
    const mp = hasMulti ? parseInt(parts[mpIdx + 1], 10) : 1;
    
    const dIdx = parts.indexOf('depth');
    if (dIdx !== -1 && dIdx + 1 < parts.length) {
      const dVal = parseInt(parts[dIdx + 1], 10);
      if (!isNaN(dVal)) {
        outDepth = Math.max(outDepth, dVal);
        if (hasMulti) {
          multi[mp] = multi[mp] || {};
          multi[mp].depth = dVal;
        }
      }
    }
    
    const sIdx = parts.indexOf('score');
    if (sIdx !== -1 && sIdx + 2 < parts.length) {
      const type = parts[sIdx + 1]; // 'cp' or 'mate'
      const value = parseInt(parts[sIdx + 2], 10);
      if (!isNaN(value)) {
        const sc = { type, value };
        if (hasMulti) {
          multi[mp] = multi[mp] || {};
          multi[mp].score = sc;
        } else {
          score = sc;
        }
      }
    }
    
    const pvIdx = parts.indexOf('pv');
    if (pvIdx !== -1 && pvIdx + 1 < parts.length) {
      const pvStr = parts.slice(pvIdx + 1).join(' ');
      if (hasMulti) {
        multi[mp] = multi[mp] || {};
        multi[mp].pv = pvStr;
      } else {
        pv = pvStr;
      }
    }
  }

  const linesOut = Object.keys(multi)
    .map(k => ({ multipv: parseInt(k, 10), ...multi[k] }))
    .filter(l => l.score && l.pv)
    .sort((a, b) => a.multipv - b.multipv);

  if (linesOut.length > 0) {
    if (!score) score = linesOut[0].score;
    if (!pv) pv = linesOut[0].pv;
  }

  return { 
    bestmove, 
    ponder, 
    score: score || { type: 'cp', value: 0 }, 
    depth: outDepth, 
    pv, 
    lines: linesOut 
  };
}

function scoreToWhiteWinProbability(score, turnForPosition) {
  if (!score || typeof score.value !== 'number') return 50;
  let v = score.type === 'cp' ? score.value / 100 : score.value;
  if (turnForPosition === 'b') v = -v;
  if (score.type === 'mate') {
    if (v > 0) return 100;
    if (v < 0) return 0;
    return turnForPosition === 'w' ? 0 : 100;
  }
  if (v >= 8) return 100;
  if (v >= 4) return 90 + ((v - 4) / 4) * 10;
  if (v >= 0) return 50 + (v / 4) * 40;
  if (v >= -4) return 10 + ((v + 4) / 4) * 40;
  if (v >= -8) return ((v + 8) / 4) * 10;
  return 0;
}

async function computeFirstMoveScores({ previousFen, lines }) {
  if (!previousFen || !Array.isArray(lines) || lines.length === 0) return {};

  const firstMoves = [
    ...new Set(
      lines
        .map((line) => String(line?.pv || '').trim().split(/\s+/)[0])
        .filter(Boolean)
    ),
  ];

  // Specific times for top 3 moves as requested: 200ms, 150ms, 100ms.
  const tieredTimes = [200, 150, 100];

  const entries = await Promise.all(
    firstMoves.map(async (mv, index) => {
      const movetime = tieredTimes[index] || 100; // Default to 100ms for moves beyond top 3
      try {
        const result = await runEngineWithFallbacks(
          { fen: previousFen, moves: mv, movetime, multipv: 1 },
          [
            { fen: previousFen, moves: mv, movetime: Math.max(50, Math.floor(movetime * 0.5)), multipv: 1 },
            { fen: previousFen, moves: mv, depth: 10, movetime: 1500, multipv: 1 },
          ],
          true // useBackground = true
        );
        return [mv, result?.score || null];
      } catch (e) {
        console.warn('[ANALYZE][FIRSTMOVE][RETRY-FAILED]', { move: mv, error: e?.message || String(e) });
        return [mv, null];
      }
    })
  );

  return Object.fromEntries(entries);
}

app.post('/api/analyze', async (req, res) => {
  const body = req.body || {};
  const { depth, movetime, current_fen, previous_fen, multipv } = body;
  const currentFen = current_fen || body.fen || previous_fen;
  const previousFen = previous_fen || body.fen || current_fen;

  if (!currentFen || !previousFen) {
    res.status(400).json({ error: 'Both current_fen and previous_fen are required' });
    return;
  }

  // 1. Check Cache first
  const cacheKey = `${currentFen}|${previousFen}|${multipv}`;
  if (analysisCache.has(cacheKey)) {
    console.log('[CACHE] Hit:', cacheKey);
    return res.json(analysisCache.get(cacheKey));
  }

  console.log('[ANALYZE]', { currentFen, previousFen, depth, movetime, multipv });
  
  try {
    const requestedMultiPv = Math.max(1, Math.min(10, parseInt(multipv || 3, 10)));
    
    // Scan time is 80ms, Played move time is 200ms
    const scanTime = 80;
    const playedMoveTime = 200;

    const [currentSettled, previousSettled] = await Promise.allSettled([
      runEngineWithFallbacks(
        { fen: currentFen, movetime: playedMoveTime },
        [
          { fen: currentFen, movetime: 100, multipv: 1 },
          { fen: currentFen, depth: 10, movetime: 1500, multipv: 1 },
        ]
      ),
      runEngineWithFallbacks(
        { fen: previousFen, movetime: scanTime, multipv: requestedMultiPv },
        [
          { fen: previousFen, movetime: 50, multipv: Math.min(3, requestedMultiPv) },
          { fen: previousFen, depth: 10, movetime: 1500, multipv: 1 },
        ]
      ),
    ]);

    const currentResult = currentSettled.status === 'fulfilled' ? currentSettled.value : null;
    const previousResult = previousSettled.status === 'fulfilled' ? previousSettled.value : null;

    const turnToken = String(currentFen).trim().split(/\s+/)[1];
    const currentTurn = turnToken === 'b' ? 'b' : 'w';
    const whiteWin = scoreToWhiteWinProbability(currentResult?.score, currentTurn);

    const currentFallbackScore = { type: 'cp', value: 0 };
    const baseLines = Array.isArray(previousResult?.lines) ? previousResult.lines : [];
    const firstMoveScoreMap = await computeFirstMoveScores({
      previousFen,
      lines: baseLines,
    });
    const responseLines = baseLines.map((line) => {
      const firstMove = String(line?.pv || '').trim().split(/\s+/)[0] || null;
      return {
        ...line,
        firstMoveScore: firstMove ? (firstMoveScoreMap[firstMove] || null) : null,
      };
    });
    const fallbackBestMoveFromLines = responseLines?.[0]?.pv ? responseLines[0].pv.split(' ')[0] : null;

    const warnings = [];
    if (currentSettled.status !== 'fulfilled') {
      warnings.push(`current analysis fallback failed: ${currentSettled.reason?.message || String(currentSettled.reason)}`);
    }
    if (previousSettled.status !== 'fulfilled') {
      warnings.push(`bestlines analysis fallback failed: ${previousSettled.reason?.message || String(previousSettled.reason)}`);
    }

    const response = {
      bestmove: currentResult?.bestmove || fallbackBestMoveFromLines || null,
      ponder: currentResult?.ponder || null,
      score: currentResult?.score || currentFallbackScore,
      depth: currentResult?.depth || 0,
      winProbability: {
        white: whiteWin,
        black: 100 - whiteWin,
      },
      lines: responseLines,
      previousFenBestmove:
        previousResult?.bestmove ||
        fallbackBestMoveFromLines,
      warning: warnings.length > 0 ? warnings : undefined,
    };

    // Store in cache before returning
    analysisCache.set(cacheKey, response);
    // Limit cache size to 100 entries
    if (analysisCache.size > 100) {
      const firstKey = analysisCache.keys().next().value;
      analysisCache.delete(firstKey);
    }

    console.log('[ANALYZE][OK]', response);
    res.json(response);
  } catch (e) {
    console.error('[ANALYZE][ERR]', e.message);
    res.status(500).json({ error: e.message });
  }
});

mountAnalysisHistoryRoutes(app);
mountLichessPgnsRoutes(app);

// --- PERSISTENT PIPELINE PROCESS ---
let pipelineProcess = null;
let pipelineRequests = [];

function startPipeline(pythonCmd = workingPython) {
  const scriptPath = path.join(__dirname, 'chess_pipeline.py');
  pipelineProcess = spawn(pythonCmd, [scriptPath]);
  
  pipelineProcess.on('error', (err) => {
    console.error('[PIPELINE] Spawn error:', err.message);
    if (pythonCmd === 'python') startPipeline('py');
    else if (pythonCmd === 'py') startPipeline('python3');
  });

  pipelineProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const result = JSON.parse(line);
        if (pipelineRequests.length > 0) {
          const { resolve } = pipelineRequests.shift();
          resolve(result);
        }
      } catch (e) {
        console.error('[PIPELINE] JSON parse error:', line);
      }
    }
  });

  pipelineProcess.on('close', (code) => {
    console.warn('[PIPELINE] Process closed with code', code);
    setTimeout(startPipeline, 5000);
  });
}

startPipeline();

app.post('/ai/pipeline', async (req, res) => {
  const { fen } = req.body || {};
  if (!fen) {
    return res.status(400).json({ error: 'fen is required' });
  }

  try {
    const result = await new Promise((resolve, reject) => {
      pipelineRequests.push({ resolve, reject });
      pipelineProcess.stdin.write(JSON.stringify({ fen }) + '\n');
      
      setTimeout(() => {
        const idx = pipelineRequests.findIndex(r => r.resolve === resolve);
        if (idx !== -1) {
          pipelineRequests.splice(idx, 1);
          reject(new Error('Pipeline Timeout'));
        }
      }, 30000);
    });
    res.json(result);
  } catch (e) {
    console.error('[PIPELINE][ERR]', e.message);
    res.status(500).json({ error: 'Pipeline failed', detail: e.message });
  }
});

app.post('/api/book/check', async (req, res) => {
  const { moves } = req.body || {};
  if (!Array.isArray(moves)) {
    return res.status(400).json({ error: 'moves array is required' });
  }

  const scriptPath = path.join(__dirname, 'book_move_check.py');
  const movesJson = JSON.stringify(moves);

  const run = (cmd, cmdArgs) => new Promise((resolve, reject) => {
    execFile(cmd, cmdArgs, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[BOOK]', 'exec error', error.message, stderr);
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(String(stdout || '').trim() || '{}'));
      } catch (e) {
        console.error('[BOOK]', 'invalid json', stdout);
        reject(new Error('Invalid JSON from book checker'));
      }
    });
  });

  try {
    let result;
    try {
      result = await run(workingPython, [scriptPath, movesJson]);
    } catch {
      const fallback = workingPython === 'python' ? 'py' : 'python';
      const fallbackArgs = workingPython === 'python' ? ['-3', scriptPath, movesJson] : [scriptPath, movesJson];
      result = await run(fallback, fallbackArgs);
    }
    res.json(result);
  } catch (e) {
    console.error('[BOOK][ERR]', e.message);
    res.status(500).json({ error: 'Book checker failed', detail: e.message });
  }
});

app.get('/api/db/health', (req, res) => {
  try {
    const row = db.prepare('SELECT COUNT(*) AS sessions FROM analysis_sessions').get();
    res.json({ ok: true, dbPath, sessions: row.sessions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});

if (process.env.RUN_SELFTEST === '1') {
  runEngineDirect({ fen: 'startpos', depth: 8 })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => console.error(e.message));
}
