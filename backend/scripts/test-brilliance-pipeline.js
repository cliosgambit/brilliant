/**
 * Quick pipeline smoke test for one game.
 * Usage: node scripts/test-brilliance-pipeline.js [gameId]
 */
const { getGame } = require('../services/lichessPgnService');
const { runStage0ForGame } = require('../services/brillianceStage0Service');
const { runStage1ForGame } = require('../services/brillianceStage1Service');
const { runStage2ForGame } = require('../services/brillianceStage2Service');
const { runStage3ForGame } = require('../services/brillianceStage3Service');
const { runStage4ForGame } = require('../services/brillianceStage4Service');

async function main() {
  const gameId = parseInt(process.argv[2] || '40', 10);
  const game = getGame(gameId);
  if (!game) {
    console.error('Game not found:', gameId);
    process.exit(1);
  }

  console.log('Testing game', gameId, game.original_filename, '#', game.game_index + 1);

  const s0 = await runStage0ForGame(gameId, { force: true });
  const engineCandidates = (s0.moves || []).filter(
    (m) => m.proceed_to_engine ?? m.features?.proceed_to_engine
  ).length;
  console.log(
    'Stage0:',
    s0.status,
    'moves',
    s0.moves?.length,
    'sac',
    s0.sacrifice_candidate_count,
    'engine candidates',
    engineCandidates
  );

  const s1 = await runStage1ForGame(gameId, { force: true });
  console.log('Stage1:', s1.status, 'candidates', s1.candidate_count, 'proceed S2', s1.proceed_to_stage2_count);

  const s2 = await runStage2ForGame(gameId, { force: true });
  console.log('Stage2:', s2.status, 'analyzed', s2.analyzed_count, 'proceed S3', s2.proceed_to_stage3_count);

  const s3 = await runStage3ForGame(gameId, { force: true });
  console.log('Stage3:', s3.status, 'analyzed', s3.analyzed_count, 'sound', s3.sound_count);

  const s4 = await runStage4ForGame(gameId, { force: true });
  console.log('Stage4:', s4.status, 'analyzed', s4.analyzed_count, 'brilliant', s4.brilliant_count);
  if (s4.moves?.length) {
    for (const m of s4.moves) {
      console.log(
        ' ',
        m.ply_index,
        m.san_move,
        m.classification,
        'score',
        m.brilliance_score,
        'archetype',
        m.archetype
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
