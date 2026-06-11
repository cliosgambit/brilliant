const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db/database');
const { runInTransaction } = require('../db/tx');
const { getGame } = require('./lichessPgnService');
const { getStage0Status, runStage0ForGame } = require('./brillianceStage0Service');
const { clearStageTablesFrom, markStageEmptyComplete } = require('./brilliancePipelineUtils');

const scriptPath = path.join(__dirname, '..', 'brilliance_stage1.py');
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

function getStage1Status(gameId) {
  const game = db
    .prepare(
      `SELECT id, stage1_status, stage1_run_at, stage1_candidate_count,
              stage1_valid_count, stage1_proceed_stage2_count, stage1_error
       FROM lichess_pgn_games WHERE id = ?`
    )
    .get(gameId);
  if (!game) return null;

  const rowCount = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_stage1 WHERE game_id = ?')
    .get(gameId);

  return {
    game_id: gameId,
    status: game.stage1_status,
    run_at: game.stage1_run_at,
    candidate_count: game.stage1_candidate_count,
    valid_sacrifice_count: game.stage1_valid_count,
    proceed_to_stage2_count: game.stage1_proceed_stage2_count,
    error: game.stage1_error,
    features_saved: rowCount?.c ?? 0,
    engine_used: false,
    running: runningGames.has(gameId),
  };
}

function parseStage1Row(row) {
  let features = null;
  let disqualifiers = [];
  if (row.disqualifiers_json) {
    try {
      disqualifiers = JSON.parse(row.disqualifiers_json);
    } catch {
      disqualifiers = [];
    }
  }
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
    disqualifiers,
    is_valid_sacrifice: Boolean(row.is_valid_sacrifice),
    is_pseudo: Boolean(row.is_pseudo),
    material_loss_cp: row.material_loss_cp,
    sacrifice_uncertainty: row.sacrifice_uncertainty,
    recapture_options: row.recapture_options,
    is_forced: Boolean(row.is_forced),
    forced_reason: row.forced_reason,
    n_legal: row.n_legal,
    proceed_to_stage2: Boolean(row.proceed_to_stage2),
    gate_fail_reason: row.gate_fail_reason,
    features,
  };
}

function getStage1Features(gameId) {
  const rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage1
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const moves = rows.map(parseStage1Row);
  const proceed = moves.filter((m) => m.proceed_to_stage2).length;

  return {
    ...getStage1Status(gameId),
    disqualified_count: moves.length - moves.filter((m) => m.is_valid_sacrifice).length,
    forced_move_count: moves.filter((m) => m.is_forced).length,
    moves,
  };
}

function runPythonStage1(pgn) {
  const inputJson = JSON.stringify({ pgn });

  const run = (cmd, cmdArgs) =>
    new Promise((resolve, reject) => {
      execFile(cmd, cmdArgs, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        try {
          resolve(JSON.parse(String(stdout || '').trim() || '{}'));
        } catch {
          reject(new Error('Invalid JSON from stage1 analyzer'));
        }
      });
    });

  return run('python', [scriptPath, inputJson]).catch(() =>
    run('py', ['-3', scriptPath, inputJson]).catch(() => run('python3', [scriptPath, inputJson]))
  );
}

function saveStage1Results(gameId, analysis) {
  const moveRows = getMoveRows(gameId);
  const byPly = new Map(moveRows.map((m) => [m.ply_index, m]));

  const deleteOld = db.prepare('DELETE FROM lichess_pgn_stage1 WHERE game_id = ?');
  const insert = db.prepare(
    `INSERT INTO lichess_pgn_stage1 (
      game_id, move_id, ply_index, san_move, turn,
      sac_type, disqualifiers_json, is_valid_sacrifice, is_pseudo,
      material_loss_cp, sacrifice_uncertainty, recapture_options,
      is_forced, forced_reason, n_legal, proceed_to_stage2,
      gate_fail_reason, features_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  runInTransaction(db, () => {
    deleteOld.run(gameId);
    for (const m of analysis.moves || []) {
      const dbMove = byPly.get(m.ply_index);
      if (!dbMove) continue;

      const sac = m.sacrifice_class || {};
      const forced = m.forced || {};

      insert.run(
        gameId,
        dbMove.id,
        m.ply_index,
        m.san_move ?? dbMove.san_move,
        m.turn ?? dbMove.turn,
        sac.sac_type ?? 'unknown',
        JSON.stringify(sac.disqualifiers || []),
        sac.is_valid_sacrifice ? 1 : 0,
        sac.is_pseudo ? 1 : 0,
        sac.material_loss_cp ?? 0,
        sac.sacrifice_uncertainty ?? 0,
        sac.recapture_options ?? 0,
        forced.is_forced ? 1 : 0,
        forced.reason ?? null,
        forced.n_legal ?? null,
        m.proceed_to_stage2 ? 1 : 0,
        m.gate_fail_reason ?? null,
        JSON.stringify(m)
      );
    }

    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage1_status = 'completed',
           stage1_run_at = datetime('now'),
           stage1_candidate_count = ?,
           stage1_valid_count = ?,
           stage1_proceed_stage2_count = ?,
           stage1_error = NULL
       WHERE id = ?`
    ).run(
      analysis.candidate_count ?? 0,
      analysis.valid_sacrifice_count ?? 0,
      analysis.proceed_to_stage2_count ?? 0,
      gameId
    );
  });
}

async function runStage1ForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  const game = getGame(id);
  if (!game) throw new Error('Game not found');

  if (runningGames.has(id)) {
    return getStage1Features(id);
  }

  const stage0 = getStage0Status(id);
  if (stage0?.status !== 'completed' || stage0.features_saved === 0) {
    await runStage0ForGame(id);
  }

  if (!force) {
    const existing = getStage1Status(id);
    if (existing?.status === 'completed') {
      return getStage1Features(id);
    }
  }

  runningGames.add(id);
  db.prepare(
    `UPDATE lichess_pgn_games SET stage1_status = 'running', stage1_error = NULL WHERE id = ?`
  ).run(id);

  try {
    const analysis = await runPythonStage1(game.clean_pgn);
    if (analysis.error) throw new Error(analysis.error);

    saveStage1Results(id, analysis);

    const proceedCount = analysis.proceed_to_stage2_count ?? 0;
    if (proceedCount === 0) {
      clearStageTablesFrom(id, 2);
      markStageEmptyComplete(id, 2);
      markStageEmptyComplete(id, 3);
      markStageEmptyComplete(id, 4);
    }

    return getStage1Features(id);
  } catch (e) {
    db.prepare(
      `UPDATE lichess_pgn_games SET stage1_status = 'failed', stage1_error = ? WHERE id = ?`
    ).run(e?.message || String(e), id);
    throw e;
  } finally {
    runningGames.delete(id);
  }
}

module.exports = {
  getStage1Status,
  getStage1Features,
  runStage1ForGame,
};
