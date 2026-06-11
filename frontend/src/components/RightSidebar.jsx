
import React, { useMemo } from 'react';
import EvaluationGraph from './EvaluationGraph';
import MoveClassIcon from './MoveClassIcon';
import { classifyMoveByCplDelta } from '../utils/moveClassification';

function formatWhiteCpScore(cp) {
  if (cp == null || !Number.isFinite(cp)) return null;
  if (Math.abs(cp) >= 9000) {
    const mateIn = Math.max(1, 10000 - Math.abs(cp));
    const whitePositive = cp > 0;
    return {
      scoreText: `M${mateIn}`,
      advantage: whitePositive
        ? { text: 'White winning', color: 'text-emerald-500' }
        : { text: 'Black winning', color: 'text-red-500' },
    };
  }
  const pawns = cp / 100;
  return {
    scoreText: `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`,
    advantage: {
      text: pawns >= 0 ? 'White better' : 'Black better',
      color: pawns >= 0 ? 'text-emerald-500' : 'text-red-500',
    },
  };
}

function formatWhiteCpLabel(cp) {
  if (cp == null || !Number.isFinite(cp)) return '—';
  if (Math.abs(cp) >= 9000) {
    const mateIn = Math.max(1, 10000 - Math.abs(cp));
    return cp > 0 ? `+M${mateIn}` : `-M${mateIn}`;
  }
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

const RightSidebar = ({ 
  analysis, 
  navIndex, 
  turn, 
  timeline, 
  history, 
  currentMove, 
  playedMoveEval, 
  legalMovesCount, 
  bookStatus, 
  layout = 'sidebar',
  multipv = 3,
  boardWidth = 560,
  empty = false,
  stage2Move = null,
  stage3Move = null,
  stage4Move = null,
  engineEvalLoading = false,
}) => {
  const pageStack = layout === 'pageStack';

  const activeMove = stage3Move || stage2Move;
  const activeStage = stage3Move ? 3 : stage2Move ? 2 : null;

  const evalDisplay = useMemo(() => {
    if (!activeMove) return null;
    const cp = stage3Move ? stage3Move.deep_eval_cp : stage2Move?.our_score_cp;
    if (cp == null) return null;
    return formatWhiteCpScore(cp);
  }, [activeMove, stage2Move, stage3Move]);

  const stage2BestDisplay = useMemo(() => {
    if (!stage2Move || stage2Move.best_score_cp == null) return null;
    return formatWhiteCpLabel(stage2Move.best_score_cp);
  }, [stage2Move]);

  if (empty) {
    const depthLabel = stage3Move?.engine_depth
      ? `d${stage3Move.engine_depth}`
      : stage2Move?.engine_depth
        ? `d${stage2Move.engine_depth}`
        : engineEvalLoading
          ? '…'
          : '—';

    return (
      <aside
        className={
          pageStack
            ? 'w-full flex flex-col gap-4 shrink-0 lg:w-80'
            : 'w-full lg:w-80 flex flex-col gap-4 shrink-0 h-full min-h-0 lg:max-h-none'
        }
        style={!pageStack ? { height: `${boardWidth + 112}px` } : {}}
      >
        <div
          className={
            pageStack
              ? 'bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden shadow-sm'
              : 'bg-white border border-slate-200 rounded-xl flex-1 flex flex-col overflow-hidden shadow-sm'
          }
        >
          <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
            <h2 className="font-bold text-[10px] tracking-widest uppercase flex items-center gap-2">
              <i className="fas fa-microchip" aria-hidden />
              Stockfish 18
            </h2>
            <span className="text-[9px] font-bold opacity-70">{depthLabel}</span>
          </div>

          <div className="flex-1 p-4 flex flex-col gap-4 min-h-[8rem]">
            {engineEvalLoading && !activeMove ? (
              <div className="flex flex-col items-center justify-center flex-1 opacity-50 py-6">
                <i className="fas fa-spinner fa-spin text-2xl mb-2 text-indigo-600" aria-hidden />
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Running brilliance pipeline…
                </p>
              </div>
            ) : activeMove && evalDisplay ? (
              <>
                <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                      {activeMove.san_move} · ply {activeMove.ply_index}
                      {activeStage === 3 ? ' · Stage 3' : ' · Stage 2'}
                    </div>
                    <span className="text-4xl font-black text-slate-900 tracking-tight">{evalDisplay.scoreText}</span>
                  </div>
                  <span className={`text-[10px] font-bold ${evalDisplay.advantage.color} uppercase text-right`}>
                    {evalDisplay.advantage.text}
                  </span>
                </div>

                {stage3Move ? (
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Non-obvious</span>
                      <span className="font-mono font-semibold">{stage3Move.non_obvious_score ?? '—'}</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Rank d8→d22</span>
                      <span className="font-semibold">
                        {stage3Move.rank_at_depth8}→{stage3Move.rank_at_depth22}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Depth gain</span>
                      <span className="font-mono font-semibold">{stage3Move.depth_gain ?? '—'} cp</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Sound at d25</span>
                      <span className="font-semibold">{stage3Move.is_sound ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Best line</span>
                      <span className="font-semibold text-slate-800">
                        {stage2Move.best_move || '—'}
                        {stage2BestDisplay ? ` (${stage2BestDisplay})` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">CPL</span>
                      <span className="font-mono font-semibold">{stage2Move.cpl_shallow ?? '—'} cp</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Engine rank</span>
                      <span className="font-semibold">
                        {stage2Move.our_rank_in_top5 != null && stage2Move.our_rank_in_top5 < 99
                          ? `#${stage2Move.our_rank_in_top5}`
                          : 'outside top 5'}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : navIndex <= 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 opacity-40 py-6">
                <p className="text-[10px] font-bold uppercase tracking-widest italic text-slate-500">
                  Start the game to see analysis
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 opacity-40 py-6">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 text-center">
                  No engine eval for this move
                </p>
                <p className="text-[10px] text-slate-400 mt-1 text-center">Only brilliance cascade candidates</p>
              </div>
            )}
          </div>

          <div className="shrink-0 min-h-[5rem] border-t border-slate-100 bg-slate-50/50 px-4 py-3 flex flex-col justify-center gap-1">
            {stage4Move ? (
              <>
                <p className="text-[10px] text-slate-500">
                  Stage 4 · score <span className="font-bold text-slate-800">{stage4Move.brilliance_score}</span>
                  <span
                    className={`ml-1 font-semibold uppercase ${
                      stage4Move.classification === 'BRILLIANT' ? 'text-amber-700' : 'text-indigo-700'
                    }`}
                  >
                    · {stage4Move.classification}
                  </span>
                </p>
                <p className="text-[10px] text-violet-700 capitalize">
                  {(stage4Move.archetype || 'masterstroke').replace(/_/g, ' ')}
                </p>
              </>
            ) : stage3Move ? (
              <p className="text-[10px] text-slate-500">
                Stage 3 deep eval · white POV
                {stage3Move.is_rising_curve ? (
                  <span className="text-indigo-700 font-semibold"> · rising depth curve</span>
                ) : null}
                {stage3Move.classification_if_unsound ? (
                  <span className="text-amber-700 font-semibold"> · {stage3Move.classification_if_unsound}</span>
                ) : stage3Move.is_sound ? (
                  <span className="text-emerald-700 font-semibold"> · sound at d25</span>
                ) : null}
              </p>
            ) : stage2Move ? (
              <p className="text-[10px] text-slate-500">
                Stage 2 shallow eval · white POV
                {stage2Move.proceed_to_stage3 ? (
                  <span className="text-emerald-700 font-semibold"> · proceeds to Stage 3</span>
                ) : stage2Move.gate_fail_reason ? (
                  <span className="text-amber-700 font-semibold"> · {stage2Move.gate_fail_reason}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-[10px] text-slate-400">Brilliance cascade · all cp evals white POV</p>
            )}
          </div>
        </div>
      </aside>
    );
  }

  const currentAnalysis = analysis[navIndex];

  const { scoreText, advantage, depth, lines } = useMemo(() => {
    if (!currentAnalysis) {
      return { scoreText: '+0.00', advantage: { text: 'Equal', color: 'text-slate-500' }, depth: 0, lines: [] };
    }

    const { score, depth: analysisDepth, lines: analysisLines, winProbability } = currentAnalysis;

    let scoreText = '+0.00';
    let advantage = { text: 'Equal', color: 'text-slate-500' };
    let depth = Number.isFinite(analysisDepth) ? analysisDepth : 0;

    if (score && (score.type === 'cp' || score.type === 'mate') && Number.isFinite(score.value)) {
      let v = score.type === 'cp' ? score.value / 100 : score.value;
      if (turn === 'b') v = -v; // current_fen -> white perspective

      if (score.type === 'mate') {
        scoreText = `M${Math.abs(v)}`;
        if (v > 0) {
          advantage = { text: 'Winning', color: 'text-emerald-500' };
        } else if (v < 0) {
          advantage = { text: 'Losing', color: 'text-red-500' };
        } else {
          advantage = { text: 'Mate', color: 'text-slate-500' };
        }
      } else {
        scoreText = `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
        const whiteWinPctRaw = typeof winProbability?.white === 'number'
          ? winProbability.white
          : (50 + (v / 4) * 40);
        const whiteWinPct = Math.max(0, Math.min(100, whiteWinPctRaw));
        const blackWinPct = 100 - whiteWinPct;
        advantage = {
          text: `W ${whiteWinPct.toFixed(1)}% | B ${blackWinPct.toFixed(1)}%`,
          color: v >= 0 ? 'text-emerald-500' : 'text-red-500'
        };
      }
    }

    return { scoreText, advantage, depth, lines: analysisLines || [] };
  }, [currentAnalysis, turn]);

  // previous_fen side-to-move is exactly the played move color.
  // Using currentMove.color avoids transient timeline/turn mismatches.
  const linesTurn = currentMove?.color || (navIndex > 0
    ? (timeline[navIndex - 1]?.turn || turn)
    : turn);
  const playedUci = currentMove?.uci || null;

  const linesWithPlayedStanding = useMemo(() => {
    const mateDistanceToClassificationScore = (mateDistance) => {
      if (!Number.isFinite(mateDistance)) return 999;
      const normalized = Math.max(1, Math.abs(Math.trunc(mateDistance)));
      if (normalized <= 10) return (11 - normalized) * 1000;
      return 999;
    };

    const toClassificationWhiteEval = (scoreObj, turnForScore) => {
      if (!scoreObj || !Number.isFinite(scoreObj.value)) return null;
      if (scoreObj.type === 'cp') {
        let pawns = scoreObj.value / 100;
        if (turnForScore === 'b') pawns = -pawns;
        return pawns;
      }
      if (scoreObj.type === 'mate') {
        const sign = Math.sign(scoreObj.value);
        if (sign === 0) return 0;
        const mapped = mateDistanceToClassificationScore(scoreObj.value);
        const whiteSigned = turnForScore === 'b' ? -sign : sign;
        return whiteSigned * mapped;
      }
      return null;
    };

    const formatScoreForTurn = (scoreObj, turnForScore) => {
      if (!scoreObj || !Number.isFinite(scoreObj.value)) return null;
      let v = scoreObj.type === 'cp' ? (scoreObj.value / 100) : scoreObj.value;
      if (turnForScore === 'b') v = -v;
      return scoreObj.type === 'cp'
        ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}`
        : `#${v}`;
    };

    const toWhiteEval = (scoreObj, turnForScore) => {
      if (!scoreObj || !Number.isFinite(scoreObj.value)) return null;
      let v = scoreObj.type === 'cp' ? (scoreObj.value / 100) : scoreObj.value;
      if (turnForScore === 'b') v = -v;
      return v;
    };

    const parseEvalMeta = (score) => {
      if (!score) return { whiteEval: null, classificationWhiteEval: null, isMate: false, mateDistance: null };
      const s = String(score).trim().toUpperCase();
      if (!s) return { whiteEval: null, classificationWhiteEval: null, isMate: false, mateDistance: null };
      if (s.startsWith('#') || s.startsWith('M')) {
        const mv = parseFloat(s.slice(1));
        if (!Number.isFinite(mv)) return { whiteEval: null, classificationWhiteEval: null, isMate: true, mateDistance: null };
        const sign = Math.sign(mv);
        const abs = Math.abs(mv);
        const mapped = sign === 0 ? 0 : sign * mateDistanceToClassificationScore(abs);
        return { whiteEval: mv, classificationWhiteEval: mapped, isMate: true, mateDistance: abs };
      }
      const cp = parseFloat(s);
      return {
        whiteEval: Number.isFinite(cp) ? cp : null,
        classificationWhiteEval: Number.isFinite(cp) ? cp : null,
        isMate: false,
        mateDistance: null,
      };
    };

    const getPositionBestEvalWhiteAtIndex = (positionIdx) => {
      if (positionIdx < 0 || positionIdx >= analysis.length || positionIdx >= timeline.length) return null;
      const data = analysis[positionIdx];
      const turnForPosition = timeline[positionIdx]?.turn;
      return toWhiteEval(data?.score, turnForPosition);
    };

    const getPlayedMoveWhiteEvalAtIndex = (moveIdx) => {
      if (moveIdx <= 0) return null;
      const data = analysis[moveIdx];
      const moveUci = history?.[moveIdx - 1]?.uci;
      const turnBeforeMove = timeline[moveIdx - 1]?.turn;
      if (!data || !moveUci || !turnBeforeMove) return null;

      if (data.playedMoveEval) {
        return toWhiteEval(data.playedMoveEval, turnBeforeMove);
      }

      if (Array.isArray(data.lines)) {
        const line = data.lines.find((l) => String(l?.pv || '').startsWith(moveUci));
        if (line?.score) return toWhiteEval(line.score, turnBeforeMove);
      }

      return null;
    };

    const mappedRaw = (lines || []).map((line, i) => {
      let lv = line.score.type === 'cp' ? (line.score.value / 100) : line.score.value;
      if (linesTurn === 'b') lv = -lv; // previous_fen lines -> white perspective
      const formattedScore = line.score.type === 'cp'
        ? `${lv >= 0 ? '+' : ''}${lv.toFixed(2)}`
        : `#${lv}`;
      const rankScore = line.firstMoveScore || line.score;
      const firstMoveTurn = linesTurn === 'w' ? 'b' : 'w';
      const firstMoveFormattedScore = formatScoreForTurn(line.firstMoveScore, firstMoveTurn) || formatScoreForTurn(line.score, linesTurn);
      const move = line?.pv?.split(' ')?.[0] || '';
      let rankWhiteEval = rankScore.type === 'cp' ? (rankScore.value / 100) : rankScore.value;
      let lineWhiteEval = line.score.type === 'cp' ? (line.score.value / 100) : line.score.value;
      if (linesTurn === 'b') lineWhiteEval = -lineWhiteEval;
      let firstMoveWhiteEval = null;
      let rankClassificationWhiteEval = Number.isFinite(line.classificationWhiteEval)
        ? line.classificationWhiteEval
        : null;
      if (line.firstMoveScore) {
        firstMoveWhiteEval = line.firstMoveScore.type === 'cp'
          ? (line.firstMoveScore.value / 100)
          : line.firstMoveScore.value;
        // firstMoveScore is from post-move FEN where side-to-move is opposite of linesTurn.
        if (firstMoveTurn === 'b') firstMoveWhiteEval = -firstMoveWhiteEval;
        if (!Number.isFinite(rankClassificationWhiteEval)) {
          rankClassificationWhiteEval = toClassificationWhiteEval(line.firstMoveScore, firstMoveTurn);
        }
      } else {
        firstMoveWhiteEval = lineWhiteEval;
        if (!Number.isFinite(rankClassificationWhiteEval)) {
          rankClassificationWhiteEval = toClassificationWhiteEval(line.score, linesTurn);
        }
      }
      if (!Number.isFinite(rankWhiteEval) && Number.isFinite(firstMoveWhiteEval)) rankWhiteEval = firstMoveWhiteEval;
      const moverEval = Number.isFinite(rankWhiteEval)
        ? (linesTurn === 'w' ? (rankClassificationWhiteEval ?? rankWhiteEval) : -(rankClassificationWhiteEval ?? rankWhiteEval))
        : -Infinity;

      return {
        ...line,
        move,
        isPlayed: !!playedUci && move === playedUci,
        formattedScore,
        firstMoveFormattedScore,
        lineWhiteEval,
        firstMoveWhiteEval,
        whiteEval: rankWhiteEval,
        classificationWhiteEval: rankClassificationWhiteEval,
        moverEval,
        isMate: rankScore.type === 'mate',
        mateDistance: rankScore.type === 'mate' ? Math.abs(rankWhiteEval) : null,
        source: 'engine',
      };
    });

    // Deduplicate by move, keep best mover-eval candidate.
    const moveMap = new Map();
    for (const item of mappedRaw) {
      const key = item.move;
      if (!key) continue;
      const prev = moveMap.get(key);
      if (!prev || item.moverEval > prev.moverEval) {
        moveMap.set(key, item);
      }
    }
    let combined = [...moveMap.values()];

    if (playedUci && navIndex > 0 && !combined.some((l) => l.move === playedUci)) {
      const parsed = parseEvalMeta(playedMoveEval || scoreText || 'N/A');
      const whiteEval = parsed.whiteEval;
      const classificationWhiteEval = parsed.classificationWhiteEval;
      combined.push({
        pv: playedUci,
        move: playedUci,
        isPlayed: true,
        formattedScore: playedMoveEval || scoreText || 'N/A',
        firstMoveFormattedScore: playedMoveEval || scoreText || 'N/A',
        lineWhiteEval: whiteEval,
        firstMoveWhiteEval: whiteEval,
        whiteEval,
        classificationWhiteEval,
        moverEval: Number.isFinite(classificationWhiteEval ?? whiteEval)
          ? (linesTurn === 'w' ? (classificationWhiteEval ?? whiteEval) : -(classificationWhiteEval ?? whiteEval))
          : -Infinity,
        isMate: parsed.isMate,
        mateDistance: parsed.mateDistance,
        source: 'played',
      });
    }

    combined.sort((a, b) => {
      if (b.moverEval !== a.moverEval) return b.moverEval - a.moverEval;
      const aW = Number.isFinite(a.whiteEval) ? a.whiteEval : -Infinity;
      const bW = Number.isFinite(b.whiteEval) ? b.whiteEval : -Infinity;
      return bW - aW;
    });

    // Strictly show top 3 moves as requested.
    const selected = combined.slice(0, 3);
    const prefersLowerEval = linesTurn === 'b';

    const finiteRightEvals = selected
      .map((l) => (Number.isFinite(l.classificationWhiteEval) ? l.classificationWhiteEval : l.firstMoveWhiteEval))
      .filter((v) => Number.isFinite(v));

    const bestRightEval = finiteRightEvals.length
      ? (prefersLowerEval ? Math.min(...finiteRightEvals) : Math.max(...finiteRightEvals))
      : null;

    const classifyByDelta = (delta) => classifyMoveByCplDelta(delta);

    let classified = selected.map((l, i) => {
      const lineClassificationEval = Number.isFinite(l.classificationWhiteEval) ? l.classificationWhiteEval : l.firstMoveWhiteEval;
      const deltaFromBest = Number.isFinite(lineClassificationEval) && Number.isFinite(bestRightEval)
        ? (prefersLowerEval ? (lineClassificationEval - bestRightEval) : (bestRightEval - lineClassificationEval))
        : null;
      const moveClass = classifyByDelta(deltaFromBest);
      return {
        ...l,
        rank: i + 1,
        deltaFromBest,
        moveClass,
        isBestMove: moveClass === 'best',
      };
    });

    if (bookStatus?.isBook && navIndex > 0) {
      classified = classified.map((line) =>
        line.isPlayed
          ? { ...line, moveClass: 'book', isBestMove: false, deltaFromBest: null }
          : line
      );
    }

    return classified;
  }, [analysis, history, lines, linesTurn, navIndex, playedUci, playedMoveEval, scoreText, timeline, bookStatus]);

  const playedStanding = linesWithPlayedStanding.find((line) => line.isPlayed)?.rank ?? null;

  const finalClassification = useMemo(() => {
    if (navIndex === 0) return null;
    return linesWithPlayedStanding.find((line) => line.isPlayed)?.moveClass || null;
  }, [navIndex, linesWithPlayedStanding]);

  return (
    <aside
      className={
        pageStack
          ? 'w-full flex flex-col gap-4 shrink-0 lg:w-80'
          : 'w-full lg:w-80 flex flex-col gap-4 shrink-0 h-full min-h-0 lg:max-h-none'
      }
      style={!pageStack ? { height: `${boardWidth + 112}px` } : {}}
    >
      <div
        className={
          pageStack
            ? 'bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden shadow-sm'
            : 'bg-white border border-slate-200 rounded-xl flex-1 flex flex-col overflow-hidden shadow-sm'
        }
      >
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center shrink-0">
          <h2 className="font-bold text-[10px] tracking-widest uppercase flex items-center gap-2">
            <i className="fas fa-microchip"></i> Stockfish 18
          </h2>
          <span className="text-[9px] font-bold opacity-70">200ms</span>
        </div>
        <div
          className={
            pageStack
              ? 'p-4 flex flex-col gap-4 custom-scrollbar'
              : 'flex-1 overflow-y-auto p-4 flex flex-col gap-4 custom-scrollbar'
          }
        >
          <div className="flex items-baseline justify-between border-b border-white pb-3">
            <div className="flex items-center gap-2">
              <span className="text-4xl font-black text-slate-900 tracking-tight">{scoreText}</span>
              {finalClassification && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 shadow-sm">
                  <MoveClassIcon moveClass={finalClassification} className="text-xs" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    {finalClassification}
                  </span>
                </div>
              )}
            </div>
            <span className={`text-[10px] font-bold ${advantage.color} uppercase text-right`}>{advantage.text}</span>
          </div>
          <div className="flex-1 space-y-2 border border-slate-200 rounded-xl p-3 flex flex-col min-h-0">
            <h3 className="text-sm font-bold mb-1 shrink-0">Best Lines</h3>
            <p className="text-[10px] text-slate-500 mb-2 shrink-0">
              {navIndex > 0 ? (
                <>
                  Played standing: <span className="font-bold text-slate-700">{playedStanding ? `#${playedStanding}` : 'N/A'}</span>
                  {' '}of <span className="font-bold text-slate-700">{legalMovesCount ?? 0}</span> legal moves
                </>
              ) : (
                "Lines will appear after the first move"
              )}
            </p>
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
              {navIndex > 0 ? (
                linesWithPlayedStanding.length > 0 ? (
                  linesWithPlayedStanding.map((line, i) => {
                    const rowClass = line.isPlayed
                      ? 'h-12 px-3 rounded-xl bg-amber-50 border border-amber-300 flex items-center gap-2 group cursor-pointer hover:bg-amber-100 transition-colors duration-150 min-w-0 shadow-sm shrink-0'
                      : 'h-12 px-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2 group cursor-pointer hover:bg-slate-100 transition-colors duration-150 min-w-0 shrink-0';
                    const lineEvalClass = line.isPlayed
                      ? 'text-[11px] font-black text-amber-800 shrink-0'
                      : 'text-[11px] font-black text-slate-800 shrink-0';
                    const pvClass = line.isPlayed
                      ? 'text-[11px] font-mono text-amber-900/85 truncate flex-1 min-w-0'
                      : 'text-[11px] font-mono text-slate-600 truncate flex-1 min-w-0';
                    const firstMoveClass = line.isPlayed
                      ? 'text-[11px] font-black text-amber-700 shrink-0'
                      : 'text-[11px] font-black text-indigo-700 shrink-0';

                    return (
                      <div key={i} className={rowClass}>
                        <MoveClassIcon moveClass={line.moveClass} className="text-[12px] font-black" />
                        <span className="text-[11px] font-bold text-slate-300 shrink-0">|</span>
                        <span className={lineEvalClass}>
                          {line.formattedScore}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400 shrink-0">:</span>
                        <span className={pvClass}>
                          {line.pv}
                          {line.isPlayed ? ` (played #${line.rank})` : ` (#${line.rank})`}
                        </span>
                        <span className="text-[11px] font-bold text-slate-400 shrink-0">|</span>
                        <span className={firstMoveClass}>
                          {line.firstMoveFormattedScore || 'N/A'}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 opacity-40">
                    <i className="fas fa-spinner fa-spin text-2xl mb-2 text-indigo-600"></i>
                    <p className="text-[10px] font-bold uppercase tracking-widest">Calculating Lines...</p>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full opacity-40">
                  <p className="text-[10px] font-bold uppercase tracking-widest italic">Start the game to see analysis</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="pb-4 px-4 border-t border-white bg-slate-50/50 shrink-0">
          <EvaluationGraph analysis={analysis} timeline={timeline} navIndex={navIndex} />
        </div>
      </div>
    </aside>
  );
};

export default RightSidebar;
