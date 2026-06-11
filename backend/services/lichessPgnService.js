const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { streamPgnGames } = require('../db/pgnSplitter');
const { parsePgnGame } = require('../db/pgnParser');

const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

function getUpload(id) {
  return db.prepare('SELECT * FROM lichess_pgn_uploads WHERE id = ?').get(id);
}

function updateUpload(id, fields) {
  const allowed = [
    'status',
    'range_from',
    'range_to',
    'games_in_file',
    'games_processed',
    'games_saved',
    'games_failed',
    'moves_saved',
    'error_message',
  ];
  const sets = ['updated_at = datetime(\'now\')'];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE lichess_pgn_uploads SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function createUpload({ originalFilename, storedFilename, filePath, fileSizeBytes }) {
  ensureUploadsDir();
  const info = db
    .prepare(
      `INSERT INTO lichess_pgn_uploads (original_filename, stored_filename, file_path, file_size_bytes, status)
       VALUES (?, ?, ?, ?, 'uploaded')`
    )
    .run(originalFilename, storedFilename, filePath, fileSizeBytes ?? null);
  return getUpload(Number(info.lastInsertRowid));
}

async function countGamesInFile(filePath) {
  let count = 0;
  for await (const _ of streamPgnGames(filePath)) {
    count += 1;
  }
  return count;
}

const insertGame = db.prepare(
  `INSERT INTO lichess_pgn_games (upload_id, game_index, lichess_game_id, pgn_metadata, clean_pgn, move_count, status)
   VALUES (?, ?, ?, ?, ?, ?, 'cleaned')`
);

const insertMove = db.prepare(
  `INSERT INTO lichess_pgn_moves (game_id, ply_index, move_number, turn, san_move, uci_move, fen_before_move, fen_after_move)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

function saveCleanGame(uploadId, gameIndex, parsed) {
  const info = insertGame.run(
    uploadId,
    gameIndex,
    parsed.lichessGameId,
    JSON.stringify(parsed.headers),
    parsed.cleanPgn,
    parsed.moves.length
  );
  const gameId = Number(info.lastInsertRowid);
  for (const m of parsed.moves) {
    insertMove.run(
      gameId,
      m.ply_index,
      m.move_number,
      m.turn,
      m.san_move,
      m.uci_move,
      m.fen_before_move,
      m.fen_after_move
    );
  }
  return { gameId, moveCount: parsed.moves.length };
}

async function processUploadRange(uploadId, rangeFrom, rangeTo, onProgress) {
  const upload = getUpload(uploadId);
  if (!upload) throw new Error('Upload not found');
  if (!fs.existsSync(upload.file_path)) throw new Error('PGN file missing on disk');

  const from = Math.max(1, parseInt(rangeFrom, 10) || 1);
  const to = Math.max(from, parseInt(rangeTo, 10) || from);
  const skip = from - 1;
  const limit = to - from + 1;

  updateUpload(uploadId, {
    status: 'processing',
    range_from: from,
    range_to: to,
    games_processed: 0,
    games_saved: 0,
    games_failed: 0,
    moves_saved: 0,
    error_message: null,
  });

  let processed = 0;
  let saved = 0;
  let failed = 0;
  let movesSaved = 0;

  try {
    for await (const { gameIndex, rawPgn } of streamPgnGames(upload.file_path, { skip, limit })) {
      processed += 1;
      try {
        const parsed = parsePgnGame(rawPgn);
        const { moveCount } = saveCleanGame(uploadId, gameIndex, parsed);
        saved += 1;
        movesSaved += moveCount;
      } catch (e) {
        failed += 1;
        db.prepare(
          `INSERT INTO lichess_pgn_games (upload_id, game_index, clean_pgn, move_count, status, error_message)
           VALUES (?, ?, ?, 0, 'failed', ?)`
        ).run(uploadId, gameIndex, rawPgn.slice(0, 50000), e?.message || String(e));
      }

      if (processed % 10 === 0 || processed === limit) {
        updateUpload(uploadId, {
          games_processed: processed,
          games_saved: saved,
          games_failed: failed,
          moves_saved: movesSaved,
        });
        if (typeof onProgress === 'function') {
          onProgress({ processed, saved, failed, movesSaved, gameIndex });
        }
      }
    }

    updateUpload(uploadId, {
      status: 'completed',
      games_processed: processed,
      games_saved: saved,
      games_failed: failed,
      moves_saved: movesSaved,
    });

    return { processed, saved, failed, movesSaved };
  } catch (e) {
    updateUpload(uploadId, {
      status: 'failed',
      error_message: e?.message || String(e),
      games_processed: processed,
      games_saved: saved,
      games_failed: failed,
      moves_saved: movesSaved,
    });
    throw e;
  }
}

function getStats() {
  const uploads = db
    .prepare(
      `SELECT
         COUNT(*) AS uploads_total,
         COALESCE(SUM(games_saved), 0) AS games_saved,
         COALESCE(SUM(moves_saved), 0) AS moves_saved
       FROM lichess_pgn_uploads`
    )
    .get();

  const games = db.prepare('SELECT COUNT(*) AS c FROM lichess_pgn_games WHERE status = \'cleaned\'').get();
  const moves = db.prepare('SELECT COUNT(*) AS c FROM lichess_pgn_moves').get();

  return {
    uploads_total: uploads?.uploads_total ?? 0,
    games_saved: games?.c ?? 0,
    moves_saved: moves?.c ?? 0,
    upload_games_saved: uploads?.games_saved ?? 0,
    upload_moves_saved: uploads?.moves_saved ?? 0,
  };
}

function deleteUpload(uploadId) {
  const id = parseInt(uploadId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid upload id');

  const row = getUpload(id);
  if (!row) return null;

  const gameCountRow = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_games WHERE upload_id = ?')
    .get(id);

  db.prepare('DELETE FROM lichess_pgn_uploads WHERE id = ?').run(id);

  if (row.file_path) {
    try {
      if (fs.existsSync(row.file_path)) {
        fs.unlinkSync(row.file_path);
      }
    } catch (e) {
      console.warn('[lichess-pgns] delete file failed:', e?.message || String(e));
    }
  }

  return {
    deleted: true,
    upload_id: id,
    games_removed: gameCountRow?.c ?? 0,
    filename: row.original_filename,
  };
}

function listUploads(limit = 20) {
  return db
    .prepare(
      `SELECT id, original_filename, status, range_from, range_to, games_in_file,
              games_processed, games_saved, games_failed, moves_saved, error_message,
              created_at, updated_at
       FROM lichess_pgn_uploads
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit);
}

function getGame(gameId) {
  const row = db
    .prepare(
      `SELECT g.*, u.original_filename
       FROM lichess_pgn_games g
       JOIN lichess_pgn_uploads u ON u.id = g.upload_id
       WHERE g.id = ? AND g.status = 'cleaned'`
    )
    .get(gameId);
  if (!row) return null;
  let pgn_metadata = null;
  if (row.pgn_metadata) {
    try {
      pgn_metadata = JSON.parse(row.pgn_metadata);
    } catch {
      pgn_metadata = null;
    }
  }
  return { ...row, pgn_metadata };
}

function listGames({ uploadId, limit = 50, offset = 0 }) {
  const rows = db
    .prepare(
      `SELECT id, upload_id, game_index, lichess_game_id, move_count, status, created_at
       FROM lichess_pgn_games
       WHERE upload_id = ? AND status = 'cleaned'
       ORDER BY game_index ASC
       LIMIT ? OFFSET ?`
    )
    .all(uploadId, limit, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM lichess_pgn_games WHERE upload_id = ? AND status = 'cleaned'`)
    .get(uploadId);
  return { games: rows, total: total?.c ?? 0 };
}

function getGameNeighbors(gameId) {
  const game = getGame(gameId);
  if (!game) return null;

  const prevInUpload = db
    .prepare(
      `SELECT id FROM lichess_pgn_games
       WHERE upload_id = ? AND game_index = ? AND status = 'cleaned'`
    )
    .get(game.upload_id, game.game_index - 1);

  let prevId = prevInUpload?.id ?? null;
  if (!prevId) {
    const prevUpload = db
      .prepare(
        `SELECT g.id
         FROM lichess_pgn_games g
         WHERE g.status = 'cleaned'
           AND g.upload_id = (
             SELECT MAX(upload_id) FROM lichess_pgn_games
             WHERE status = 'cleaned' AND upload_id > ?
           )
         ORDER BY g.game_index DESC
         LIMIT 1`
      )
      .get(game.upload_id);
    prevId = prevUpload?.id ?? null;
  }

  const nextInUpload = db
    .prepare(
      `SELECT id FROM lichess_pgn_games
       WHERE upload_id = ? AND game_index = ? AND status = 'cleaned'`
    )
    .get(game.upload_id, game.game_index + 1);

  let nextId = nextInUpload?.id ?? null;
  if (!nextId) {
    const nextUpload = db
      .prepare(
        `SELECT g.id
         FROM lichess_pgn_games g
         WHERE g.status = 'cleaned'
           AND g.upload_id = (
             SELECT MAX(upload_id) FROM lichess_pgn_games
             WHERE status = 'cleaned' AND upload_id < ?
           )
         ORDER BY g.game_index ASC
         LIMIT 1`
      )
      .get(game.upload_id);
    nextId = nextUpload?.id ?? null;
  }

  const positionRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM lichess_pgn_games g
       WHERE g.status = 'cleaned'
         AND (g.upload_id > ? OR (g.upload_id = ? AND g.game_index < ?))`
    )
    .get(game.upload_id, game.upload_id, game.game_index);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM lichess_pgn_games WHERE status = 'cleaned'`)
    .get();

  return {
    game_id: gameId,
    prev_id: prevId,
    next_id: nextId,
    position: (positionRow?.c ?? 0) + 1,
    total: totalRow?.c ?? 0,
    upload_id: game.upload_id,
    game_index: game.game_index,
    original_filename: game.original_filename,
  };
}

function importCustomPgn(pgnText, { originalFilename = 'custom_game.pgn' } = {}) {
  const text = String(pgnText || '').trim();
  if (!text) throw new Error('Empty PGN');

  ensureUploadsDir();
  const parsed = parsePgnGame(text);
  const timestamp = Date.now();
  const storedFilename = `${timestamp}_custom.pgn`;
  const filePath = path.join(uploadsDir, storedFilename);
  fs.writeFileSync(filePath, text, 'utf8');

  const upload = createUpload({
    originalFilename,
    storedFilename,
    filePath,
    fileSizeBytes: Buffer.byteLength(text, 'utf8'),
  });

  updateUpload(upload.id, {
    status: 'completed',
    range_from: 1,
    range_to: 1,
    games_in_file: 1,
    games_processed: 1,
    games_saved: 1,
    games_failed: 0,
    moves_saved: parsed.moves.length,
  });

  const { gameId } = saveCleanGame(upload.id, 0, parsed);
  return getGame(gameId);
}

function listAllGames({ uploadId = null, limit = 50, offset = 0 }) {
  const params = [];
  let where = `g.status = 'cleaned'`;
  if (uploadId != null && Number.isFinite(uploadId)) {
    where += ` AND g.upload_id = ?`;
    params.push(uploadId);
  }

  const rows = db
    .prepare(
      `SELECT g.id, g.upload_id, g.game_index, g.lichess_game_id, g.move_count, g.status, g.created_at,
              g.stage0_status, g.stage1_status, g.stage2_status, g.stage3_status, g.stage4_status,
              g.stage4_brilliant_count,
              u.original_filename
       FROM lichess_pgn_games g
       JOIN lichess_pgn_uploads u ON u.id = g.upload_id
       WHERE ${where}
       ORDER BY g.upload_id DESC, g.game_index ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM lichess_pgn_games g
       WHERE ${where}`
    )
    .get(...params);

  return { games: rows, total: totalRow?.c ?? 0 };
}

module.exports = {
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
};
