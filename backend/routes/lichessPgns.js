const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
  uploadsDir,
  ensureUploadsDir,
  createUpload,
  getUpload,
  updateUpload,
  countGamesInFile,
  processUploadRange,
  getStats,
  listUploads,
  getGame,
  getGameNeighbors,
  deleteUpload,
  listGames,
  listAllGames,
  importCustomPgn,
} = require('../services/lichessPgnService');
const {
  getStage0Status,
  getStage0Features,
  runStage0ForGame,
} = require('../services/brillianceStage0Service');
const {
  getStage1Status,
  getStage1Features,
  runStage1ForGame,
} = require('../services/brillianceStage1Service');
const {
  getStage2Status,
  getStage2Features,
  runStage2ForGame,
} = require('../services/brillianceStage2Service');
const {
  getStage3Status,
  getStage3Features,
  runStage3ForGame,
} = require('../services/brillianceStage3Service');
const {
  getStage4Status,
  getStage4Features,
  runStage4ForGame,
} = require('../services/brillianceStage4Service');
const {
  getBrillianceAnalytics,
  listBrilliantMoves,
  getBulkJobStatus,
  startBulkBrillianceRun,
  cancelBulkRun,
} = require('../services/brillianceBulkService');
const { runFullBrillianceForGame } = require('../services/brilliancePipelineService');

ensureUploadsDir();

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}_${String(file.originalname || 'upload.pgn').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.pgn') || file.mimetype === 'text/plain' || file.mimetype === 'application/x-chess-pgn') {
      cb(null, true);
      return;
    }
    cb(new Error('Only .pgn files are allowed'));
  },
});

const runningUploads = new Set();

function parseRange(body) {
  const rangeFrom = Math.max(1, parseInt(body?.range_from ?? body?.rangeFrom ?? '1', 10) || 1);
  const rangeTo = Math.max(
    rangeFrom,
    parseInt(body?.range_to ?? body?.rangeTo ?? String(rangeFrom), 10) || rangeFrom
  );
  return { rangeFrom, rangeTo };
}

function mountLichessPgnsRoutes(app) {
  app.get('/api/lichess-pgns/stats', (_req, res) => {
    res.json(getStats());
  });

  app.get('/api/lichess-pgns/brilliance/analytics', (req, res) => {
    const uploadIdRaw = req.query.upload_id ?? req.query.uploadId;
    const uploadId =
      uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all'
        ? parseInt(uploadIdRaw, 10)
        : null;
    if (uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all' && !Number.isFinite(uploadId)) {
      res.status(400).json({ error: 'Invalid upload_id' });
      return;
    }
    res.json(getBrillianceAnalytics({ uploadId }));
  });

  app.get('/api/lichess-pgns/brilliance/bulk-status', (_req, res) => {
    res.json({
      job: getBulkJobStatus(),
      analytics: getBrillianceAnalytics({}),
    });
  });

  app.post('/api/lichess-pgns/brilliance/bulk-run', (req, res) => {
    const uploadIdRaw = req.body?.upload_id ?? req.query.upload_id;
    const uploadId =
      uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all'
        ? parseInt(uploadIdRaw, 10)
        : null;
    if (uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all' && !Number.isFinite(uploadId)) {
      res.status(400).json({ error: 'Invalid upload_id' });
      return;
    }
    const force = req.body?.force === true || req.query.force === '1';
    const result = startBulkBrillianceRun({ uploadId, force });
    if (!result.started && result.error) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  });

  app.post('/api/lichess-pgns/brilliance/bulk-cancel', (_req, res) => {
    res.json(cancelBulkRun());
  });

  app.get('/api/lichess-pgns/brilliance/moves', (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const uploadIdRaw = req.query.upload_id ?? req.query.uploadId;
    const uploadId =
      uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all'
        ? parseInt(uploadIdRaw, 10)
        : null;
    if (uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all' && !Number.isFinite(uploadId)) {
      res.status(400).json({ error: 'Invalid upload_id' });
      return;
    }
    const minScore = req.query.min_score != null ? parseFloat(req.query.min_score) : null;
    res.json(listBrilliantMoves({ uploadId, limit, offset, minScore }));
  });

  app.get('/api/lichess-pgns/uploads', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    res.json({ uploads: listUploads(limit) });
  });

  app.get('/api/lichess-pgns/uploads/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid upload id' });
      return;
    }
    const row = getUpload(id);
    if (!row) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    res.json(row);
  });

  app.get('/api/lichess-pgns/games', (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const uploadIdRaw = req.query.upload_id ?? req.query.uploadId;
    const uploadId =
      uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all'
        ? parseInt(uploadIdRaw, 10)
        : null;
    if (uploadIdRaw != null && uploadIdRaw !== '' && uploadIdRaw !== 'all' && !Number.isFinite(uploadId)) {
      res.status(400).json({ error: 'Invalid upload_id' });
      return;
    }
    res.json(listAllGames({ uploadId, limit, offset }));
  });

  app.post('/api/lichess-pgns/custom/import', (req, res) => {
    const pgnText = req.body?.pgn_text ?? req.body?.pgnText ?? req.body?.pgn;
    const filename = req.body?.filename ?? req.body?.original_filename ?? 'custom_game.pgn';
    if (!pgnText || typeof pgnText !== 'string') {
      res.status(400).json({ error: 'pgn_text is required' });
      return;
    }
    try {
      const game = importCustomPgn(pgnText, { originalFilename: String(filename) });
      res.status(201).json(game);
    } catch (e) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/games/:gameId', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(game);
  });

  app.get('/api/lichess-pgns/games/:gameId/neighbors', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const neighbors = getGameNeighbors(gameId);
    if (!neighbors) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(neighbors);
  });

  app.get('/api/lichess-pgns/games/:gameId/stage0', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(getStage0Features(gameId));
  });

  app.get('/api/lichess-pgns/games/:gameId/stage0/status', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const status = getStage0Status(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/lichess-pgns/games/:gameId/stage0/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runStage0ForGame(gameId, { force });
      res.json({ ...result, engine_used: false });
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/games/:gameId/stage1', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(getStage1Features(gameId));
  });

  app.get('/api/lichess-pgns/games/:gameId/stage1/status', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const status = getStage1Status(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/lichess-pgns/games/:gameId/stage1/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runStage1ForGame(gameId, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/games/:gameId/stage2', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(getStage2Features(gameId));
  });

  app.get('/api/lichess-pgns/games/:gameId/stage2/status', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const status = getStage2Status(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/lichess-pgns/games/:gameId/stage2/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runStage2ForGame(gameId, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/games/:gameId/stage3', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(getStage3Features(gameId));
  });

  app.get('/api/lichess-pgns/games/:gameId/stage3/status', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const status = getStage3Status(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/lichess-pgns/games/:gameId/stage3/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runStage3ForGame(gameId, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/games/:gameId/stage4', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(getStage4Features(gameId));
  });

  app.get('/api/lichess-pgns/games/:gameId/stage4/status', (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const status = getStage4Status(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json(status);
  });

  app.post('/api/lichess-pgns/games/:gameId/stage4/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runStage4ForGame(gameId, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post('/api/lichess-pgns/games/:gameId/brilliance/run', async (req, res) => {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: 'Invalid game id' });
      return;
    }
    const game = getGame(gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    const force = req.body?.force === true || req.query.force === '1';

    try {
      const result = await runFullBrillianceForGame(gameId, { force });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.get('/api/lichess-pgns/uploads/:id/games', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid upload id' });
      return;
    }
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    res.json(listGames({ uploadId: id, limit, offset }));
  });

  app.post('/api/lichess-pgns/upload', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Upload failed' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'PGN file is required (field name: file)' });
        return;
      }

      try {
        const record = createUpload({
          originalFilename: req.file.originalname,
          storedFilename: req.file.filename,
          filePath: path.resolve(req.file.path),
          fileSizeBytes: req.file.size,
        });

        let gamesInFile = null;
        try {
          gamesInFile = await countGamesInFile(record.file_path);
          updateUpload(record.id, { games_in_file: gamesInFile });
        } catch (e) {
          console.warn('[lichess-pgns] count games failed:', e?.message);
        }

        res.status(201).json({
          ...getUpload(record.id),
          games_in_file: gamesInFile,
        });
      } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
      }
    });
  });

  app.delete('/api/lichess-pgns/uploads/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid upload id' });
      return;
    }
    if (runningUploads.has(id)) {
      res.status(409).json({ error: 'Cannot delete while import is running' });
      return;
    }
    const row = getUpload(id);
    if (!row) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    if (row.status === 'processing') {
      res.status(409).json({ error: 'Cannot delete while import is processing' });
      return;
    }

    try {
      const result = deleteUpload(id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  app.post('/api/lichess-pgns/uploads/:id/process', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid upload id' });
      return;
    }
    const row = getUpload(id);
    if (!row) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    if (runningUploads.has(id)) {
      res.status(409).json({ error: 'Import already running for this upload' });
      return;
    }

    const { rangeFrom, rangeTo } = parseRange(req.body || {});
    if (row.games_in_file != null && rangeTo > row.games_in_file) {
      res.status(400).json({
        error: `range_to exceeds games in file (${row.games_in_file})`,
      });
      return;
    }

    runningUploads.add(id);
    res.json({ started: true, upload_id: id, range_from: rangeFrom, range_to: rangeTo });

    setImmediate(async () => {
      try {
        await processUploadRange(id, rangeFrom, rangeTo);
      } catch (e) {
        console.error('[lichess-pgns][process]', id, e);
      } finally {
        runningUploads.delete(id);
      }
    });
  });
}

module.exports = { mountLichessPgnsRoutes };
