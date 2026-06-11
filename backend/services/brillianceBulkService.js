const os = require('os');
const { db } = require('../db/database');
const { runPool } = require('../utils/asyncPool');
const { runStage0ForGame } = require('./brillianceStage0Service');
const { runStage1ForGame } = require('./brillianceStage1Service');
const { runStage2ForGame } = require('./brillianceStage2Service');
const { runStage3ForGame } = require('./brillianceStage3Service');
const { runStage4ForGame } = require('./brillianceStage4Service');

const CPU_WORKERS = Math.max(
  2,
  parseInt(process.env.BRILLIANCE_CPU_WORKERS || String(Math.min(12, (os.cpus()?.length || 4) * 2)), 10) || 8
);
const STOCKFISH_WORKERS = Math.max(
  1,
  parseInt(process.env.BRILLIANCE_SF_WORKERS || String(Math.min(3, Math.max(1, Math.floor((os.cpus()?.length || 4) / 2)))), 10) || 2
);

const STAGE_PIPELINE = [
  { key: 'stage0', label: 'Stage 0 — board features', run: runStage0ForGame, workers: CPU_WORKERS, statusCol: 'stage0_status' },
  { key: 'stage1', label: 'Stage 1 — sacrifice filter', run: runStage1ForGame, workers: CPU_WORKERS, statusCol: 'stage1_status' },
  { key: 'stage2', label: 'Stage 2 — Stockfish d12', run: runStage2ForGame, workers: STOCKFISH_WORKERS, statusCol: 'stage2_status' },
  { key: 'stage3', label: 'Stage 3 — Stockfish d25', run: runStage3ForGame, workers: STOCKFISH_WORKERS, statusCol: 'stage3_status' },
  { key: 'stage4', label: 'Stage 4 — human model', run: runStage4ForGame, workers: CPU_WORKERS, statusCol: 'stage4_status' },
];

let bulkJob = null;
let cancelRequested = false;

function getAllCleanedGameRows({ uploadId = null } = {}) {
  const params = [];
  let where = `g.status = 'cleaned'`;
  if (uploadId != null && Number.isFinite(uploadId)) {
    where += ` AND g.upload_id = ?`;
    params.push(uploadId);
  }
  return db
    .prepare(
      `SELECT g.id, g.upload_id, g.game_index, u.original_filename,
              g.stage0_status, g.stage1_status, g.stage2_status, g.stage3_status, g.stage4_status
       FROM lichess_pgn_games g
       JOIN lichess_pgn_uploads u ON u.id = g.upload_id
       WHERE ${where}
       ORDER BY g.upload_id ASC, g.game_index ASC`
    )
    .all(...params);
}

function getGameIdsForBulk({ uploadId = null, force = false } = {}) {
  const rows = getAllCleanedGameRows({ uploadId });
  if (force) return rows;
  return rows.filter((r) => r.stage4_status !== 'completed');
}

function gamesNeedingStage(games, stageDef, force) {
  if (force) return games;
  return games.filter((g) => g[stageDef.statusCol] !== 'completed');
}

function initStageState(total) {
  const stages = {};
  for (const s of STAGE_PIPELINE) {
    stages[s.key] = {
      label: s.label,
      status: 'pending',
      total,
      done: 0,
      failed: 0,
      workers: s.workers,
      progress_pct: 0,
    };
  }
  return stages;
}

function computeOverallProgress(stages) {
  let sum = 0;
  for (const s of STAGE_PIPELINE) {
    const st = stages[s.key];
    if (st.status === 'skipped' || st.total === 0) {
      sum += 100 / STAGE_PIPELINE.length;
      continue;
    }
    sum += (st.done / st.total) * (100 / STAGE_PIPELINE.length);
  }
  return Math.min(100, sum);
}

function getBulkJobStatus() {
  if (!bulkJob) {
    return { status: 'idle', running: false, mode: 'by_stage' };
  }
  const progress_pct = bulkJob.stages
    ? computeOverallProgress(bulkJob.stages)
    : bulkJob.total_games > 0
      ? (bulkJob.processed / bulkJob.total_games) * 100
      : 0;

  const currentStage = bulkJob.current_stage
    ? bulkJob.stages?.[bulkJob.current_stage]
    : null;

  return {
    ...bulkJob,
    running: bulkJob.status === 'running',
    progress_pct,
    stage_progress_pct: currentStage?.progress_pct ?? 0,
    workers_cpu: CPU_WORKERS,
    workers_stockfish: STOCKFISH_WORKERS,
  };
}

function getBrillianceAnalytics({ uploadId = null } = {}) {
  const params = [];
  let where = `g.status = 'cleaned'`;
  if (uploadId != null && Number.isFinite(uploadId)) {
    where += ` AND g.upload_id = ?`;
    params.push(uploadId);
  }

  const games = db
    .prepare(
      `SELECT
         COUNT(*) AS games_total,
         SUM(CASE WHEN g.stage0_status = 'completed' THEN 1 ELSE 0 END) AS stage0_done,
         SUM(CASE WHEN g.stage1_status = 'completed' THEN 1 ELSE 0 END) AS stage1_done,
         SUM(CASE WHEN g.stage2_status = 'completed' THEN 1 ELSE 0 END) AS stage2_done,
         SUM(CASE WHEN g.stage3_status = 'completed' THEN 1 ELSE 0 END) AS stage3_done,
         SUM(CASE WHEN g.stage4_status = 'completed' THEN 1 ELSE 0 END) AS stage4_done,
         SUM(CASE WHEN g.stage4_status = 'failed' OR g.stage3_status = 'failed'
           OR g.stage2_status = 'failed' OR g.stage1_status = 'failed' OR g.stage0_status = 'failed' THEN 1 ELSE 0 END) AS pipeline_failed,
         SUM(CASE WHEN g.stage4_status = 'running' OR g.stage3_status = 'running'
           OR g.stage2_status = 'running' OR g.stage1_status = 'running' OR g.stage0_status = 'running' THEN 1 ELSE 0 END) AS pipeline_running,
         COALESCE(SUM(g.stage4_brilliant_count), 0) AS brilliant_moves_in_games
       FROM lichess_pgn_games g
       WHERE ${where}`
    )
    .get(...params);

  const moveParams = [];
  let moveWhere = `g.status = 'cleaned'`;
  if (uploadId != null && Number.isFinite(uploadId)) {
    moveWhere += ` AND g.upload_id = ?`;
    moveParams.push(uploadId);
  }

  const moveStats = db
    .prepare(
      `SELECT
         SUM(CASE WHEN s4.is_brilliant = 1 THEN 1 ELSE 0 END) AS brilliant_moves,
         SUM(CASE WHEN s4.classification = 'practical_brilliant' THEN 1 ELSE 0 END) AS practical_brilliant_moves,
         SUM(CASE WHEN s4.classification = 'great_sacrifice' THEN 1 ELSE 0 END) AS great_sacrifice_moves,
         SUM(CASE WHEN s4.classification = 'good_sacrifice' THEN 1 ELSE 0 END) AS good_sacrifice_moves,
         COUNT(s4.id) AS stage4_moves_analyzed,
         MAX(s4.brilliance_score) AS top_brilliance_score
       FROM lichess_pgn_stage4 s4
       JOIN lichess_pgn_games g ON g.id = s4.game_id
       WHERE ${moveWhere}`
    )
    .get(...moveParams);

  const pending = (games?.games_total ?? 0) - (games?.stage4_done ?? 0);

  return {
    upload_id: uploadId,
    games_total: games?.games_total ?? 0,
    stage0_done: games?.stage0_done ?? 0,
    stage1_done: games?.stage1_done ?? 0,
    stage2_done: games?.stage2_done ?? 0,
    stage3_done: games?.stage3_done ?? 0,
    stage4_done: games?.stage4_done ?? 0,
    pipeline_pending: Math.max(0, pending),
    pipeline_failed: games?.pipeline_failed ?? 0,
    pipeline_running: games?.pipeline_running ?? 0,
    brilliant_moves: moveStats?.brilliant_moves ?? 0,
    practical_brilliant_moves: moveStats?.practical_brilliant_moves ?? 0,
    great_sacrifice_moves: moveStats?.great_sacrifice_moves ?? 0,
    good_sacrifice_moves: moveStats?.good_sacrifice_moves ?? 0,
    stage4_moves_analyzed: moveStats?.stage4_moves_analyzed ?? 0,
    top_brilliance_score: moveStats?.top_brilliance_score ?? null,
    bulk_job: getBulkJobStatus(),
    workers_cpu: CPU_WORKERS,
    workers_stockfish: STOCKFISH_WORKERS,
  };
}

function listBrilliantMoves({ uploadId = null, limit = 100, offset = 0, minScore = null } = {}) {
  const params = [];
  let where = `g.status = 'cleaned' AND (s4.is_brilliant = 1 OR s4.classification IN ('BRILLIANT', 'practical_brilliant'))`;

  if (uploadId != null && Number.isFinite(uploadId)) {
    where += ` AND g.upload_id = ?`;
    params.push(uploadId);
  }

  if (minScore != null && Number.isFinite(minScore)) {
    where += ` AND s4.brilliance_score >= ?`;
    params.push(minScore);
  }

  const rows = db
    .prepare(
      `SELECT
         s4.id, s4.game_id, s4.move_id, s4.ply_index, s4.san_move, s4.turn,
         s4.sac_type, s4.archetype, s4.brilliance_score, s4.classification,
         s4.is_brilliant, s4.surprise_score, s4.player_rating,
         g.upload_id, g.game_index, g.lichess_game_id,
         u.original_filename
       FROM lichess_pgn_stage4 s4
       JOIN lichess_pgn_games g ON g.id = s4.game_id
       JOIN lichess_pgn_uploads u ON u.id = g.upload_id
       WHERE ${where}
       ORDER BY s4.is_brilliant DESC, s4.brilliance_score DESC, g.id ASC, s4.ply_index ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM lichess_pgn_stage4 s4
       JOIN lichess_pgn_games g ON g.id = s4.game_id
       WHERE ${where}`
    )
    .get(...params);

  return { moves: rows, total: totalRow?.c ?? 0 };
}

async function runStageBatch(stageDef, games, { force }) {
  const batch = gamesNeedingStage(games, stageDef, force);
  const st = bulkJob.stages[stageDef.key];
  st.total = batch.length;
  st.done = 0;
  st.failed = 0;
  st.status = batch.length === 0 ? 'skipped' : 'running';
  st.progress_pct = 0;

  if (batch.length === 0) {
    st.status = 'skipped';
    return { succeeded: 0, failed: 0 };
  }

  bulkJob.current_stage = stageDef.key;
  bulkJob.active_workers = stageDef.workers;

  const { succeeded, failed } = await runPool(
    batch,
    async (row) => {
      await stageDef.run(row.id, { force });
      return row.id;
    },
    {
      concurrency: stageDef.workers,
      shouldCancel: () => cancelRequested,
      onProgress: ({ completed, total, item, error, failed: failCount }) => {
        st.done = completed;
        st.failed = failCount;
        if (error) {
          bulkJob.errors.push({
            stage: stageDef.key,
            game_id: item?.id,
            message: error?.message || String(error),
          });
          if (bulkJob.errors.length > 100) bulkJob.errors.shift();
        }
        st.progress_pct = total > 0 ? (completed / total) * 100 : 0;
        bulkJob.progress_pct = computeOverallProgress(bulkJob.stages);
        bulkJob.current_game_label = item
          ? `${item.original_filename || 'File'} #${item.game_index + 1}`
          : null;
      },
    }
  );

  st.done = batch.length;
  st.failed = failed;
  st.status = cancelRequested ? 'cancelled' : 'completed';
  st.progress_pct = 100;

  return { succeeded, failed };
}

async function processBulkByStage({ uploadId = null, force = false } = {}) {
  const allRows = getAllCleanedGameRows({ uploadId });
  const queue = force ? allRows : allRows.filter((r) => r.stage4_status !== 'completed');

  bulkJob = {
    status: 'running',
    mode: 'by_stage',
    upload_id: uploadId,
    force,
    total_games: queue.length,
    processed_games: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    current_stage: null,
    current_game_id: null,
    current_game_label: null,
    active_workers: 0,
    stages: initStageState(queue.length),
    errors: [],
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  cancelRequested = false;

  let games = [...queue];

  for (const stageDef of STAGE_PIPELINE) {
    if (cancelRequested) break;

    await runStageBatch(stageDef, games, { force });

    if (cancelRequested) break;

    games = getAllCleanedGameRows({ uploadId }).filter((g) =>
      queue.some((q) => q.id === g.id)
    );
  }

  bulkJob.current_stage = null;
  bulkJob.current_game_label = null;
  bulkJob.active_workers = 0;
  bulkJob.processed = queue.length;

  const refreshed = getAllCleanedGameRows({ uploadId }).filter((g) => queue.some((q) => q.id === g.id));
  bulkJob.succeeded = refreshed.filter((g) => g.stage4_status === 'completed').length;
  bulkJob.failed = Math.max(0, queue.length - bulkJob.succeeded);

  bulkJob.status = cancelRequested ? 'cancelled' : 'completed';
  bulkJob.finished_at = new Date().toISOString();
  bulkJob.progress_pct = computeOverallProgress(bulkJob.stages);

  return getBulkJobStatus();
}

function startBulkBrillianceRun(options = {}) {
  if (bulkJob?.status === 'running') {
    return { started: false, error: 'Bulk brilliance run already in progress', job: getBulkJobStatus() };
  }

  cancelRequested = false;
  const queue = getGameIdsForBulk(options);

  if (queue.length === 0) {
    bulkJob = {
      status: 'completed',
      mode: 'by_stage',
      upload_id: options.uploadId ?? null,
      force: options.force ?? false,
      total_games: 0,
      stages: initStageState(0),
      message: 'All games already have Stage 4 completed',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    };
    return { started: true, job: getBulkJobStatus(), analytics: getBrillianceAnalytics({ uploadId: options.uploadId }) };
  }

  setImmediate(() => {
    processBulkByStage(options).catch((e) => {
      if (bulkJob) {
        bulkJob.status = 'failed';
        bulkJob.finished_at = new Date().toISOString();
        bulkJob.errors.push({ stage: null, game_id: null, message: e?.message || String(e) });
      }
      console.error('[brilliance][bulk]', e);
    });
  });

  bulkJob = {
    status: 'running',
    mode: 'by_stage',
    upload_id: options.uploadId ?? null,
    force: options.force ?? false,
    total_games: queue.length,
    stages: initStageState(queue.length),
    current_stage: 'stage0',
    current_game_label: 'Queued…',
    active_workers: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    started_at: new Date().toISOString(),
    finished_at: null,
  };

  return {
    started: true,
    queued: queue.length,
    mode: 'by_stage',
    workers: { cpu: CPU_WORKERS, stockfish: STOCKFISH_WORKERS },
    job: getBulkJobStatus(),
  };
}

function cancelBulkRun() {
  if (bulkJob?.status !== 'running') {
    return { cancelled: false, job: getBulkJobStatus() };
  }
  cancelRequested = true;
  return { cancelled: true, job: getBulkJobStatus() };
}

module.exports = {
  getBrillianceAnalytics,
  listBrilliantMoves,
  getBulkJobStatus,
  startBulkBrillianceRun,
  cancelBulkRun,
  getGameIdsForBulk,
  CPU_WORKERS,
  STOCKFISH_WORKERS,
};
