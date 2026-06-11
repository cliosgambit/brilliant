const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { MOVE_ROW_DATA_COLUMNS } = require('./moveRowColumns');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'chess_analysis.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const schemaPath = path.join(__dirname, 'schema.sql');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

const LEGACY_MOVE_ROW_COLUMNS = new Set([
  'sacrifices',
  'tempo',
  'generated_commentary',
  'ml_inputs_json',
  'ml_predictions_json',
  'flan_t5_output',
]);

const TARGET_MOVE_ROW_COLUMNS = new Set([
  'id',
  'session_id',
  'ply_index',
  ...MOVE_ROW_DATA_COLUMNS,
]);

function migrateRebuildMoveRowsIfLegacyColumns() {
  const cols = db.prepare(`PRAGMA table_info('analysis_move_rows')`).all();
  const existingNames = cols.map((c) => c.name).filter(Boolean);
  const hasLegacy = existingNames.some((n) => LEGACY_MOVE_ROW_COLUMNS.has(n));
  if (!hasLegacy) return;

  const keepNames = existingNames.filter((n) => TARGET_MOVE_ROW_COLUMNS.has(n));
  if (!keepNames.includes('id') || !keepNames.includes('session_id') || !keepNames.includes('ply_index')) {
    return;
  }

  const colList = keepNames.join(', ');

  db.exec('BEGIN;');
  try {
    db.exec(`ALTER TABLE analysis_move_rows RENAME TO analysis_move_rows_old;`);
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
    db.exec(`INSERT INTO analysis_move_rows (${colList}) SELECT ${colList} FROM analysis_move_rows_old;`);
    db.exec(`DROP TABLE analysis_move_rows_old;`);
    db.exec('COMMIT;');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    try {
      const t = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_move_rows_old'`)
        .get();
      if (t) {
        db.exec(`ALTER TABLE analysis_move_rows_old RENAME TO analysis_move_rows;`);
      }
    } catch {}
    console.warn('[db][migrate] drop legacy move row columns failed:', e?.message || String(e));
  }
}

migrateRebuildMoveRowsIfLegacyColumns();

function migrateAddColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info('${table}')`).all();
  if (cols.some((c) => c?.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  } catch (e) {
    console.warn(`[db][migrate] add ${table}.${column} failed:`, e?.message || String(e));
  }
}

migrateAddColumn('analysis_move_rows', 'best_line_delta', 'best_line_delta TEXT');
migrateAddColumn('analysis_move_rows', 'pipeline_json', 'pipeline_json TEXT');

const IMPORT_SESSION_COLUMNS = new Set([
  'import_batch_id',
  'import_game_index',
  'lichess_game_id',
]);

function migrateDropPgnImport() {
  try {
    db.exec(`
      DROP INDEX IF EXISTS idx_pgn_import_raw_lichess_game;
      DROP INDEX IF EXISTS idx_pgn_import_raw_batch_game;
      DROP INDEX IF EXISTS idx_pgn_import_raw_status;
      DROP INDEX IF EXISTS idx_analysis_sessions_lichess_game;
      DROP TABLE IF EXISTS pgn_import_raw_games;
      DROP TABLE IF EXISTS pgn_import_batches;
    `);
  } catch (e) {
    console.warn('[db][migrate] drop pgn import tables failed:', e?.message || String(e));
  }

  const cols = db.prepare(`PRAGMA table_info('analysis_sessions')`).all();
  const existingNames = cols.map((c) => c.name).filter(Boolean);
  const hasImportCols = existingNames.some((n) => IMPORT_SESSION_COLUMNS.has(n));
  if (!hasImportCols) return;

  const keepNames = existingNames.filter((n) => !IMPORT_SESSION_COLUMNS.has(n));
  if (!keepNames.includes('id')) return;

  const colList = keepNames.join(', ');

  db.exec('BEGIN;');
  try {
    db.exec(`ALTER TABLE analysis_sessions RENAME TO analysis_sessions_old;`);
    db.exec(fs.readFileSync(schemaPath, 'utf8'));
    db.exec(
      `INSERT INTO analysis_sessions (${colList}) SELECT ${colList} FROM analysis_sessions_old;`
    );
    db.exec(`DROP TABLE analysis_sessions_old;`);
    db.exec('COMMIT;');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    try {
      const t = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='analysis_sessions_old'`)
        .get();
      if (t) {
        db.exec(`ALTER TABLE analysis_sessions_old RENAME TO analysis_sessions;`);
      }
    } catch {}
    console.warn('[db][migrate] drop import session columns failed:', e?.message || String(e));
  }
}

migrateDropPgnImport();

function migrateDropBehavioralStoriesTable() {
  try {
    db.exec(`DROP TABLE IF EXISTS behavioral_stories;`);
  } catch (e) {
    console.warn('[db][migrate] drop behavioral_stories failed:', e?.message || String(e));
  }
}

migrateDropBehavioralStoriesTable();

function migrateLichessStage0() {
  migrateAddColumn('lichess_pgn_games', 'stage0_status', "stage0_status TEXT NOT NULL DEFAULT 'pending'");
  migrateAddColumn('lichess_pgn_games', 'stage0_run_at', 'stage0_run_at TEXT');
  migrateAddColumn('lichess_pgn_games', 'stage0_sacrifice_count', 'stage0_sacrifice_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage0_error', 'stage0_error TEXT');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lichess_pgn_stage0 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        move_id INTEGER NOT NULL,
        ply_index INTEGER NOT NULL,
        san_move TEXT,
        turn TEXT,
        game_phase TEXT,
        see_value INTEGER,
        is_capture INTEGER NOT NULL DEFAULT 0,
        is_sacrifice_candidate INTEGER NOT NULL DEFAULT 0,
        was_piece_hanging INTEGER NOT NULL DEFAULT 0,
        king_safety_delta INTEGER,
        multiplexing_score INTEGER,
        ev_score INTEGER,
        harmony_score REAL,
        control_delta INTEGER,
        activity_delta REAL,
        is_check INTEGER NOT NULL DEFAULT 0,
        moving_piece_type TEXT,
        dest_attackers INTEGER,
        dest_defenders INTEGER,
        proceed_to_stage1 INTEGER NOT NULL DEFAULT 0,
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE,
        FOREIGN KEY (move_id) REFERENCES lichess_pgn_moves(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_stage0_game_ply
        ON lichess_pgn_stage0(game_id, ply_index);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage0_game
        ON lichess_pgn_stage0(game_id);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage0_sacrifice
        ON lichess_pgn_stage0(game_id, is_sacrifice_candidate);
    `);
  } catch (e) {
    console.warn('[db][migrate] lichess_pgn_stage0 table failed:', e?.message || String(e));
  }

  migrateAddColumn('lichess_pgn_games', 'stage1_status', "stage1_status TEXT NOT NULL DEFAULT 'pending'");
  migrateAddColumn('lichess_pgn_games', 'stage1_run_at', 'stage1_run_at TEXT');
  migrateAddColumn('lichess_pgn_games', 'stage1_candidate_count', 'stage1_candidate_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage1_valid_count', 'stage1_valid_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage1_proceed_stage2_count', 'stage1_proceed_stage2_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage1_error', 'stage1_error TEXT');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lichess_pgn_stage1 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        move_id INTEGER NOT NULL,
        ply_index INTEGER NOT NULL,
        san_move TEXT,
        turn TEXT,
        sac_type TEXT,
        disqualifiers_json TEXT,
        is_valid_sacrifice INTEGER NOT NULL DEFAULT 0,
        is_pseudo INTEGER NOT NULL DEFAULT 0,
        material_loss_cp INTEGER,
        sacrifice_uncertainty REAL,
        recapture_options INTEGER,
        is_forced INTEGER NOT NULL DEFAULT 0,
        forced_reason TEXT,
        n_legal INTEGER,
        proceed_to_stage2 INTEGER NOT NULL DEFAULT 0,
        gate_fail_reason TEXT,
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE,
        FOREIGN KEY (move_id) REFERENCES lichess_pgn_moves(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_stage1_game_ply
        ON lichess_pgn_stage1(game_id, ply_index);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage1_game
        ON lichess_pgn_stage1(game_id);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage1_proceed
        ON lichess_pgn_stage1(game_id, proceed_to_stage2);
    `);
  } catch (e) {
    console.warn('[db][migrate] lichess_pgn_stage1 table failed:', e?.message || String(e));
  }

  migrateAddColumn('lichess_pgn_games', 'stage2_status', "stage2_status TEXT NOT NULL DEFAULT 'pending'");
  migrateAddColumn('lichess_pgn_games', 'stage2_run_at', 'stage2_run_at TEXT');
  migrateAddColumn('lichess_pgn_games', 'stage2_analyzed_count', 'stage2_analyzed_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage2_proceed_stage3_count', 'stage2_proceed_stage3_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage2_error', 'stage2_error TEXT');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lichess_pgn_stage2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        move_id INTEGER NOT NULL,
        ply_index INTEGER NOT NULL,
        san_move TEXT,
        turn TEXT,
        sac_type TEXT,
        best_move TEXT,
        best_score_cp INTEGER,
        our_score_cp INTEGER,
        our_rank_in_top5 INTEGER,
        cpl_shallow INTEGER,
        ep_delta_shallow REAL,
        is_forced_engine INTEGER NOT NULL DEFAULT 0,
        n_reasonable_moves INTEGER,
        response_width INTEGER,
        is_best_or_near_best INTEGER NOT NULL DEFAULT 0,
        proceed_to_stage3 INTEGER NOT NULL DEFAULT 0,
        gate_fail_reason TEXT,
        classification_if_fail TEXT,
        engine_depth INTEGER NOT NULL DEFAULT 12,
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE,
        FOREIGN KEY (move_id) REFERENCES lichess_pgn_moves(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_stage2_game_ply
        ON lichess_pgn_stage2(game_id, ply_index);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage2_game
        ON lichess_pgn_stage2(game_id);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage2_proceed
        ON lichess_pgn_stage2(game_id, proceed_to_stage3);
    `);
  } catch (e) {
    console.warn('[db][migrate] lichess_pgn_stage2 table failed:', e?.message || String(e));
  }

  migrateAddColumn('lichess_pgn_games', 'stage3_status', "stage3_status TEXT NOT NULL DEFAULT 'pending'");
  migrateAddColumn('lichess_pgn_games', 'stage3_run_at', 'stage3_run_at TEXT');
  migrateAddColumn('lichess_pgn_games', 'stage3_analyzed_count', 'stage3_analyzed_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage3_sound_count', 'stage3_sound_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage3_error', 'stage3_error TEXT');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lichess_pgn_stage3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        move_id INTEGER NOT NULL,
        ply_index INTEGER NOT NULL,
        san_move TEXT,
        turn TEXT,
        sac_type TEXT,
        deep_eval_cp INTEGER,
        depth_slope REAL,
        depth_gain REAL,
        depth_variance REAL,
        early_eval_avg REAL,
        late_eval_avg REAL,
        is_rising_curve INTEGER NOT NULL DEFAULT 0,
        is_sound INTEGER NOT NULL DEFAULT 0,
        is_non_obvious INTEGER NOT NULL DEFAULT 0,
        rank_at_depth8 INTEGER,
        rank_at_depth22 INTEGER,
        rank_jump INTEGER,
        good_defenses INTEGER,
        defense_difficulty REAL,
        counterfactual_delta REAL,
        non_obvious_score REAL,
        classification_if_unsound TEXT,
        proceed_to_stage4 INTEGER NOT NULL DEFAULT 1,
        engine_depth INTEGER NOT NULL DEFAULT 25,
        depth_evals_json TEXT,
        eval_perspective TEXT NOT NULL DEFAULT 'white',
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE,
        FOREIGN KEY (move_id) REFERENCES lichess_pgn_moves(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_stage3_game_ply
        ON lichess_pgn_stage3(game_id, ply_index);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage3_game
        ON lichess_pgn_stage3(game_id);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage3_sound
        ON lichess_pgn_stage3(game_id, is_sound);
    `);
  } catch (e) {
    console.warn('[db][migrate] lichess_pgn_stage3 table failed:', e?.message || String(e));
  }

  migrateAddColumn('lichess_pgn_games', 'stage4_status', "stage4_status TEXT NOT NULL DEFAULT 'pending'");
  migrateAddColumn('lichess_pgn_games', 'stage4_run_at', 'stage4_run_at TEXT');
  migrateAddColumn('lichess_pgn_games', 'stage4_analyzed_count', 'stage4_analyzed_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage4_brilliant_count', 'stage4_brilliant_count INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('lichess_pgn_games', 'stage4_error', 'stage4_error TEXT');

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lichess_pgn_stage4 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        move_id INTEGER NOT NULL,
        ply_index INTEGER NOT NULL,
        san_move TEXT,
        turn TEXT,
        sac_type TEXT,
        player_rating INTEGER,
        surprise_score REAL,
        info_surprise_bits REAL,
        brilliant_for_rating INTEGER NOT NULL DEFAULT 0,
        pb_score REAL,
        pb_category TEXT,
        obj_quality REAL,
        practical_value REAL,
        is_tal_zone INTEGER NOT NULL DEFAULT 0,
        archetype TEXT,
        brilliance_score REAL,
        classification TEXT,
        is_brilliant INTEGER NOT NULL DEFAULT 0,
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE,
        FOREIGN KEY (move_id) REFERENCES lichess_pgn_moves(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_stage4_game_ply
        ON lichess_pgn_stage4(game_id, ply_index);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage4_game
        ON lichess_pgn_stage4(game_id);
      CREATE INDEX IF NOT EXISTS idx_lichess_pgn_stage4_brilliant
        ON lichess_pgn_stage4(game_id, is_brilliant);
    `);
  } catch (e) {
    console.warn('[db][migrate] lichess_pgn_stage4 table failed:', e?.message || String(e));
  }
}

migrateLichessStage0();

function touchSessionUpdatedAt(sessionId) {
  db.prepare(
    `UPDATE analysis_sessions SET updated_at = datetime('now') WHERE id = ?`
  ).run(sessionId);
}

module.exports = {
  db,
  dbPath,
  touchSessionUpdatedAt,
};
