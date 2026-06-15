const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db/database');
const { runInTransaction } = require('../db/tx');
const { getGame } = require('./lichessPgnService');

const scriptPath = path.join(__dirname, '..', 'brilliance_stage0.py');

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

function getStage0Status(gameId) {
  const game = db
    .prepare(
      `SELECT id, stage0_status, stage0_run_at, stage0_sacrifice_count, stage0_error, move_count
       FROM lichess_pgn_games WHERE id = ?`
    )
    .get(gameId);
  if (!game) return null;

  const rowCount = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_stage0 WHERE game_id = ?')
    .get(gameId);

  return {
    game_id: gameId,
    status: game.stage0_status,
    run_at: game.stage0_run_at,
    sacrifice_candidate_count: game.stage0_sacrifice_count,
    error: game.stage0_error,
    move_count: game.move_count,
    features_saved: rowCount?.c ?? 0,
    running: runningGames.has(gameId),
  };
}

function parseFeatureRow(row) {
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
    game_phase: row.game_phase,
    see_value: row.see_value,
    is_capture: Boolean(row.is_capture),
    is_sacrifice_candidate: Boolean(row.is_sacrifice_candidate),
    was_piece_hanging: Boolean(
      row.was_piece_hanging
      ?? features?.piece_vulnerability?.already_lost_before_move
      ?? features?.piece_hanging?.already_lost_before_move
    ),
    en_prise_before_move: Boolean(
      features?.piece_vulnerability?.en_prise_before_move
      ?? features?.piece_hanging?.en_prise_before_move
    ),
    already_lost_before_move: Boolean(
      features?.piece_vulnerability?.already_lost_before_move
      ?? features?.piece_hanging?.already_lost_before_move
      ?? row.was_piece_hanging
    ),
    king_safety_delta: row.king_safety_delta,
    multiplexing_score: row.multiplexing_score,
    ev_score: row.ev_score,
    harmony_score: row.harmony_score,
    control_delta: row.control_delta,
    activity_delta: row.activity_delta,
    is_check: Boolean(row.is_check),
    moving_piece_type: row.moving_piece_type,
    dest_attackers: row.dest_attackers,
    dest_defenders: row.dest_defenders,
    indirect_sacrifice_candidate: Boolean(
      features?.see?.indirect_sacrifice_candidate
    ),
    hanging_sacrifice: Boolean(features?.see?.hanging_sacrifice),
    defender_removal_sacrifice: Boolean(features?.see?.defender_removal_sacrifice),
    newly_exposed_piece: features?.see?.newly_exposed_piece ?? null,
    newly_exposed_piece_square: features?.see?.newly_exposed_piece_square ?? null,
    newly_exposed_piece_type: features?.see?.newly_exposed_piece_type ?? null,
    newly_exposed_piece_value: features?.see?.newly_exposed_piece_value ?? 0,
    pre_move_see: features?.see?.pre_move_see ?? 0,
    post_move_see: features?.see?.post_move_see ?? 0,
    pre_move_defenders: features?.see?.pre_move_defenders ?? 0,
    post_move_defenders: features?.see?.post_move_defenders ?? 0,
    exposed_piece_square: features?.see?.exposed_piece_square ?? null,
    exposed_piece_type: features?.see?.exposed_piece_type ?? null,
    exposed_piece_value: features?.see?.exposed_piece_value ?? 0,
    sacrifice_risk: features?.see?.sacrifice_risk ?? 0,
    proceed_to_stage1: Boolean(row.proceed_to_stage1),
    proceed_to_engine: Boolean(features?.proceed_to_engine),
    engine_candidate_path: features?.engine_candidate_path ?? null,
    features,
  };
}

function getStage0Features(gameId) {
  const rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage0
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const status = getStage0Status(gameId);
  return {
    ...status,
    engine_used: false,
    moves: rows.map(parseFeatureRow),
  };
}

function runPythonStage0(pgn) {
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
          reject(new Error('Invalid JSON from stage0 analyzer'));
        }
      });
    });

  return run('python', [scriptPath, inputJson]).catch(() =>
    run('py', ['-3', scriptPath, inputJson]).catch(() => run('python3', [scriptPath, inputJson]))
  );
}

function saveStage0Results(gameId, analysis) {
  const moveRows = getMoveRows(gameId);
  const byPly = new Map(moveRows.map((m) => [m.ply_index, m]));

  const deleteOld = db.prepare('DELETE FROM lichess_pgn_stage0 WHERE game_id = ?');
  const insert = db.prepare(
    `INSERT INTO lichess_pgn_stage0 (
      game_id, move_id, ply_index, san_move, turn, game_phase,
      see_value, is_capture, is_sacrifice_candidate, was_piece_hanging,
      king_safety_delta, multiplexing_score, ev_score, harmony_score,
      control_delta, activity_delta, is_check, moving_piece_type,
      dest_attackers, dest_defenders, proceed_to_stage1, features_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )`
  );

  runInTransaction(db, () => {
    deleteOld.run(gameId);
    for (const m of analysis.moves || []) {
      const dbMove = byPly.get(m.ply_index);
      if (!dbMove) continue;

      const see = m.see || {};
      const tm = m.tactical_multiplexing || {};
      const ev = m.expectation_violation || {};
      const harmony = m.piece_harmony || {};
      const setup = m.setup || {};
      const king = m.king_safety || {};

      insert.run(
        gameId,
        dbMove.id,
        m.ply_index,
        m.san_move ?? dbMove.san_move,
        m.turn ?? dbMove.turn,
        setup.game_phase ?? null,
        see.see_value ?? 0,
        see.is_capture ? 1 : 0,
        m.is_sacrifice_candidate ? 1 : 0,
        m.piece_vulnerability?.already_lost_before_move
          ?? m.piece_hanging?.already_lost_before_move
          ? 1
          : 0,
        king.opp_king_safety_delta ?? null,
        tm.multiplexing_score ?? 0,
        ev.ev_score ?? 0,
        harmony.harmony_score ?? 0,
        harmony.control_delta ?? 0,
        harmony.activity_delta ?? 0,
        tm.is_check ? 1 : 0,
        see.moving_piece_type ?? null,
        see.dest_attackers ?? 0,
        see.dest_defenders ?? 0,
        m.proceed_to_stage1 ? 1 : 0,
        JSON.stringify(m)
      );
    }

    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage0_status = 'completed',
           stage0_run_at = datetime('now'),
           stage0_sacrifice_count = ?,
           stage0_error = NULL
       WHERE id = ?`
    ).run(analysis.sacrifice_candidate_count ?? 0, gameId);
  });
}

async function runStage0ForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  const game = getGame(id);
  if (!game) throw new Error('Game not found');

  if (runningGames.has(id)) {
    const existing = getStage0Status(id);
    if (existing?.features_saved > 0) {
      return getStage0Features(id);
    }
    return existing;
  }

  if (!force) {
    const existing = getStage0Status(id);
    if (existing?.status === 'completed' && existing.features_saved > 0) {
      return getStage0Features(id);
    }
  }

  runningGames.add(id);
  db.prepare(
    `UPDATE lichess_pgn_games
     SET stage0_status = 'running', stage0_error = NULL
     WHERE id = ?`
  ).run(id);

  try {
    const analysis = await runPythonStage0(game.clean_pgn);
    if (analysis.error) throw new Error(analysis.error);

    saveStage0Results(id, analysis);
    return getStage0Features(id);
  } catch (e) {
    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage0_status = 'failed', stage0_error = ?
       WHERE id = ?`
    ).run(e?.message || String(e), id);
    throw e;
  } finally {
    runningGames.delete(id);
  }
}

module.exports = {
  getStage0Status,
  getStage0Features,
  runStage0ForGame,
};
