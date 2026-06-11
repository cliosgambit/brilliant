const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db/database');
const { runInTransaction } = require('../db/tx');
const { getGame } = require('./lichessPgnService');
const { getStage2Status, runStage2ForGame } = require('./brillianceStage2Service');
const { clearStageTablesFrom, markStageEmptyComplete } = require('./brilliancePipelineUtils');

const scriptPath = path.join(__dirname, '..', 'brilliance_stage3.py');
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

function getStage3PasserPlies(gameId) {
  return db
    .prepare(
      `SELECT s2.ply_index
       FROM lichess_pgn_stage2 s2
       INNER JOIN lichess_pgn_stage1 s1
         ON s1.game_id = s2.game_id AND s1.ply_index = s2.ply_index
       WHERE s2.game_id = ?
         AND s1.proceed_to_stage2 = 1
         AND s2.proceed_to_stage3 = 1
       ORDER BY s2.ply_index ASC`
    )
    .all(gameId)
    .map((r) => r.ply_index);
}

function getStage3Status(gameId) {
  const game = db
    .prepare(
      `SELECT id, stage3_status, stage3_run_at, stage3_analyzed_count,
              stage3_sound_count, stage3_error
       FROM lichess_pgn_games WHERE id = ?`
    )
    .get(gameId);
  if (!game) return null;

  const rowCount = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_stage3 WHERE game_id = ?')
    .get(gameId);

  return {
    game_id: gameId,
    status: game.stage3_status,
    run_at: game.stage3_run_at,
    analyzed_count: game.stage3_analyzed_count,
    sound_count: game.stage3_sound_count,
    error: game.stage3_error,
    features_saved: rowCount?.c ?? 0,
    engine_used: true,
    eval_perspective: 'white',
    stockfish_path: stockfishPath,
    running: runningGames.has(gameId),
  };
}

function parseStage3Row(row) {
  let features = null;
  let depthEvals = null;
  if (row.features_json) {
    try {
      features = JSON.parse(row.features_json);
    } catch {
      features = null;
    }
  }
  if (row.depth_evals_json) {
    try {
      depthEvals = JSON.parse(row.depth_evals_json);
    } catch {
      depthEvals = null;
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
    deep_eval_cp: row.deep_eval_cp,
    depth_slope: row.depth_slope,
    depth_gain: row.depth_gain,
    depth_variance: row.depth_variance,
    early_eval_avg: row.early_eval_avg,
    late_eval_avg: row.late_eval_avg,
    is_rising_curve: Boolean(row.is_rising_curve),
    is_sound: Boolean(row.is_sound),
    is_non_obvious: Boolean(row.is_non_obvious),
    rank_at_depth8: row.rank_at_depth8,
    rank_at_depth22: row.rank_at_depth22,
    rank_jump: row.rank_jump,
    good_defenses: row.good_defenses,
    defense_difficulty: row.defense_difficulty,
    counterfactual_delta: row.counterfactual_delta,
    non_obvious_score: row.non_obvious_score,
    classification_if_unsound: row.classification_if_unsound,
    gate_fail_reason: features?.gate_fail_reason ?? null,
    proceed_to_stage4: Boolean(row.proceed_to_stage4),
    engine_depth: row.engine_depth,
    depth_evals: depthEvals,
    eval_perspective: row.eval_perspective || 'white',
    features,
  };
}

function getStage3Features(gameId) {
  const rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage3
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const moves = rows.map(parseStage3Row);
  const sound = moves.filter((m) => m.is_sound).length;

  return {
    ...getStage3Status(gameId),
    unsound_count: moves.length - sound,
    rising_curve_count: moves.filter((m) => m.is_rising_curve).length,
    non_obvious_count: moves.filter((m) => m.is_non_obvious).length,
    moves,
  };
}

function runPythonStage3(pgn, plyIndices) {
  const inputJson = JSON.stringify({
    pgn,
    engine_path: stockfishPath,
    ply_indices: plyIndices,
  });

  const run = (cmd, cmdArgs) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        cmdArgs,
        { timeout: 900000, maxBuffer: 50 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          try {
            resolve(JSON.parse(String(stdout || '').trim() || '{}'));
          } catch {
            reject(new Error('Invalid JSON from stage3 analyzer'));
          }
        }
      );
    });

  return run('python', [scriptPath, inputJson]).catch(() =>
    run('py', ['-3', scriptPath, inputJson]).catch(() => run('python3', [scriptPath, inputJson]))
  );
}

function saveStage3Results(gameId, analysis) {
  const moveRows = getMoveRows(gameId);
  const byPly = new Map(moveRows.map((m) => [m.ply_index, m]));

  const stage2Rows = db
    .prepare(`SELECT ply_index, sac_type FROM lichess_pgn_stage2 WHERE game_id = ?`)
    .all(gameId);
  const sacByPly = new Map(stage2Rows.map((r) => [r.ply_index, r.sac_type]));

  const deleteOld = db.prepare('DELETE FROM lichess_pgn_stage3 WHERE game_id = ?');
  const insert = db.prepare(
    `INSERT INTO lichess_pgn_stage3 (
      game_id, move_id, ply_index, san_move, turn, sac_type,
      deep_eval_cp, depth_slope, depth_gain, depth_variance,
      early_eval_avg, late_eval_avg, is_rising_curve, is_sound, is_non_obvious,
      rank_at_depth8, rank_at_depth22, rank_jump, good_defenses, defense_difficulty,
      counterfactual_delta, non_obvious_score, classification_if_unsound,
      proceed_to_stage4, engine_depth, depth_evals_json, eval_perspective, features_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  runInTransaction(db, () => {
    deleteOld.run(gameId);
    for (const m of analysis.moves || []) {
      const dbMove = byPly.get(m.ply_index);
      if (!dbMove) continue;

      const eng = m.engine || {};

      insert.run(
        gameId,
        dbMove.id,
        m.ply_index,
        m.san_move ?? dbMove.san_move,
        m.turn ?? dbMove.turn,
        sacByPly.get(m.ply_index) ?? null,
        eng.deep_eval_cp ?? null,
        eng.depth_slope ?? null,
        eng.depth_gain ?? null,
        eng.depth_variance ?? null,
        eng.early_eval_avg ?? null,
        eng.late_eval_avg ?? null,
        eng.is_rising_curve ? 1 : 0,
        eng.is_sound ? 1 : 0,
        eng.is_non_obvious ? 1 : 0,
        eng.rank_at_depth8 ?? null,
        eng.rank_at_depth22 ?? null,
        eng.rank_jump ?? null,
        eng.good_defenses ?? null,
        eng.defense_difficulty ?? null,
        eng.counterfactual_delta ?? null,
        eng.non_obvious_score ?? null,
        m.classification_if_unsound ?? null,
        m.proceed_to_stage4 ? 1 : 0,
        eng.engine_depth ?? 18,
        JSON.stringify(eng.depth_evals ?? {}),
        eng.eval_perspective ?? 'white',
        JSON.stringify(m)
      );
    }

    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage3_status = 'completed',
           stage3_run_at = datetime('now'),
           stage3_analyzed_count = ?,
           stage3_sound_count = ?,
           stage3_error = NULL
       WHERE id = ?`
    ).run(analysis.analyzed_count ?? 0, analysis.sound_count ?? 0, gameId);
  });
}

async function runStage3ForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  const game = getGame(id);
  if (!game) throw new Error('Game not found');

  if (runningGames.has(id)) {
    return getStage3Features(id);
  }

  const stage2 = getStage2Status(id);
  if (stage2?.status !== 'completed' || stage2.features_saved === 0) {
    await runStage2ForGame(id);
  }

  const plyIndices = getStage3PasserPlies(id);
  if (plyIndices.length === 0) {
    clearStageTablesFrom(id, 3);
    markStageEmptyComplete(id, 3);
    markStageEmptyComplete(id, 4);
    return getStage3Features(id);
  }

  if (!force) {
    const existing = getStage3Status(id);
    if (existing?.status === 'completed') {
      return getStage3Features(id);
    }
  }

  runningGames.add(id);
  db.prepare(
    `UPDATE lichess_pgn_games SET stage3_status = 'running', stage3_error = NULL WHERE id = ?`
  ).run(id);

  try {
    const analysis = await runPythonStage3(game.clean_pgn, plyIndices);
    if (analysis.error) throw new Error(analysis.error);

    saveStage3Results(id, analysis);
    return getStage3Features(id);
  } catch (e) {
    db.prepare(
      `UPDATE lichess_pgn_games SET stage3_status = 'failed', stage3_error = ? WHERE id = ?`
    ).run(e?.message || String(e), id);
    throw e;
  } finally {
    runningGames.delete(id);
  }
}

module.exports = {
  getStage3Status,
  getStage3Features,
  runStage3ForGame,
};
