const { runStage0ForGame, getStage0Features } = require('./brillianceStage0Service');
const { runStage1ForGame, getStage1Features } = require('./brillianceStage1Service');
const { runStage2ForGame, getStage2Features } = require('./brillianceStage2Service');
const { runStage3ForGame, getStage3Features } = require('./brillianceStage3Service');
const { runStage4ForGame, getStage4Features } = require('./brillianceStage4Service');
const {
  clearStageTablesFrom,
  resetStageGameCounters,
  markStageEmptyComplete,
} = require('./brilliancePipelineUtils');

const runningPipelines = new Set();

async function runFullBrillianceForGame(gameId, { force = false } = {}) {
  const id = parseInt(gameId, 10);
  if (!Number.isFinite(id)) throw new Error('Invalid game id');

  if (runningPipelines.has(id)) {
    throw new Error('Brilliance pipeline already running for this game');
  }

  runningPipelines.add(id);
  try {
    if (force) {
      clearStageTablesFrom(id, 1);
      resetStageGameCounters(id, 1);
    }

    const stage0 = await runStage0ForGame(id, { force });
    const stage1 = await runStage1ForGame(id, { force: true });

    const stage2 = await runStage2ForGame(id, { force: true });

    const stage2Analyzed = stage2?.analyzed_count ?? stage2?.moves?.length ?? 0;
    if (stage2Analyzed === 0) {
      clearStageTablesFrom(id, 3);
      resetStageGameCounters(id, 3);
      markStageEmptyComplete(id, 3);
      markStageEmptyComplete(id, 4);
      return {
        stage0: { ...stage0, engine_used: false },
        stage1,
        stage2,
        stage3: getStage3Features(id),
        stage4: getStage4Features(id),
      };
    }

    const stage3 = await runStage3ForGame(id, { force: true });

    const stage3Rows = stage3?.analyzed_count ?? stage3?.moves?.length ?? 0;
    if (stage3Rows === 0) {
      clearStageTablesFrom(id, 4);
      resetStageGameCounters(id, 4);
      markStageEmptyComplete(id, 4);
      return {
        stage0: { ...stage0, engine_used: false },
        stage1,
        stage2,
        stage3,
        stage4: getStage4Features(id),
      };
    }

    const stage4 = await runStage4ForGame(id, { force: true });
    return {
      stage0: { ...stage0, engine_used: false },
      stage1,
      stage2,
      stage3,
      stage4,
    };
  } finally {
    runningPipelines.delete(id);
  }
}

module.exports = { runFullBrillianceForGame };
