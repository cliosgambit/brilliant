const path = require('path');
const { execFile } = require('child_process');
const { db } = require('../db/database');
const { runInTransaction } = require('../db/tx');
const { getGame } = require('./lichessPgnService');
const { getStage3Status, runStage3ForGame } = require('./brillianceStage3Service');
const { clearStageTablesFrom, markStageEmptyComplete } = require('./brilliancePipelineUtils');

const scriptPath = path.join(__dirname, '..', 'brilliance_stage4.py');
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

function getPlayerRating(pgnMetadata, turn) {
  const meta = pgnMetadata || {};
  const raw =
    turn === 'white'
      ? meta.WhiteElo ?? meta.white_elo ?? meta.WhiteRating
      : meta.BlackElo ?? meta.black_elo ?? meta.BlackRating;
  const rating = parseInt(raw, 10);
  return Number.isFinite(rating) ? rating : 1500;
}

function toMoverCp(whiteCp, turn) {
  if (whiteCp == null || !Number.isFinite(whiteCp)) return null;
  return turn === 'white' ? whiteCp : -whiteCp;
}

function buildStage4Inputs(gameId) {
  const game = getGame(gameId);
  if (!game) return [];

  const stage3Rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage3
       WHERE game_id = ? AND proceed_to_stage4 = 1
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const stage0ByPly = new Map(
    db
      .prepare(`SELECT * FROM lichess_pgn_stage0 WHERE game_id = ?`)
      .all(gameId)
      .map((r) => [r.ply_index, r])
  );

  const stage1ByPly = new Map(
    db
      .prepare(`SELECT ply_index, sac_type FROM lichess_pgn_stage1 WHERE game_id = ?`)
      .all(gameId)
      .map((r) => [r.ply_index, r])
  );

  const stage2ByPly = new Map(
    db
      .prepare(`SELECT ply_index, features_json FROM lichess_pgn_stage2 WHERE game_id = ?`)
      .all(gameId)
      .map((r) => [r.ply_index, r])
  );

  return stage3Rows.map((s3) => {
    const s0 = stage0ByPly.get(s3.ply_index) || {};
    const s1 = stage1ByPly.get(s3.ply_index) || {};
    const s2 = stage2ByPly.get(s3.ply_index) || {};
    let deepEvalMover = null;
    let materialBalanceBefore = null;
    let quietScore = 0;
    let materialDeficit = 0;
    let uciMove = null;
    let fenBefore = null;
    let preMoveEvalMover = null;

    if (s0.features_json) {
      try {
        const s0Features = JSON.parse(s0.features_json);
        materialBalanceBefore = s0Features?.setup?.material_balance_before ?? null;
        quietScore = s0Features?.quiet_brilliance?.quiet_score ?? 0;
        materialDeficit = s0Features?.defensive_context?.material_deficit ?? 0;
        uciMove = s0Features?.uci_move ?? null;
        fenBefore = s0Features?.fen_before ?? null;
      } catch {
        materialBalanceBefore = null;
      }
    }

    if (s2.features_json) {
      try {
        const s2Features = JSON.parse(s2.features_json);
        preMoveEvalMover = s2Features?.engine?.pre_move_eval_mover_cp ?? null;
      } catch {
        preMoveEvalMover = null;
      }
    }
    if (s3.features_json) {
      try {
        const features = JSON.parse(s3.features_json);
        deepEvalMover = features?.engine?.deep_eval_mover_cp ?? null;
      } catch {
        deepEvalMover = null;
      }
    }
    if (deepEvalMover == null) {
      deepEvalMover = toMoverCp(s3.deep_eval_cp, s3.turn);
    }

    const isDefensive =
      materialDeficit > 150
      || (materialBalanceBefore != null && Number.isFinite(materialBalanceBefore) && materialBalanceBefore < -150);

    return {
      ply_index: s3.ply_index,
      san_move: s3.san_move,
      uci_move: uciMove,
      fen_before: fenBefore,
      turn: s3.turn,
      player_rating: getPlayerRating(game.pgn_metadata, s3.turn),
      sac_type: s3.sac_type || s1.sac_type || null,
      ev_score: s0.ev_score ?? 0,
      multiplexing_score: s0.multiplexing_score ?? 0,
      king_safety_delta: s0.king_safety_delta ?? 0,
      game_phase: s0.game_phase ?? 'middlegame',
      is_check: Boolean(s0.is_check),
      is_capture: Boolean(s0.is_capture),
      is_defensive: isDefensive,
      quiet_score: quietScore,
      material_deficit: materialDeficit,
      pre_move_eval_mover_cp: preMoveEvalMover,
      rank_at_depth8: s3.rank_at_depth8,
      non_obvious_score: s3.non_obvious_score,
      defense_difficulty: s3.defense_difficulty,
      is_sound: Boolean(s3.is_sound),
      deep_eval_cp: s3.deep_eval_cp,
      deep_eval_mover_cp: deepEvalMover,
    };
  });
}

function getStage4Status(gameId) {
  const game = db
    .prepare(
      `SELECT id, stage4_status, stage4_run_at, stage4_analyzed_count,
              stage4_brilliant_count, stage4_error
       FROM lichess_pgn_games WHERE id = ?`
    )
    .get(gameId);
  if (!game) return null;

  const rowCount = db
    .prepare('SELECT COUNT(*) AS c FROM lichess_pgn_stage4 WHERE game_id = ?')
    .get(gameId);

  return {
    game_id: gameId,
    status: game.stage4_status,
    run_at: game.stage4_run_at,
    analyzed_count: game.stage4_analyzed_count,
    brilliant_count: game.stage4_brilliant_count,
    error: game.stage4_error,
    features_saved: rowCount?.c ?? 0,
    engine_used: false,
    running: runningGames.has(gameId),
  };
}

function parseStage4Row(row) {
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
    player_rating: row.player_rating,
    surprise_score: row.surprise_score,
    info_surprise_bits: row.info_surprise_bits,
    brilliant_for_rating: Boolean(row.brilliant_for_rating),
    pb_score: row.pb_score,
    pb_category: row.pb_category,
    obj_quality: row.obj_quality,
    practical_value: row.practical_value,
    is_tal_zone: Boolean(row.is_tal_zone),
    archetype: row.archetype,
    brilliance_score: row.brilliance_score,
    classification: row.classification,
    is_brilliant: Boolean(row.is_brilliant),
    features,
  };
}

function getStage4Features(gameId) {
  const rows = db
    .prepare(
      `SELECT *
       FROM lichess_pgn_stage4
       WHERE game_id = ?
       ORDER BY ply_index ASC`
    )
    .all(gameId);

  const moves = rows.map(parseStage4Row);
  const brilliant = moves.filter((m) => m.is_brilliant).length;
  const practical = moves.filter((m) =>
    ['BRILLIANT', 'practical_brilliant'].includes(m.classification)
  ).length;

  return {
    ...getStage4Status(gameId),
    practical_brilliant_count: practical,
    moves,
  };
}

function runPythonStage4(moves) {
  const inputJson = JSON.stringify({ moves });

  const run = (cmd, cmdArgs) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        cmdArgs,
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          try {
            resolve(JSON.parse(String(stdout || '').trim() || '{}'));
          } catch {
            reject(new Error('Invalid JSON from stage4 analyzer'));
          }
        }
      );
    });

  return run('python', [scriptPath, inputJson]).catch(() =>
    run('py', ['-3', scriptPath, inputJson]).catch(() => run('python3', [scriptPath, inputJson]))
  );
}

function saveStage4Results(gameId, analysis) {
  const moveRows = getMoveRows(gameId);
  const byPly = new Map(moveRows.map((m) => [m.ply_index, m]));

  const deleteOld = db.prepare('DELETE FROM lichess_pgn_stage4 WHERE game_id = ?');
  const insert = db.prepare(
    `INSERT INTO lichess_pgn_stage4 (
      game_id, move_id, ply_index, san_move, turn, sac_type, player_rating,
      surprise_score, info_surprise_bits, brilliant_for_rating,
      pb_score, pb_category, obj_quality, practical_value, is_tal_zone,
      archetype, brilliance_score, classification, is_brilliant, features_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  runInTransaction(db, () => {
    deleteOld.run(gameId);
    for (const m of analysis.moves || []) {
      const dbMove = byPly.get(m.ply_index);
      if (!dbMove) continue;

      const surprise = m.surprise || {};
      const practical = m.practical || {};

      insert.run(
        gameId,
        dbMove.id,
        m.ply_index,
        m.san_move ?? dbMove.san_move,
        m.turn ?? dbMove.turn,
        m.sac_type ?? null,
        surprise.player_rating ?? null,
        surprise.surprise_score ?? null,
        surprise.info_surprise_bits ?? null,
        surprise.brilliant_for_rating ? 1 : 0,
        practical.pb_score ?? null,
        practical.category ?? null,
        practical.obj_quality ?? null,
        practical.practical_value ?? null,
        practical.is_tal_zone ? 1 : 0,
        m.archetype ?? null,
        m.brilliance_score ?? null,
        m.classification ?? null,
        m.is_brilliant ? 1 : 0,
        JSON.stringify(m)
      );
    }

    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage4_status = 'completed',
           stage4_run_at = datetime('now'),
           stage4_analyzed_count = ?,
           stage4_brilliant_count = ?,
           stage4_error = NULL
       WHERE id = ?`
    ).run(analysis.analyzed_count ?? 0, analysis.brilliant_count ?? 0, gameId);
  });
}

async function runStage4ForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  const game = getGame(id);
  if (!game) throw new Error('Game not found');

  if (runningGames.has(id)) {
    return getStage4Features(id);
  }

  const stage3 = getStage3Status(id);
  if (stage3?.status !== 'completed') {
    await runStage3ForGame(id);
  }

  const inputs = buildStage4Inputs(id);
  if (inputs.length === 0) {
    clearStageTablesFrom(id, 4);
    markStageEmptyComplete(id, 4);
    return getStage4Features(id);
  }

  if (!force) {
    const existing = getStage4Status(id);
    if (existing?.status === 'completed') {
      return getStage4Features(id);
    }
  }

  runningGames.add(id);
  db.prepare(
    `UPDATE lichess_pgn_games SET stage4_status = 'running', stage4_error = NULL WHERE id = ?`
  ).run(id);

  try {
    const analysis = await runPythonStage4(inputs);
    if (analysis.error) throw new Error(analysis.error);

    saveStage4Results(id, analysis);
    return getStage4Features(id);
  } catch (e) {
    db.prepare(
      `UPDATE lichess_pgn_games SET stage4_status = 'failed', stage4_error = ? WHERE id = ?`
    ).run(e?.message || String(e), id);
    throw e;
  } finally {
    runningGames.delete(id);
  }
}

module.exports = {
  getStage4Status,
  getStage4Features,
  runStage4ForGame,
};
