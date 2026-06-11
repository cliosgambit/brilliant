-- Local SQLite schema for saved analysis sessions and per-move export rows
-- (aligned with frontend Excel export in Analyze.jsx)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS analysis_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  input_filename TEXT,
  input_source TEXT,
  pgn_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'analyzing', 'completed', 'failed')),
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  notes TEXT,
  pgn_metadata TEXT
);

CREATE TABLE IF NOT EXISTS analysis_move_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  ply_index INTEGER NOT NULL,
  move_number TEXT,
  turn TEXT,
  san_move TEXT,
  uci_move TEXT,
  clock TEXT,
  played_move_classification TEXT,
  played_move_standing TEXT,
  played_move_eval TEXT,
  eval_before_move TEXT,
  move_quality_delta TEXT,
  best_line_delta TEXT,
  win_pct_white TEXT,
  fen_before_move TEXT,
  fen_after_move TEXT,
  legal_moves_at_move TEXT,
  best_move_alternatives TEXT,
  captures TEXT,
  game_phase TEXT,
  board_density TEXT,
  white_space_dominance TEXT,
  black_space_dominance TEXT,
  white_material TEXT,
  black_material TEXT,
  material_advantage TEXT,
  simplification TEXT,
  hanging_pieces TEXT,
  loose_pieces TEXT,
  white_king_attack_intensity TEXT,
  white_king_exposure TEXT,
  black_king_attack_intensity TEXT,
  black_king_exposure TEXT,
  white_king_mobility TEXT,
  black_king_mobility TEXT,
  white_pawn_islands TEXT,
  white_doubled_pawns TEXT,
  black_pawn_islands TEXT,
  black_doubled_pawns TEXT,
  white_avg_mobility TEXT,
  black_avg_mobility TEXT,
  white_position_freedom TEXT,
  black_position_freedom TEXT,
  white_space_controlled TEXT,
  black_space_controlled TEXT,
  space_ratio TEXT,
  pins TEXT,
  forks TEXT,
  endgame_proximity TEXT,
  white_practical_risk TEXT,
  black_practical_risk TEXT,
  overall_evaluation TEXT,
  winning_plan TEXT,
  line_1_eval TEXT,
  line_1_classification TEXT,
  line_1_sequence TEXT,
  line_2_eval TEXT,
  line_2_classification TEXT,
  line_2_sequence TEXT,
  line_3_eval TEXT,
  line_3_classification TEXT,
  line_3_sequence TEXT,
  line_4_eval TEXT,
  line_4_classification TEXT,
  line_4_sequence TEXT,
  line_5_eval TEXT,
  line_5_classification TEXT,
  line_5_sequence TEXT,
  line_6_eval TEXT,
  line_6_classification TEXT,
  line_6_sequence TEXT,
  line_7_eval TEXT,
  line_7_classification TEXT,
  line_7_sequence TEXT,
  line_8_eval TEXT,
  line_8_classification TEXT,
  line_8_sequence TEXT,
  line_9_eval TEXT,
  line_9_classification TEXT,
  line_9_sequence TEXT,
  line_10_eval TEXT,
  line_10_classification TEXT,
  line_10_sequence TEXT,
  stockfish_json TEXT,
  pipeline_json TEXT,
  FOREIGN KEY (session_id) REFERENCES analysis_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_move_rows_session
  ON analysis_move_rows(session_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_move_rows_session_ply
  ON analysis_move_rows(session_id, ply_index);

-- Lichess bulk PGN: upload metadata, cleaned games, parsed moves

CREATE TABLE IF NOT EXISTS lichess_pgn_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'completed', 'failed')),
  range_from INTEGER,
  range_to INTEGER,
  games_in_file INTEGER,
  games_processed INTEGER NOT NULL DEFAULT 0,
  games_saved INTEGER NOT NULL DEFAULT 0,
  games_failed INTEGER NOT NULL DEFAULT 0,
  moves_saved INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lichess_pgn_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL,
  game_index INTEGER NOT NULL,
  lichess_game_id TEXT,
  pgn_metadata TEXT,
  clean_pgn TEXT NOT NULL,
  move_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'cleaned'
    CHECK (status IN ('cleaned', 'failed')),
  error_message TEXT,
  stage0_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stage0_status IN ('pending', 'running', 'completed', 'failed')),
  stage0_run_at TEXT,
  stage0_sacrifice_count INTEGER NOT NULL DEFAULT 0,
  stage0_error TEXT,
  stage1_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stage1_status IN ('pending', 'running', 'completed', 'failed')),
  stage1_run_at TEXT,
  stage1_candidate_count INTEGER NOT NULL DEFAULT 0,
  stage1_valid_count INTEGER NOT NULL DEFAULT 0,
  stage1_proceed_stage2_count INTEGER NOT NULL DEFAULT 0,
  stage1_error TEXT,
  stage2_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stage2_status IN ('pending', 'running', 'completed', 'failed')),
  stage2_run_at TEXT,
  stage2_analyzed_count INTEGER NOT NULL DEFAULT 0,
  stage2_proceed_stage3_count INTEGER NOT NULL DEFAULT 0,
  stage2_error TEXT,
  stage3_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stage3_status IN ('pending', 'running', 'completed', 'failed')),
  stage3_run_at TEXT,
  stage3_analyzed_count INTEGER NOT NULL DEFAULT 0,
  stage3_sound_count INTEGER NOT NULL DEFAULT 0,
  stage3_error TEXT,
  stage4_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (stage4_status IN ('pending', 'running', 'completed', 'failed')),
  stage4_run_at TEXT,
  stage4_analyzed_count INTEGER NOT NULL DEFAULT 0,
  stage4_brilliant_count INTEGER NOT NULL DEFAULT 0,
  stage4_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (upload_id) REFERENCES lichess_pgn_uploads(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_games_upload_game
  ON lichess_pgn_games(upload_id, game_index);

CREATE INDEX IF NOT EXISTS idx_lichess_pgn_games_upload
  ON lichess_pgn_games(upload_id);

CREATE TABLE IF NOT EXISTS lichess_pgn_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  ply_index INTEGER NOT NULL,
  move_number TEXT,
  turn TEXT,
  san_move TEXT NOT NULL,
  uci_move TEXT,
  fen_before_move TEXT,
  fen_after_move TEXT,
  FOREIGN KEY (game_id) REFERENCES lichess_pgn_games(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lichess_pgn_moves_game_ply
  ON lichess_pgn_moves(game_id, ply_index);

CREATE INDEX IF NOT EXISTS idx_lichess_pgn_moves_game
  ON lichess_pgn_moves(game_id);

-- Brilliance Engine Stage 0: board-only features per move (no engine)

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

-- Brilliance Engine Stage 1: sacrifice classification (candidates only, no engine)

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

-- Brilliance Engine Stage 2: shallow Stockfish (depth 12) on Stage 1 passers

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

-- Brilliance Engine Stage 3: deep Stockfish (d5–25 curve) on Stage 2 passers
-- All cp scores stored in white POV (+ = white better)

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

-- Brilliance Engine Stage 4: human perception model on Stage 3 passers (no engine)

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
