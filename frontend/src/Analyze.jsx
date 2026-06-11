import React, { useCallback, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'react-router-dom';
import { useChessGame, countLegalMovesAtPly } from './hooks/useChessGame';
import { API_BASE } from './config/api';
import { ANALYSIS_ROW_CELL_KEYS } from './utils/analysisDbRowKeys';
import { EXPORT_HEADERS } from './utils/analysisExportHeaders';
import Header from './components/Header';
import LeftSidebar from './components/LeftSidebar';
import RightSidebar from './components/RightSidebar';
import GameControls from './components/GameControls';
import EvaluationBar from './components/EvaluationBar';
import PlayerBadge from './components/PlayerBadge';
import DataPipelineTable from './components/DataPipelineTable';
import { Chessboard } from 'react-chessboard';
import { getPlayedMoveClassAndStandingAtNavIndex } from './utils/playedMoveClassification';
import { classifyMoveByCplDelta } from './utils/moveClassification';
import { ensurePipelineSlotsForExport } from './utils/ensurePipelineForExport';

const AnalyzePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionQuery = searchParams.get('session');
  const {
    position,
    selected,
    targets,
    turn,
    history,
    timeline,
    navIndex,
    setNavIndex,
    whiteAI,
    setWhiteAI,
    blackAI,
    setBlackAI,
    orientation,
    setOrientation,
    analysis,
    boardWidth,
    boardContainerRef,
    onSquareClick,
    onPieceDrop,
    resetBoard,
    loadPGN,
    evalPercent,
    displayScore,
    currentTurn,
    currentFEN,
    fenAtMove,
    currentMove,
    bestMove,
    winPercent,
    bestMovesList,
    prevEval,
    playedMoveEval,
    legalMovesCount,
    bookStatusByPly,
    firstNonBookPly,
    analysisProgress,
    pipelineData,
    mergePipelineDataAtIndex,
    mergePipelineSlots,
    analysisSessionId,
    restoreSessionFromDb,
    moveClassifications,
    multipv,
    pgnMetadata,
  } = useChessGame({ multipv: 3 });

  const whitePlayer = pgnMetadata?.White;
  const whiteRating = pgnMetadata?.WhiteElo;
  const blackPlayer = pgnMetadata?.Black;
  const blackRating = pgnMetadata?.BlackElo;

  // Find clock for the player whose turn it JUST WAS (the move that just happened)
  // or the player whose turn it IS (if we want to show their last known clock).
  // Standard is to show last known clock for both.
  
  const getLatestClock = (color) => {
    for (let i = navIndex - 1; i >= 0; i--) {
      if (history[i]?.color === color && history[i]?.clock) {
        return history[i].clock;
      }
    }
    return null;
  };

  const topPlayer = orientation === 'white' 
    ? { name: blackPlayer || 'Black', rating: blackRating, color: 'b', clock: getLatestClock('b') } 
    : { name: whitePlayer || 'White', rating: whiteRating, color: 'w', clock: getLatestClock('w') };
  
  const bottomPlayer = orientation === 'white' 
    ? { name: whitePlayer || 'White', rating: whiteRating, color: 'w', clock: getLatestClock('w') } 
    : { name: blackPlayer || 'Black', rating: blackRating, color: 'b', clock: getLatestClock('b') };

  useEffect(() => {
    if (!sessionQuery) return undefined;
    const sid = Number(sessionQuery);
    if (!Number.isFinite(sid)) return undefined;
    let cancelled = false;
    restoreSessionFromDb(sid).then((ok) => {
      if (cancelled || !ok) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('session');
          return next;
        },
        { replace: true }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [sessionQuery, restoreSessionFromDb, setSearchParams]);

  const mateDistanceToClassificationScore = useCallback((mateDistance) => {
    if (!Number.isFinite(mateDistance)) return 999;
    const normalized = Math.max(1, Math.abs(Math.trunc(mateDistance)));
    if (normalized <= 10) return (11 - normalized) * 1000;
    return 999;
  }, []);

  const normalizeScoreObject = useCallback((scoreObj) => {
    if (!scoreObj) return null;
    const rawType = String(scoreObj.type || '').toLowerCase();
    if (rawType !== 'cp' && rawType !== 'mate') return null;
    const numericValue = Number(scoreObj.value);
    if (!Number.isFinite(numericValue)) return null;
    return { type: rawType, value: numericValue };
  }, []);

  const toClassificationWhiteEval = useCallback((scoreObj, turnForScore) => {
    const normalizedScore = normalizeScoreObject(scoreObj);
    if (!normalizedScore) return null;
    if (normalizedScore.type === 'cp') {
      let pawns = normalizedScore.value / 100;
      if (turnForScore === 'b') pawns = -pawns;
      return pawns;
    }
    if (normalizedScore.type === 'mate') {
      const sign = Math.sign(normalizedScore.value);
      if (sign === 0) return 0;
      const mapped = mateDistanceToClassificationScore(normalizedScore.value);
      const whiteSigned = turnForScore === 'b' ? -sign : sign;
      return whiteSigned * mapped;
    }
    return null;
  }, [mateDistanceToClassificationScore, normalizeScoreObject]);

  const formatRawEngineScore = useCallback((pick, lineTurn) => {
    if (!pick || !Number.isFinite(Number(pick.value))) return null;
    const t = String(pick.type || '').toLowerCase();
    if (t !== 'cp' && t !== 'mate') return null;
    let val = t === 'cp' ? Number(pick.value) / 100 : Number(pick.value);
    if (lineTurn === 'b') val = -val;
    return t === 'mate' ? `#${val}` : (val >= 0 ? '+' : '') + val.toFixed(2);
  }, []);

  const formatLineScoreForExport = useCallback((line, lineTurn) => {
    const normalizedScore = normalizeScoreObject(line?.score) || normalizeScoreObject(line?.firstMoveScore);
    if (normalizedScore) {
      let val = normalizedScore.type === 'cp' ? normalizedScore.value / 100 : normalizedScore.value;
      if (lineTurn === 'b') val = -val;
      return normalizedScore.type === 'mate' ? `#${val}` : (val >= 0 ? '+' : '') + val.toFixed(2);
    }
    if (line?.firstMoveScore) {
      const s = formatRawEngineScore(line.firstMoveScore, lineTurn);
      if (s) return s;
    }
    if (line?.score) {
      const s = formatRawEngineScore(line.score, lineTurn);
      if (s) return s;
    }
    return 'N/A';
  }, [formatRawEngineScore, normalizeScoreObject]);

  const getLineClassificationWhiteEval = useCallback((line, lineTurn) => {
    if (!line || !lineTurn) return null;
    const direct = line.classificationWhiteEval;
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    if (direct != null && direct !== '' && Number.isFinite(Number(direct))) return Number(direct);

    const firstMoveTurn = lineTurn === 'w' ? 'b' : 'w';
    const normalizedFirstMove = normalizeScoreObject(line?.firstMoveScore);
    const normalizedLine = normalizeScoreObject(line?.score);
    const scoreObj = normalizedFirstMove || normalizedLine;
    const scoreTurn = normalizedFirstMove ? firstMoveTurn : lineTurn;
    const fromScores = toClassificationWhiteEval(scoreObj, scoreTurn);
    if (Number.isFinite(fromScores)) return fromScores;

    // Match RightSidebar: use white-perspective eval when mapped classification is unavailable.
    let lineWhiteEval = null;
    if (line.score && Number.isFinite(Number(line.score.value))) {
      const t = String(line.score.type || '').toLowerCase();
      if (t === 'cp' || t === 'mate') {
        let v = t === 'cp' ? line.score.value / 100 : line.score.value;
        if (lineTurn === 'b') v = -v;
        lineWhiteEval = v;
      }
    }
    let firstMoveWhiteEval = null;
    if (line.firstMoveScore && Number.isFinite(Number(line.firstMoveScore.value))) {
      const t = String(line.firstMoveScore.type || '').toLowerCase();
      if (t === 'cp' || t === 'mate') {
        let v = t === 'cp' ? line.firstMoveScore.value / 100 : line.firstMoveScore.value;
        if (firstMoveTurn === 'b') v = -v;
        firstMoveWhiteEval = v;
      }
    } else if (Number.isFinite(lineWhiteEval)) {
      firstMoveWhiteEval = lineWhiteEval;
    }
    return Number.isFinite(firstMoveWhiteEval)
      ? firstMoveWhiteEval
      : (Number.isFinite(lineWhiteEval) ? lineWhiteEval : null);
  }, [normalizeScoreObject, toClassificationWhiteEval]);

  const classifyByDelta = useCallback((delta) => classifyMoveByCplDelta(delta), []);

  const getLineClassificationLabels = useCallback((data, lineTurn) => {
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) return [];

    const prefersLowerEval = lineTurn === 'b';

    const evals = data.lines.map((line) => getLineClassificationWhiteEval(line, lineTurn));

    const finiteEvals = evals.filter((v) => Number.isFinite(v));
    if (finiteEvals.length === 0) return evals.map(() => 'N/A');

    const bestEval = prefersLowerEval ? Math.min(...finiteEvals) : Math.max(...finiteEvals);
    return evals.map((evalVal) => {
      if (!Number.isFinite(evalVal)) return 'N/A';
      const deltaFromBest = prefersLowerEval
        ? (evalVal - bestEval)
        : (bestEval - evalVal);
      return classifyByDelta(deltaFromBest) || 'N/A';
    });
  }, [classifyByDelta, getLineClassificationWhiteEval]);

  const positionToFENExport = useCallback((pos, t, cr, epSq) => {
    const rows = [8, 7, 6, 5, 4, 3, 2, 1].map((r) => {
      let empty = 0;
      let rowStr = '';
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach((f) => {
        const p = pos[f + r];
        if (!p) empty++;
        else {
          if (empty > 0) { rowStr += empty; empty = 0; }
          const type = p[1];
          const letter = ({ P: 'P', N: 'N', B: 'B', R: 'R', Q: 'Q', K: 'K' })[type];
          rowStr += p[0] === 'w' ? letter : letter.toLowerCase();
        }
      });
      if (empty > 0) rowStr += empty;
      return rowStr;
    });
    const board = rows.join('/');
    const turnStr = t === 'w' ? 'w' : 'b';
    let castlingStr = '';
    if (cr && typeof cr === 'object') {
      if (cr.wK) castlingStr += 'K';
      if (cr.wQ) castlingStr += 'Q';
      if (cr.bK) castlingStr += 'k';
      if (cr.bQ) castlingStr += 'q';
    }
    if (!castlingStr) castlingStr = '-';
    const ep = epSq == null || epSq === '' ? '-' : epSq;
    return `${board} ${turnStr} ${castlingStr} ${ep} 0 1`;
  }, []);

  const buildExportRowAtIndex = useCallback((idx, pipelineRows) => {
    const entry = timeline[idx];
    if (!entry) return null;

    const moveData = history[idx - 1] || { san: 'Starting Position', color: 'w', uci: '-' };
    const moveNumber = Math.floor((idx + 1) / 2);
    const actualTurn = idx === 0 ? 'w' : (history[idx - 1].color);

    const data = analysis[idx];
    const targetIdx = idx > 0 ? idx - 1 : 0;
    const rows = pipelineRows ?? pipelineData;
    const pipe = rows[targetIdx]?.tables || {};

    const rowFenAfter = positionToFENExport(entry.position, entry.turn, entry.castling, entry.enPassantTarget);
    const rowFenBefore = idx > 0
      ? positionToFENExport(timeline[idx - 1].position, timeline[idx - 1].turn, timeline[idx - 1].castling, timeline[idx - 1].enPassantTarget)
      : rowFenAfter;

    let playedEvalStr = '0.00';
    let playedMoveClass = 'N/A';
    let playedMoveStanding = 'N/A';
    let evalBeforeMove = '0.00';
    let delta = '0.00';
    let bestLineDelta = 'N/A';
    let winPctStr = '50.0%';

    if (data) {
      const turnOfAnalysis = entry.turn;

      const moveUCI = history[idx - 1]?.uci;
      let pEval = null;
      if (moveUCI) {
        if (data?.playedMoveEval) {
          const pme = data.playedMoveEval;
          let val = pme.type === 'cp' ? pme.value / 100 : pme.value;
          if (timeline[idx - 1].turn === 'b') val = -val;
          pEval = pme.type === 'mate' ? `#${val}` : (val >= 0 ? '+' : '') + val.toFixed(2);
        } else if (data?.lines) {
          const line = data.lines.find((l) => l.pv.startsWith(moveUCI));
          if (line) {
            let val = line.score.type === 'cp' ? line.score.value / 100 : line.score.value;
            if (timeline[idx - 1].turn === 'b') val = -val;
            pEval = line.score.type === 'mate' ? `#${val}` : (val >= 0 ? '+' : '') + val.toFixed(2);
          }
        }
      }

      playedEvalStr = pEval || (data.score ? (data.score.type === 'cp' ? (data.score.value / 100 * (turnOfAnalysis === 'b' ? -1 : 1)).toFixed(2) : `#${data.score.value}`) : '0.00');

      if (idx > 0 && analysis[idx - 1]?.score) {
        const sBefore = analysis[idx - 1].score;
        const tBefore = timeline[idx - 1].turn;
        let vBefore = sBefore.type === 'cp' ? sBefore.value / 100 : sBefore.value;
        if (tBefore === 'b') vBefore = -vBefore;
        evalBeforeMove = sBefore.type === 'mate' ? `#${vBefore}` : (vBefore >= 0 ? '+' : '') + vBefore.toFixed(2);
      }

      if (typeof data?.winProbability?.white === 'number' && Number.isFinite(data.winProbability.white)) {
        winPctStr = `${Math.max(0, Math.min(100, data.winProbability.white)).toFixed(1)}%`;
      } else if (data.score) {
        const s = data.score;
        let v = s.type === 'cp' ? s.value / 100 : s.value;
        if (turnOfAnalysis === 'b') v = -v;
        let winPct;
        if (s.type === 'mate') {
          winPct = v > 0 ? 100 : 0;
        } else {
          winPct = (1 / (1 + Math.pow(10, -v * 100 / 400))) * 100;
        }
        winPctStr = winPct.toFixed(1) + '%';
      }
    }

    const cNum = parseFloat(playedEvalStr.replace('#', '100')) || 0;
    const pNum = parseFloat(evalBeforeMove.replace('#', '100')) || 0;
    delta = (cNum - pNum).toFixed(2);

    const altData = data;
    // Side to move at previous_fen (same as MultiPV / RightSidebar): timeline[idx-1].turn for move rows.
    const rawLineTurn =
      idx > 0
        ? (timeline[idx - 1]?.turn || history[idx - 1]?.color || 'w')
        : (timeline[0]?.turn || 'w');
    const lineTurn = rawLineTurn === 'b' ? 'b' : 'w';
    if (idx > 0 && history[idx - 1]?.uci) {
      const playedMeta = getPlayedMoveClassAndStandingAtNavIndex(analysis, timeline, history, idx, bookStatusByPly);
      playedMoveClass = playedMeta.moveClass || 'N/A';
      playedMoveStanding = Number.isFinite(playedMeta.standing) ? `#${playedMeta.standing}` : 'N/A';
    }

    const lines = Array.isArray(altData?.lines) ? altData.lines : [];
    const bestLineScoreText = lines[0] ? formatLineScoreForExport(lines[0], lineTurn) : null;
    const playedCp = String(playedEvalStr || '').trim().startsWith('#') ? null : parseFloat(playedEvalStr);
    const bestCp = bestLineScoreText && !String(bestLineScoreText).trim().toUpperCase().startsWith('M') && !String(bestLineScoreText).trim().startsWith('#')
      ? parseFloat(bestLineScoreText)
      : null;
    if (Number.isFinite(playedCp) && Number.isFinite(bestCp)) {
      bestLineDelta = (playedCp - bestCp).toFixed(2);
    }
    const alternatives = lines.length
      ? lines.map((l) => {
          const lScore = formatLineScoreForExport(l, lineTurn);
          const firstMove = l?.pv?.split(' ')?.[0] || 'N/A';
          return `${firstMove} (${lScore})`;
        }).join('; ')
      : 'N/A';

    const multiPVDetails = [];
    const lineClassifications = getLineClassificationLabels({ lines }, lineTurn);
    for (let i = 0; i < 10; i++) {
      const line = lines[i];
      if (line) {
        const lScore = formatLineScoreForExport(line, lineTurn);
        const cls = lineClassifications[i];
        multiPVDetails.push(
          lScore, 
          cls != null && cls !== '' ? cls : 'N/A', 
          line?.pv ? String(line.pv) : 'N/A'
        );
      } else {
        multiPVDetails.push('N/A', 'N/A', 'N/A');
      }
    }

    const baseInfo = [
      idx === 0 ? 0 : moveNumber,
      idx === 0 ? '-' : (actualTurn === 'w' ? 'White' : 'Black'),
      idx === 0 ? 'Start' : moveData.san,
      idx === 0 ? '-' : moveData.uci,
      idx === 0 ? '-' : (moveData.clock || 'N/A'),
      idx === 0 ? 'N/A' : playedMoveClass,
      idx === 0 ? 'N/A' : playedMoveStanding,
      playedEvalStr,
      evalBeforeMove,
      delta,
      bestLineDelta,
      winPctStr,
      rowFenBefore,
      rowFenAfter,
      countLegalMovesAtPly(timeline, idx),
      alternatives,
      pipe.t11?.captures?.join('; ') || 'None',
    ];

    const pipelineInfo = [
      pipe.t1?.derived?.game_phase || 'N/A',
      pipe.t2?.density || 'N/A',
      pipe.t2?.spatial_dominance?.white || '0',
      pipe.t2?.spatial_dominance?.black || '0',
      pipe.t3?.white || '0',
      pipe.t3?.black || '0',
      pipe.t3?.advantage || '0',
      pipe.t3?.simplification || 'N/A',
      pipe.t4?.hanging?.join('; ') || 'None',
      pipe.t4?.loose?.join('; ') || 'None',
      pipe.t5?.white?.attack_intensity || '0',
      pipe.t5?.white?.exposure || 'N/A',
      pipe.t5?.black?.attack_intensity || '0',
      pipe.t5?.black?.exposure || 'N/A',
      pipe.t5?.white?.mobility || '0',
      pipe.t5?.black?.mobility || '0',
      pipe.t6?.white?.islands || '0',
      pipe.t6?.white?.doubled?.length || '0',
      pipe.t6?.black?.islands || '0',
      pipe.t6?.black?.doubled?.length || '0',
      pipe.t7?.white?.avg_mobility || '0',
      pipe.t7?.black?.avg_mobility || '0',
      pipe.t7?.white?.freedom || 'N/A',
      pipe.t7?.black?.freedom || 'N/A',
      pipe.t8?.white_controlled || '0',
      pipe.t8?.black_controlled || '0',
      pipe.t8?.ratio || '1.0',
      pipe.t9?.pins?.join('; ') || 'None',
      pipe.t9?.forks?.join('; ') || 'None',
      pipe.t13?.endgame_proximity || 'N/A',
      pipe.t15?.white?.practical_risk || 'N/A',
      pipe.t15?.black?.practical_risk || 'N/A',
      pipe.t16?.overall || 'N/A',
      pipe.t16?.winning_plan || 'N/A',
    ];

    return [...baseInfo, ...pipelineInfo, ...multiPVDetails];
  }, [
    timeline,
    history,
    analysis,
    pipelineData,
    getLineClassificationLabels,
    formatLineScoreForExport,
    positionToFENExport,
    bookStatusByPly,
  ]);

  const persistedPliesRef = useRef(new Set());
  const persistInFlightRef = useRef(new Set());
  const lastPersistedDataRef = useRef({}); // Store hash or stringified payload to detect changes
  const sessionCompletedPatchedRef = useRef(false);

  useEffect(() => {
    persistedPliesRef.current.clear();
    persistInFlightRef.current.clear();
    lastPersistedDataRef.current = {};
    sessionCompletedPatchedRef.current = false;
  }, [analysisSessionId]);

  useEffect(() => {
    if (!analysisSessionId || timeline.length === 0) return;

    const allAnalyzed = () => timeline.every((_, i) => {
      const x = analysis[i];
      return x && (x.score || x.error);
    });

    const persistPly = async (idx) => {
      if (persistInFlightRef.current.has(idx)) return;
      const a = analysis[idx];
      if (!a || (!a.score && !a.error)) return;

      const rowCells = buildExportRowAtIndex(idx);
      if (!rowCells || rowCells.length !== ANALYSIS_ROW_CELL_KEYS.length) {
        console.warn('[persist] bad row length', idx, rowCells?.length);
        return;
      }

      const payload = { ply_index: idx };
      ANALYSIS_ROW_CELL_KEYS.forEach((key, i) => {
        const cell = rowCells[i];
        payload[key] = cell != null ? String(cell) : '';
      });
      payload.stockfish_json = JSON.stringify(a);
      payload.pipeline_json = JSON.stringify(pipelineData[idx] ?? null);

      const payloadStr = JSON.stringify(payload);
      if (lastPersistedDataRef.current[idx] === payloadStr) return;

      persistInFlightRef.current.add(idx);
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${analysisSessionId}/moves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr,
        });
        if (!res.ok) throw new Error(await res.text());
        
        lastPersistedDataRef.current[idx] = payloadStr;
        persistedPliesRef.current.add(idx);

        const analyzedCount = timeline.filter((_, i) => {
          const x = analysis[i];
          return x && (x.score || x.error);
        }).length;

        await fetch(`${API_BASE}/api/sessions/${analysisSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            progress_current: analyzedCount,
            progress_total: timeline.length,
          }),
        });

        if (
          !sessionCompletedPatchedRef.current &&
          allAnalyzed() &&
          persistedPliesRef.current.size === timeline.length
        ) {
          sessionCompletedPatchedRef.current = true;
          await fetch(`${API_BASE}/api/sessions/${analysisSessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'completed',
              progress_current: analyzedCount,
              progress_total: timeline.length,
            }),
          });
        }
      } catch (e) {
        console.error('[persist] ply', idx, e);
      } finally {
        persistInFlightRef.current.delete(idx);
      }
    };

    for (let i = 0; i < timeline.length; i++) {
      persistPly(i);
    }
  }, [
    analysisSessionId,
    timeline,
    analysis,
    pipelineData,
    buildExportRowAtIndex,
  ]);

  const handleCopyCSV = useCallback(async () => {
    if (analysis.length === 0) {
      alert('No analysis data to copy.');
      return;
    }

    let rowsPipeline = pipelineData;
    try {
      rowsPipeline = await ensurePipelineSlotsForExport(timeline, pipelineData, positionToFENExport);
      mergePipelineSlots(rowsPipeline);
    } catch (e) {
      console.error('[export] pipeline prefetch', e);
    }

    const dataRows = timeline.map((_, idx) => buildExportRowAtIndex(idx, rowsPipeline)).filter(Boolean);

    const csvContent = [
      EXPORT_HEADERS.join(','),
      ...dataRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    try {
      await navigator.clipboard.writeText(csvContent);
      alert('CSV data copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy CSV: ', err);
      alert('Failed to copy CSV. Check console for details.');
    }
  }, [analysis.length, timeline, pipelineData, mergePipelineSlots, buildExportRowAtIndex, positionToFENExport]);

  const handleExportExcel = useCallback(async () => {
    if (analysis.length === 0) {
      alert('No analysis data to export.');
      return;
    }

    let rowsPipeline = pipelineData;
    try {
      rowsPipeline = await ensurePipelineSlotsForExport(timeline, pipelineData, positionToFENExport);
      mergePipelineSlots(rowsPipeline);
    } catch (e) {
      console.error('[export] pipeline prefetch', e);
    }

    const dataRows = timeline.map((_, idx) => buildExportRowAtIndex(idx, rowsPipeline)).filter(Boolean);

    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...dataRows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chess Analysis');
    XLSX.writeFile(wb, 'Chess_Analysis_Report.xlsx');
  }, [analysis.length, timeline, pipelineData, mergePipelineSlots, buildExportRowAtIndex, positionToFENExport]);

  const playedMeta = getPlayedMoveClassAndStandingAtNavIndex(analysis, timeline, history, navIndex, bookStatusByPly);
  const playedMoveStanding = Number.isFinite(playedMeta.standing) ? playedMeta.standing : 1;

  const dataPipelineTable = (
    <DataPipelineTable 
      fen={currentFEN} 
      fenAtMove={fenAtMove}
      currentMove={currentMove}
      moveNo={navIndex === 0 ? 0 : Math.floor((navIndex + 1) / 2)}
      player={navIndex === 0 ? 'White' : (history[navIndex - 1]?.color === 'w' ? 'White' : 'Black')}
      playedMoveStanding={playedMoveStanding}
      bestMove={bestMove}
      winPercent={winPercent}
      displayScore={displayScore}
      bestMovesList={bestMovesList}
      prevEval={prevEval}
      playedMoveEval={playedMoveEval}
      legalMovesCount={legalMovesCount}
      bookStatus={bookStatusByPly[navIndex] || null}
      bookStatusByPly={bookStatusByPly}
      outOfBookFromPly={firstNonBookPly}
      pipelineData={pipelineData[navIndex]}
      pipelineSlotIndex={navIndex}
      onPipelineFetched={mergePipelineDataAtIndex}
    />
  );

  return (
    <div className="flex flex-col w-full min-h-screen font-sans bg-white px-3 sm:px-4 lg:px-6 pt-1 sm:pt-2 lg:pt-4 pb-12 pb-safe">
      <div className="shrink-0">
        <Header 
          className="lg:items-center"
          onCopyCSV={handleCopyCSV} 
          showCopyCSV={true} 
          onExportExcel={handleExportExcel}
          analysisProgress={analysisProgress}
        />
      </div>
      <main className="max-w-[1600px] mx-auto w-full flex flex-col lg:flex-row gap-4 lg:gap-6 mt-0 lg:mt-1 justify-between lg:items-start">
        <div className="hidden lg:flex lg:order-1 min-h-0 w-full lg:w-auto lg:max-w-[16rem] shrink-0 pt-12">
          <LeftSidebar 
            history={history} 
            navIndex={navIndex} 
            setNavIndex={setNavIndex} 
            timeline={timeline} 
            loadPGN={loadPGN}
            moveClassifications={moveClassifications}
            boardWidth={boardWidth}
          />
        </div>
        <section className="w-full min-w-0 lg:flex-1 flex flex-col items-center justify-center gap-2 lg:gap-4 min-h-0 pt-12 pb-2 lg:order-2">
          <div className="board-and-eval w-full flex-none min-h-0 order-1 lg:order-2 flex flex-col items-center justify-center gap-1" ref={boardContainerRef}>
            <div 
              className="inline-flex flex-row gap-4 items-center justify-center p-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
              style={{ height: `${boardWidth + 112}px` }}
            >
              <EvaluationBar 
                percent={evalPercent} 
                display={displayScore} 
                orientation={orientation}
                barHeight={boardWidth}
              />
              <div className="flex flex-col gap-2 min-w-0" style={{ width: boardWidth, height: boardWidth + 96 }}>
                <PlayerBadge {...topPlayer} />
                <div className="chessboard-wrapper" style={{ width: boardWidth, height: boardWidth }}>
                  <Chessboard
                    id="AnalyzeBoard"
                    boardWidth={boardWidth}
                    position={position}
                    onPieceDrop={onPieceDrop}
                    onSquareClick={onSquareClick}
                    boardOrientation={orientation}
                    customDarkSquareStyle={{ backgroundColor: '#769656' }}
                    customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
                    customSquareStyles={{
                      ...targets.reduce((acc, sq) => ({ ...acc, [sq]: { background: 'rgba(255, 255, 0, 0.4)' } }), {}),
                      ...(selected && { [selected]: { background: 'rgba(255, 255, 0, 0.4)' } })
                    }}
                  />
                </div>
                <PlayerBadge {...bottomPlayer} />
              </div>
            </div>
          </div>
        </section>
        <div className="hidden lg:flex lg:order-3 min-h-0 w-full lg:w-auto lg:max-w-[20rem] shrink-0 pt-12">
          <RightSidebar 
            analysis={analysis} 
            navIndex={navIndex} 
            turn={currentTurn} 
            timeline={timeline}
            history={history}
            currentMove={currentMove}
            playedMoveEval={playedMoveEval}
            legalMovesCount={legalMovesCount}
            bookStatus={bookStatusByPly[navIndex] || null}
            multipv={multipv}
            boardWidth={boardWidth}
          />
        </div>

        <div className="flex flex-col gap-6 w-full shrink-0 lg:hidden mt-4">
          <LeftSidebar 
            layout="pageStack"
            history={history} 
            navIndex={navIndex} 
            setNavIndex={setNavIndex} 
            timeline={timeline} 
            loadPGN={loadPGN}
            moveClassifications={moveClassifications}
            boardWidth={boardWidth}
          />
          <RightSidebar 
            layout="pageStack"
            analysis={analysis} 
            navIndex={navIndex} 
            turn={currentTurn} 
            timeline={timeline}
            history={history}
            currentMove={currentMove}
            playedMoveEval={playedMoveEval}
            legalMovesCount={legalMovesCount}
            bookStatus={bookStatusByPly[navIndex] || null}
            multipv={multipv}
            boardWidth={boardWidth}
          />
        </div>
      </main>

      <div className="relative z-0 max-w-[1600px] mx-auto w-full shrink-0 mt-4 sm:mt-6 lg:mt-8 mb-6 sm:mb-10 overflow-x-auto border-t border-slate-100 pt-4 lg:pt-6">
        {dataPipelineTable}
      </div>
    </div>
  );
};

export default AnalyzePage;
