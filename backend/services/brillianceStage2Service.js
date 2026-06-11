const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db/database');
const { runInTransaction } = require('../db/tx');
const { getGame } = require('./lichessPgnService');
const { getStage1Status, runStage1ForGame } = require('./brillianceStage1Service');
const { clearStageTablesFrom, markStageEmptyComplete } = require('./brilliancePipelineUtils');

const scriptPath = path.join(__dirname, '..', 'brilliance_stage2.py');
const stockfishPath = path.join(__dirname, '..', '..', 'stockfish', 'stockfish-windows-x86-64-avx2.exe');
const runningGames = new Set();

function getMoveRows(gameId) {
  return db
    .prepare(
      `SELECT id, ply_index, san_move, turn
       FROM lichess_pgn_moves
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);
}

function getStage2Status(gameId) {
  const game = db
    .prepare(
      `SELECT id, stage2_status, stage2_run_at, stage2_analyzed_count,
              stage2_proceed_stage3_count, stage2_error
       FROM lichess_pgn_games WHERE id = ?`
    )
    .get(gameId);
  if (!game) return null;

  const rowCount = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_stage2 WHERE game_id = ?')
    .get(gameId);

  return {
    game_id: gameId,
    status: game.stage2_status,
    run_at: game.stage2_run_at,
    analyzed_count: game.stage2_analyzed_count,
    proceed_to_stage3_count: game.stage2_proceed_stage3_count,
    error: game.stage2_error,
    features_saved: rowCount?.c ?? 0,
    engine_used: true,
    stockfish_path: stockfishPath,
    running: runningGames.has(gameId),
  };
}

function parseStage2Row(row) {
  let features = null;
  if (row.features_json) {
    try {
      features = JSON.parse(row.features_json);
    } catch {
      features = null;
    }
  }
  return {
    id: row.id,
    game_id: row.game_id,
    move_id: row.move_id,
    ply_index: row.ply_index,
    san_move: row.san_move,
    turn: row.turn,
    sac_type: row.sac_type,
    best_move: row.best_move,
    best_score_cp: row.best_score_cp,
    our_score_cp: row.our_score_cp,
    our_rank_in_top5: row.our_rank_in_top5,
    cpl_shallow: row.cpl_shallow,
    ep_delta_shallow: row.ep_delta_shallow,
    is_forced_engine: Boolean(row.is_forced_engine),
    n_reasonable_moves: row.n_reasonable_moves,
    response_width: row.response_width,
    is_best_or_near_best: Boolean(row.is_best_or_near_best),
    proceed_to_stage3: Boolean(row.proceed_to_stage3),
    gate_fail_reason: row.gate_fail_reason,
    classification_if_fail: row.classification_if_fail,
    engine_depth: row.engine_depth,
    candidate_path: features?.candidate_path ?? null,
    features,
  };
}

function getStage2Features(gameId) {
  const rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage2
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const moves = rows.map(parseStage2Row);
  const proceed = moves.filter((m) => m.proceed_to_stage3).length;

  return {
    ...getStage2Status(gameId),
    disqualified_count: moves.length - proceed,
    forced_engine_count: moves.filter((m) => m.gate_fail_reason === 'forced_engine').length,
    unsound_count: moves.filter((m) =>
      ['cpl_too_high', 'ep_delta_too_negative'].includes(m.gate_fail_reason)
    ).length,
    moves,
  };
}

function runPythonStage2(pgn) {
  const inputJson = JSON.stringify({ pgn, engine_path: stockfishPath });

  const run = (cmd, cmdArgs) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        cmdArgs,
        { timeout: 600000, maxBuffer: 50 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          try {
            resolve(JSON.parse(String(stdout || '').trim() || '{}'));
          } catch {
            reject(new Error('Invalid JSON from stage2 analyzer'));
          }
        }
      );
    });

  return run('python', [scriptPath, inputJson]).catch(() =>
    run('py', ['-3', scriptPath, inputJson]).catch(() => run('python3', [scriptPath, inputJson]))
  );
}

function saveStage2Results(gameId, analysis) {
  const moveRows = getMoveRows(gameId);
  const byPly = new Map(moveRows.map((m) => [m.ply_index, m]));

  const deleteOld = db.prepare('DELETE FROM lichess_pgn_stage2 WHERE game_id = ?');
  const insert = db.prepare(
    `INSERT INTO lichess_pgn_stage2 (
      game_id, move_id, ply_index, san_move, turn, sac_type,
      best_move, best_score_cp, our_score_cp, our_rank_in_top5,
      cpl_shallow, ep_delta_shallow, is_forced_engine, n_reasonable_moves,
      response_width, is_best_or_near_best, proceed_to_stage3,
      gate_fail_reason, classification_if_fail, engine_depth, features_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  runInTransaction(db, () => {
    deleteOld.run(gameId);
    for (const m of analysis.moves || []) {
      const dbMove = byPly.get(m.ply_index);
      if (!dbMove) continue;

      const eng = m.engine || {};
      const s1 = m.stage1 || {};

      insert.run(
        gameId,
        dbMove.id,
        m.ply_index,
        m.san_move ?? dbMove.san_move,
        m.turn ?? dbMove.turn,
        s1.sac_type ?? null,
        eng.best_move ?? null,
        eng.best_score_cp ?? null,
        eng.our_score_cp ?? null,
        eng.our_rank_in_top5 ?? null,
        eng.cpl_shallow ?? null,
        eng.ep_delta_shallow ?? null,
        eng.is_forced_engine ? 1 : 0,
        eng.n_reasonable_moves ?? null,
        eng.response_width ?? null,
        eng.is_best_or_near_best ? 1 : 0,
        m.proceed_to_stage3 ? 1 : 0,
        m.gate_fail_reason ?? null,
        m.classification_if_fail ?? null,
        eng.engine_depth ?? 12,
        JSON.stringify(m)
      );
    }

    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage2_status = 'completed',
           stage2_run_at = datetime('now'),
           stage2_analyzed_count = ?,
           stage2_proceed_stage3_count = ?,
           stage2_error = NULL
       WHERE id = ?`
    ).run(
      analysis.analyzed_count ?? 0,
      analysis.proceed_to_stage3_count ?? 0,
      gameId
    );
  });
}

async function runStage2ForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  const game = getGame(id);
  if (!game) throw new Error('Game not found');

  if (runningGames.has(id)) {
    return getStage2Features(id);
  }

  const stage1 = getStage1Status(id);
  if (stage1?.status !== 'completed' || stage1.features_saved === 0) {
    await runStage1ForGame(id);
  }

  if (!force) {
    const existing = getStage2Status(id);
    if (existing?.status === 'completed') {
      return getStage2Features(id);
    }
  }

  runningGames.add(id);
  db.prepare(
    `UPDATE lichess_pgn_games SET stage2_status = 'running', stage2_error = NULL WHERE id = ?`
  ).run(id);

  try {
    const analysis = await runPythonStage2(game.clean_pgn);
    if (analysis.error) throw new Error(analysis.error);

    saveStage2Results(id, analysis);

    const proceedCount = analysis.proceed_to_stage3_count ?? 0;
    if (proceedCount === 0) {
      clearStageTablesFrom(id, 3);
      markStageEmptyComplete(id, 3);
      markStageEmptyComplete(id, 4);
    }

    return getStage2Features(id);
  } catch (e) {
    db.prepare(
      `UPDATE lichess_pgn_games SET stage2_status = 'failed', stage2_error = ? WHERE id = ?`
    ).run(e?.message || String(e), id);
    throw e;
  } finally {
    runningGames.delete(id);
  }
}

module.exports = {
  getStage2Status,
  getStage2Features,
  runStage2ForGame,
};
