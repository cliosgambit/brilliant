/**
 * Played-move classification (best / excellent / … / blunder).
 * Mirrors logic in RightSidebar linesWithPlayedStanding — keep in sync when changing rules.
 */

import { classifyMoveByCplDelta } from './moveClassification';

export function scoreTextFromAnalysisEntry(entry, turn) {
  const score = entry?.score;
  if (!score || !Number.isFinite(score.value) || (score.type !== 'cp' && score.type !== 'mate')) {
    return '+0.00';
  }
  let v = score.type === 'cp' ? score.value / 100 : score.value;
  if (turn === 'b') v = -v;
  if (score.type === 'mate') {
    return `M${Math.abs(v)}`;
  }
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function getPlayedMoveEvalDisplay(analysis, history, timeline, navIndex) {
  if (navIndex <= 0) return null;
  const current = analysis[navIndex];
  const moveUCI = history?.[navIndex - 1]?.uci;
  if (!moveUCI) return null;
  const turnOfAnalysis = timeline[navIndex - 1]?.turn;
  if (!turnOfAnalysis) return null;

  if (current?.playedMoveEval) {
    let v = current.playedMoveEval.type === 'cp' ? current.playedMoveEval.value / 100 : current.playedMoveEval.value;
    if (turnOfAnalysis === 'b') v = -v;
    return current.playedMoveEval.type === 'mate' ? `#${v}` : (v >= 0 ? '+' : '') + v.toFixed(2);
  }

  if (Array.isArray(current?.lines)) {
    const line = current.lines.find((l) => String(l?.pv || '').startsWith(moveUCI));
    if (line?.score) {
      let v = line.score.type === 'cp' ? line.score.value / 100 : line.score.value;
      if (turnOfAnalysis === 'b') v = -v;
      return line.score.type === 'mate' ? `#${v}` : (v >= 0 ? '+' : '') + v.toFixed(2);
    }
  }

  return null;
}

/**
 * Same rules as the analysis sidebar / move list: includes synthetic played line when missing from MultiPV.
 * @param {Array<{ isBook?: boolean }|null>|undefined} bookStatusByPly — index = ply after move (1-based); overrides engine class when isBook.
 * @returns {{ moveClass: string|null, standing: number|null }}
 */
export function getPlayedMoveClassAndStandingAtNavIndex(analysis, timeline, history, navIndex, bookStatusByPly) {
  if (navIndex < 1) return { moveClass: null, standing: null };
  if (bookStatusByPly?.[navIndex]?.isBook) {
    return { moveClass: 'book', standing: null };
  }
  const currentAnalysis = analysis[navIndex];
  if (!currentAnalysis) return { moveClass: null, standing: null };

  const lines = currentAnalysis.lines || [];
  const linesTurn = navIndex > 0 ? (timeline[navIndex - 1]?.turn || 'w') : 'w';
  const playedUci = history?.[navIndex - 1]?.uci || null;
  const turn = timeline[navIndex]?.turn || 'w';
  const scoreText = scoreTextFromAnalysisEntry(currentAnalysis, turn);
  const playedMoveEval = getPlayedMoveEvalDisplay(analysis, history, timeline, navIndex);

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

  const mappedRaw = (lines || []).map((line) => {
    let lv = line.score.type === 'cp' ? (line.score.value / 100) : line.score.value;
    if (linesTurn === 'b') lv = -lv;
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

  const playedInserted = !!playedUci && !mappedRaw.some((l) => l.move === playedUci);
  const displayCount = playedInserted ? 11 : 10;
  const selected = combined.slice(0, displayCount);
  const prefersLowerEval = linesTurn === 'b';

  const finiteRightEvals = selected
    .map((l) => (Number.isFinite(l.classificationWhiteEval) ? l.classificationWhiteEval : l.firstMoveWhiteEval))
    .filter((v) => Number.isFinite(v));

  const bestRightEval = finiteRightEvals.length
    ? (prefersLowerEval ? Math.min(...finiteRightEvals) : Math.max(...finiteRightEvals))
    : null;

  const classifyByDelta = (delta) => {
    if (!Number.isFinite(delta)) return null;
    return classifyMoveByCplDelta(delta);
  };

  const classified = selected.map((l, i) => {
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

  // NOTE: intentionally no "great move" tier. 'best' is the top classification.

  const playedLine = classified.find((l) => l.isPlayed);
  return {
    moveClass: playedLine?.moveClass ?? null,
    standing: playedLine?.rank ?? null,
    delta: playedLine?.deltaFromBest ?? 0.0,
  };
}

/**
 * @returns {string|null} e.g. 'best', 'book', 'blunder', or null if not classifiable yet
 */
export function classifyPlayedMoveAtNavIndex(analysis, timeline, history, navIndex, bookStatusByPly) {
  return getPlayedMoveClassAndStandingAtNavIndex(analysis, timeline, history, navIndex, bookStatusByPly).moveClass;
}
