const { db } = require('../db/database');

/**
 * Remove persisted stage rows from `fromStage` onward (1–4).
 * Stage 0 is handled by saveStage0Results (delete + re-insert all moves).
 */
function clearStageTablesFrom(gameId, fromStage = 1) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) return;

  if (fromStage <= 1) {
    db.prepare('DELETE FROM lichess_pgn_stage1 WHERE game_id = ?').run(id);
  }
  if (fromStage <= 2) {
    db.prepare('DELETE FROM lichess_pgn_stage2 WHERE game_id = ?').run(id);
  }
  if (fromStage <= 3) {
    db.prepare('DELETE FROM lichess_pgn_stage3 WHERE game_id = ?').run(id);
  }
  if (fromStage <= 4) {
    db.prepare('DELETE FROM lichess_pgn_stage4 WHERE game_id = ?').run(id);
  }
}

function resetStageGameCounters(gameId, fromStage = 1) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) return;

  const parts = [];
  if (fromStage <= 1) {
    parts.push(
      "stage1_status = 'pending'",
      'stage1_run_at = NULL',
      'stage1_candidate_count = 0',
      'stage1_valid_count = 0',
      'stage1_proceed_stage2_count = 0',
      'stage1_error = NULL'
    );
  }
  if (fromStage <= 2) {
    parts.push(
      "stage2_status = 'pending'",
      'stage2_run_at = NULL',
      'stage2_analyzed_count = 0',
      'stage2_proceed_stage3_count = 0',
      'stage2_error = NULL'
    );
  }
  if (fromStage <= 3) {
    parts.push(
      "stage3_status = 'pending'",
      'stage3_run_at = NULL',
      'stage3_analyzed_count = 0',
      'stage3_sound_count = 0',
      'stage3_error = NULL'
    );
  }
  if (fromStage <= 4) {
    parts.push(
      "stage4_status = 'pending'",
      'stage4_run_at = NULL',
      'stage4_analyzed_count = 0',
      'stage4_brilliant_count = 0',
      'stage4_error = NULL'
    );
  }
  if (parts.length) {
    db.prepare(`UPDATE lichess_pgn_games SET ${parts.join(', ')} WHERE id = ?`).run(id);
  }
}

function markStageEmptyComplete(gameId, stageNum) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) return;

  if (stageNum === 1) {
    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage1_status = 'completed', stage1_run_at = datetime('now'),
           stage1_candidate_count = 0, stage1_valid_count = 0,
           stage1_proceed_stage2_count = 0, stage1_error = NULL
       WHERE id = ?`
    ).run(id);
  } else if (stageNum === 2) {
    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage2_status = 'completed', stage2_run_at = datetime('now'),
           stage2_analyzed_count = 0, stage2_proceed_stage3_count = 0, stage2_error = NULL
       WHERE id = ?`
    ).run(id);
  } else if (stageNum === 3) {
    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage3_status = 'completed', stage3_run_at = datetime('now'),
           stage3_analyzed_count = 0, stage3_sound_count = 0, stage3_error = NULL
       WHERE id = ?`
    ).run(id);
  } else if (stageNum === 4) {
    db.prepare(
      `UPDATE lichess_pgn_games
       SET stage4_status = 'completed', stage4_run_at = datetime('now'),
           stage4_analyzed_count = 0, stage4_brilliant_count = 0, stage4_error = NULL
       WHERE id = ?`
    ).run(id);
  }
}

module.exports = {
  clearStageTablesFrom,
  resetStageGameCounters,
  markStageEmptyComplete,
};
