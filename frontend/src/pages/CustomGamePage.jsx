import React, { useCallback, useEffect, useMemo, useState } from 'react';

function stage0Summary(move) {
  if (!move) return '—';
  const parts = [`SEE ${move.see_value ?? 0}`];
  if (move.is_sacrifice_candidate) parts.push('Sac');
  const indirect = move.indirect_sacrifice_candidate
    ?? move.features?.see?.indirect_sacrifice_candidate;
  if (indirect) {
    const sq = move.newly_exposed_piece_square
      ?? move.exposed_piece_square
      ?? move.features?.see?.newly_exposed_piece_square
      ?? move.features?.see?.exposed_piece_square;
    const pt = move.newly_exposed_piece_type
      ?? move.exposed_piece_type
      ?? move.features?.see?.newly_exposed_piece_type
      ?? move.features?.see?.exposed_piece_type;
    const defRem = move.defender_removal_sacrifice ?? move.features?.see?.defender_removal_sacrifice;
    parts.push(sq && pt ? `IndSac ${pt}@${sq}${defRem ? ' (def↓)' : ''}` : 'IndSac');
  }
  if (move.en_prise_before_move) parts.push('Prise');
  if (move.already_lost_before_move) parts.push('Lost');
  parts.push(`TM ${move.multiplexing_score ?? 0}`, `EV ${move.ev_score ?? 0}`);
  if (move.proceed_to_stage1) parts.push('→S1');
  if (move.features?.see?.favorable_trade) {
    const c = move.features.see.compensation_piece_type;
    const sq = move.features.see.compensation_piece_square;
    parts.push(sq && c ? `Trade ${c}@${sq}` : 'Trade');
  }
  if (move.proceed_to_engine) parts.push(move.engine_candidate_path || 'engine');
  return parts.join(' · ');
}

const SAC_TYPE_SHORT = {
  queen_sacrifice: 'Queen sac',
  exchange_sacrifice: 'Exch sac',
  real_sacrifice: 'Real sac',
  pseudo_sacrifice: 'Pseudo',
  positional_piece_placement: 'Positional',
  tactical_sacrifice: 'Tactical',
  unknown: 'Unknown',
};

function stage1Summary(move) {
  if (!move) return '—';
  const parts = [SAC_TYPE_SHORT[move.sac_type] || move.sac_type];
  parts.push(move.is_valid_sacrifice ? 'Valid' : 'Invalid');
  if (move.is_pseudo) parts.push('Pseudo');
  parts.push(`Mat ${move.material_loss_cp ?? 0}`);
  if (move.is_forced) parts.push('Forced');
  if (move.proceed_to_stage2) parts.push('→S2');
  else if (move.gate_fail_reason) parts.push(move.gate_fail_reason);
  else if (move.disqualifiers?.length) parts.push(move.disqualifiers[0]);
  return parts.join(' · ');
}

function stage2Summary(move) {
  if (!move) return '—';
  const parts = [`CPL ${move.cpl_shallow ?? '—'}`];
  if (move.our_rank_in_top5 != null) parts.push(`Rank ${move.our_rank_in_top5}`);
  if (move.is_best_or_near_best) parts.push('Near-best');
  if (move.ep_delta_shallow != null) parts.push(`EPΔ ${move.ep_delta_shallow}`);
  if (move.proceed_to_stage3) parts.push('→S3');
  else if (move.gate_fail_reason) parts.push(move.gate_fail_reason);
  return parts.join(' · ');
}

function stage3Summary(move) {
  if (!move) return '—';
  const parts = [];
  parts.push(move.is_sound ? 'Sound' : 'Unsound');
  if (move.non_obvious_score != null) parts.push(`NOB ${move.non_obvious_score}`);
  if (move.rank_jump != null) parts.push(`RankΔ ${move.rank_jump}`);
  if (move.is_rising_curve) parts.push('Rising');
  if (move.proceed_to_stage4) parts.push('→S4');
  else if (move.gate_fail_reason) parts.push(move.gate_fail_reason);
  return parts.join(' · ');
}

function stage4Summary(move) {
  if (!move) return '—';
  const parts = [`Score ${move.brilliance_score ?? '—'}`];
  if (move.classification) parts.push(move.classification);
  if (move.archetype) parts.push(move.archetype.replace(/_/g, ' '));
  if (move.proceed_to_stage4) parts.push('→S4');
  return parts.join(' · ');
}
import { useChessGame } from '../hooks/useChessGame';
import { API_BASE } from '../config/api';
import LeftSidebar from '../components/LeftSidebar';
import RightSidebar from '../components/RightSidebar';
import PlayerBadge from '../components/PlayerBadge';
import BrillianceStagesPanel from '../components/BrillianceStagesPanel';
import TestMoveStageExplanation from '../components/TestMoveStageExplanation';
import { Chessboard } from 'react-chessboard';

export default function CustomGamePage({
  boardId = 'CustomGameBoard',
  inputSource = 'custom_game',
  hideBrilliancePanel = false,
}) {
  const [importError, setImportError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [gameId, setGameId] = useState(null);
  const [gameInfo, setGameInfo] = useState(null);
  const [stage2, setStage2] = useState(null);
  const [stage3, setStage3] = useState(null);
  const [stage4, setStage4] = useState(null);
  const [engineEvalLoading, setEngineEvalLoading] = useState(false);
  const [stage0, setStage0] = useState(null);
  const [stage0Loading, setStage0Loading] = useState(false);
  const [stage1, setStage1] = useState(null);
  const [stage1Loading, setStage1Loading] = useState(false);
  const [stage2Loading, setStage2Loading] = useState(false);
  const [stage3Loading, setStage3Loading] = useState(false);
  const [stage4Loading, setStage4Loading] = useState(false);
  const [stageFilter, setStageFilter] = useState(null);

  const handleEngineEvalChange = useCallback(({ stage2: s2, stage3: s3, stage4: s4, loading }) => {
    if (s2 !== undefined) setStage2(s2);
    if (s3 !== undefined) setStage3(s3);
    if (s4 !== undefined) setStage4(s4);
    if (loading !== undefined) setEngineEvalLoading(loading);
  }, []);

  const {
    position,
    selected,
    targets,
    history,
    timeline,
    navIndex,
    setNavIndex,
    orientation,
    boardWidth,
    boardContainerRef,
    onSquareClick,
    onPieceDrop,
    loadPGN,
    moveClassifications,
    pgnMetadata,
  } = useChessGame({
    enableAnalysis: false,
    multipv: 3,
  });

  const handleImportPGN = useCallback(
    async (pgn) => {
      const text = String(pgn || '').trim();
      if (!text) return false;

      setImportError(null);
      setImporting(true);
      setGameId(null);
      setGameInfo(null);
      setStage2(null);
      setStage3(null);
      setStage4(null);
      setStage0(null);
      setStage0Loading(false);
      setStage1(null);
      setStage1Loading(false);
      setStage2Loading(false);
      setStage3Loading(false);
      setStage4Loading(false);
      setStageFilter(null);

      try {
        const res = await fetch(`${API_BASE}/api/lichess-pgns/custom/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pgn_text: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to import PGN');

        const ok = loadPGN(data.clean_pgn, {
          skipSessionCreate: true,
          input_source: inputSource,
          input_filename: data.original_filename || 'Custom PGN',
        });
        if (!ok) throw new Error('Could not parse imported PGN');

        setGameId(data.id);
        setGameInfo(data);

        if (hideBrilliancePanel) {
          setStage0Loading(true);
          const runRes = await fetch(`${API_BASE}/api/lichess-pgns/games/${data.id}/stage0/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const s0 = await runRes.json();
          if (!runRes.ok) throw new Error(s0.error || 'Stage 0 analysis failed');
          setStage0(s0);
          setStage0Loading(false);

          setStage1Loading(true);
          const runS1 = await fetch(`${API_BASE}/api/lichess-pgns/games/${data.id}/stage1/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const s1 = await runS1.json();
          if (!runS1.ok) throw new Error(s1.error || 'Stage 1 analysis failed');
          setStage1(s1);
          setStage1Loading(false);

          setStage2Loading(true);
          const runS2 = await fetch(`${API_BASE}/api/lichess-pgns/games/${data.id}/stage2/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const s2 = await runS2.json();
          if (!runS2.ok) throw new Error(s2.error || 'Stage 2 analysis failed');
          setStage2(s2);
          setStage2Loading(false);

          setStage3Loading(true);
          const runS3 = await fetch(`${API_BASE}/api/lichess-pgns/games/${data.id}/stage3/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const s3 = await runS3.json();
          if (!runS3.ok) throw new Error(s3.error || 'Stage 3 analysis failed');
          setStage3(s3);
          setStage3Loading(false);

          setStage4Loading(true);
          const runS4 = await fetch(`${API_BASE}/api/lichess-pgns/games/${data.id}/stage4/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: true }),
          });
          const s4 = await runS4.json();
          if (!runS4.ok) throw new Error(s4.error || 'Stage 4 analysis failed');
          setStage4(s4);
          setStage4Loading(false);
        }

        return true;
      } catch (e) {
        setImportError(e.message || String(e));
        return false;
      } finally {
        setImporting(false);
        setStage0Loading(false);
        setStage1Loading(false);
        setStage2Loading(false);
        setStage3Loading(false);
        setStage4Loading(false);
      }
    },
    [loadPGN, inputSource, hideBrilliancePanel]
  );

  useEffect(() => {
    if (!hideBrilliancePanel || stage1Loading || !stage1?.moves?.length) return;
    setStageFilter((prev) => (prev === null ? 'stage1' : prev));
  }, [hideBrilliancePanel, stage1Loading, stage1?.moves?.length]);

  const stage2Move = useMemo(() => {
    if (!stage2?.moves?.length || navIndex <= 0) return null;
    return stage2.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [stage2, navIndex]);

  const stage3Move = useMemo(() => {
    if (!stage3?.moves?.length || navIndex <= 0) return null;
    return stage3.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [stage3, navIndex]);

  const stage4Move = useMemo(() => {
    if (!stage4?.moves?.length || navIndex <= 0) return null;
    return stage4.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [stage4, navIndex]);

  const meta = pgnMetadata || gameInfo?.pgn_metadata || {};
  const whitePlayer = meta.White;
  const whiteRating = meta.WhiteElo;
  const blackPlayer = meta.Black;
  const blackRating = meta.BlackElo;

  const getLatestClock = (color) => {
    for (let i = navIndex - 1; i >= 0; i--) {
      if (history[i]?.color === color && history[i]?.clock) {
        return history[i].clock;
      }
    }
    return null;
  };

  const topPlayer =
    orientation === 'white'
      ? { name: blackPlayer || 'Black', rating: blackRating, color: 'b', clock: getLatestClock('b') }
      : { name: whitePlayer || 'White', rating: whiteRating, color: 'w', clock: getLatestClock('w') };

  const bottomPlayer =
    orientation === 'white'
      ? { name: whitePlayer || 'White', rating: whiteRating, color: 'w', clock: getLatestClock('w') }
      : { name: blackPlayer || 'Black', rating: blackRating, color: 'b', clock: getLatestClock('b') };

  const moveListLabels = useMemo(
    () =>
      history.map((m, i) => {
        const moveNum = Math.floor(i / 2) + 1;
        if (m.color === 'w') return `${moveNum}. ${m.san}`;
        return `${moveNum}... ${m.san}`;
      }),
    [history]
  );

  const stage0ByPly = useMemo(() => {
    const map = new Map();
    for (const m of stage0?.moves || []) {
      map.set(m.ply_index, m);
    }
    return map;
  }, [stage0]);

  const stage1ByPly = useMemo(() => {
    const map = new Map();
    for (const m of stage1?.moves || []) {
      map.set(m.ply_index, m);
    }
    return map;
  }, [stage1]);

  const stage2ByPly = useMemo(() => {
    const map = new Map();
    for (const m of stage2?.moves || []) {
      map.set(m.ply_index, m);
    }
    return map;
  }, [stage2]);

  const stage3ByPly = useMemo(() => {
    const map = new Map();
    for (const m of stage3?.moves || []) {
      map.set(m.ply_index, m);
    }
    return map;
  }, [stage3]);

  const stage4ByPly = useMemo(() => {
    const map = new Map();
    for (const m of stage4?.moves || []) {
      map.set(m.ply_index, m);
    }
    return map;
  }, [stage4]);

  const tableMoveRows = useMemo(
    () => moveListLabels.map((label, plyIndex) => ({ label, plyIndex })),
    [moveListLabels]
  );

  const visibleTableRows = useMemo(() => {
    if (stageFilter === 'stage1') {
      return tableMoveRows.filter(({ plyIndex }) => stage0ByPly.get(plyIndex)?.proceed_to_stage1);
    }
    if (stageFilter === 'stage4') {
      return tableMoveRows.filter(({ plyIndex }) => stage3ByPly.get(plyIndex)?.proceed_to_stage4);
    }
    return tableMoveRows;
  }, [tableMoveRows, stageFilter, stage0ByPly, stage3ByPly]);

  const stage1EligibleCount = useMemo(
    () => tableMoveRows.filter(({ plyIndex }) => stage0ByPly.get(plyIndex)?.proceed_to_stage1).length,
    [tableMoveRows, stage0ByPly]
  );

  const stage4EligibleCount = useMemo(
    () => tableMoveRows.filter(({ plyIndex }) => stage3ByPly.get(plyIndex)?.proceed_to_stage4).length,
    [tableMoveRows, stage3ByPly]
  );

  const selectedMoveLabel = navIndex > 0 ? moveListLabels[navIndex - 1] : null;
  const selectedS0Move = navIndex > 0 ? stage0ByPly.get(navIndex - 1) : null;
  const selectedS1Move = navIndex > 0 ? stage1ByPly.get(navIndex - 1) : null;
  const selectedS2Move = navIndex > 0 ? stage2ByPly.get(navIndex - 1) : null;
  const selectedS3Move = navIndex > 0 ? stage3ByPly.get(navIndex - 1) : null;
  const selectedS4Move = navIndex > 0 ? stage4ByPly.get(navIndex - 1) : null;

  const lastMoveHighlight = useMemo(() => {
    if (!hideBrilliancePanel || navIndex <= 0) return {};
    const uci = history[navIndex - 1]?.uci;
    if (!uci || uci.length < 4) return {};
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    return {
      [from]: { background: 'rgba(228, 228, 33, 0.64)' },
      [to]: { background: 'rgba(155, 199, 0, 0.55)' },
    };
  }, [hideBrilliancePanel, navIndex, history]);

  return (
    <div className="relative flex flex-col w-full min-h-screen font-sans bg-white px-3 sm:px-4 lg:px-6 pt-1 sm:pt-2 lg:pt-4 pb-12 pb-safe">
      {importError && (
        <div className="fixed top-14 lg:top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full px-4">
          <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm px-4 py-2 shadow-lg">
            {importError}
          </div>
        </div>
      )}

      {importing && (
        <div className="fixed top-14 lg:top-4 right-3 sm:right-6 z-40 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm shadow-lg px-4 py-2 text-xs font-bold text-slate-600">
          {hideBrilliancePanel && stage4Loading
            ? 'Running Stage 4…'
            : hideBrilliancePanel && stage3Loading
              ? 'Running Stage 3…'
              : hideBrilliancePanel && stage2Loading
              ? 'Running Stage 2…'
              : hideBrilliancePanel && stage1Loading
                ? 'Running Stage 1…'
                : hideBrilliancePanel && stage0Loading
                  ? 'Running Stage 0…'
                  : 'Importing PGN…'}
        </div>
      )}

      <main className="max-w-[1600px] mx-auto w-full flex flex-col gap-4 lg:gap-6 mt-0 lg:mt-1">
        <div className="w-full flex flex-col lg:flex-row gap-4 lg:gap-6 justify-between lg:items-start">
          <div className="hidden lg:flex lg:order-1 min-h-0 w-full lg:w-auto lg:max-w-[16rem] shrink-0 pt-2 lg:pt-4">
            <LeftSidebar
              history={history}
              navIndex={navIndex}
              setNavIndex={setNavIndex}
              timeline={timeline}
              loadPGN={handleImportPGN}
              moveClassifications={moveClassifications}
              boardWidth={boardWidth}
            />
          </div>

          <section className="w-full min-w-0 lg:flex-1 flex flex-col items-center justify-center gap-2 lg:gap-4 min-h-0 pt-2 lg:pt-4 pb-2 lg:order-2">
            <div
              className="board-and-eval w-full flex-none min-h-0 order-1 lg:order-2 flex flex-col items-center justify-center gap-1"
              ref={boardContainerRef}
            >
              <div
                className="inline-flex flex-row gap-4 items-center justify-center p-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                style={{ height: `${boardWidth + 112}px` }}
              >
                <div
                  className="flex flex-col gap-2 min-w-0"
                  style={{ width: boardWidth, height: boardWidth + 96 }}
                >
                  <PlayerBadge {...topPlayer} />
                  <div className="chessboard-wrapper" style={{ width: boardWidth, height: boardWidth }}>
                    <Chessboard
                      id={boardId}
                      boardWidth={boardWidth}
                      position={position}
                      onPieceDrop={onPieceDrop}
                      onSquareClick={onSquareClick}
                      boardOrientation={orientation}
                      arePiecesDraggable={false}
                      customDarkSquareStyle={{ backgroundColor: '#769656' }}
                      customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
                      customSquareStyles={{
                        ...lastMoveHighlight,
                        ...targets.reduce(
                          (acc, sq) => ({ ...acc, [sq]: { background: 'rgba(255, 255, 0, 0.4)' } }),
                          {}
                        ),
                        ...(selected && { [selected]: { background: 'rgba(255, 255, 0, 0.4)' } }),
                      }}
                    />
                  </div>
                  <PlayerBadge {...bottomPlayer} />
                </div>
              </div>
            </div>
          </section>

          <div className="hidden lg:flex lg:order-3 min-h-0 w-full lg:w-auto lg:max-w-[20rem] shrink-0 pt-2 lg:pt-4">
            <RightSidebar
              empty
              stage2Move={stage2Move}
              stage3Move={stage3Move}
              stage4Move={stage4Move}
              engineEvalLoading={engineEvalLoading}
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
              loadPGN={handleImportPGN}
              moveClassifications={moveClassifications}
              boardWidth={boardWidth}
            />
            <RightSidebar
              layout="pageStack"
              empty
              stage2Move={stage2Move}
              stage3Move={stage3Move}
              stage4Move={stage4Move}
              engineEvalLoading={engineEvalLoading}
              boardWidth={boardWidth}
            />
          </div>
        </div>

        {!hideBrilliancePanel && (
        <div className="w-full pt-2 lg:pt-0">
          {gameId ? (
            <BrillianceStagesPanel
              gameId={gameId}
              navIndex={navIndex}
              setNavIndex={setNavIndex}
              onEngineEvalChange={handleEngineEvalChange}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-slate-500 mb-2">
                  Import a PGN using the button in Move History to run brilliance analysis.
                </p>
                <p className="text-xs text-slate-400">
                  Click the <i className="fas fa-file-import mx-1" aria-hidden /> icon in the Move History panel.
                </p>
              </div>
            </div>
          )}
        </div>
        )}

        {hideBrilliancePanel && (
          <div className="w-full pt-2 lg:pt-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <button
                type="button"
                onClick={() => setStageFilter((v) => (v === 'stage1' ? null : 'stage1'))}
                disabled={
                  stage0Loading || stage1Loading || stage2Loading || stage3Loading || stage4Loading || !stage0?.moves?.length
                }
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                  stageFilter === 'stage1'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Stage 1
              </button>
              <button
                type="button"
                onClick={() => setStageFilter((v) => (v === 'stage4' ? null : 'stage4'))}
                disabled={
                  stage0Loading || stage1Loading || stage2Loading || stage3Loading || stage4Loading || !stage3?.moves?.length
                }
                className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-colors ${
                  stageFilter === 'stage4'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Stage 4
              </button>
              {stageFilter == null && (
                <span className="text-xs text-slate-400">All moves</span>
              )}
              {stageFilter === 'stage1' && (
                <span className="text-xs text-slate-500">
                  {stage1EligibleCount} move{stage1EligibleCount === 1 ? '' : 's'} eligible
                </span>
              )}
              {stageFilter === 'stage4' && (
                <span className="text-xs text-slate-500">
                  {stage4EligibleCount} move{stage4EligibleCount === 1 ? '' : 's'} selected for Stage 4
                </span>
              )}
            </div>
            <div className="flex flex-row gap-4 w-full items-stretch">
              <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden h-[480px] flex flex-col">
                <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-900 text-white">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Move
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Stage 0
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Stage 1
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Stage 2
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Stage 3
                        </th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest">
                          Stage 4
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {moveListLabels.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                            Import a PGN to list moves here.
                          </td>
                        </tr>
                      ) : visibleTableRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                            {stageFilter === 'stage4'
                              ? 'No moves selected for Stage 4.'
                              : 'No moves eligible for Stage 1.'}
                          </td>
                        </tr>
                      ) : (
                        visibleTableRows.map(({ label, plyIndex }) => {
                          const isActive = navIndex === plyIndex + 1;
                          const s0Move = stage0ByPly.get(plyIndex);
                          const s1Move = stage1ByPly.get(plyIndex);
                          const s2Move = stage2ByPly.get(plyIndex);
                          const s3Move = stage3ByPly.get(plyIndex);
                          const s4Move = stage4ByPly.get(plyIndex);
                          const isStage1Eligible = Boolean(s0Move?.proceed_to_stage1);
                          const isStage2Eligible = Boolean(s1Move?.proceed_to_stage2);
                          const isStage3Eligible = Boolean(
                            s1Move?.proceed_to_stage2 && s2Move?.proceed_to_stage3
                          );
                          const isStage4Eligible = Boolean(s3Move?.proceed_to_stage4);
                          const isSac = s0Move?.is_sacrifice_candidate;
                          return (
                            <tr
                              key={plyIndex}
                              className={`border-b border-slate-100 cursor-pointer transition-colors ${
                                isActive
                                  ? 'bg-indigo-50 text-indigo-900'
                                  : isStage4Eligible && stageFilter === 'stage4'
                                    ? 'bg-violet-50/60'
                                    : isSac
                                      ? 'bg-amber-50/50'
                                      : 'hover:bg-slate-50'
                              }`}
                              onClick={() => setNavIndex(plyIndex + 1)}
                            >
                              <td className="px-4 py-2 font-mono font-semibold whitespace-nowrap">{label}</td>
                              <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                                {stage0Loading ? (
                                  <span className="text-slate-400">Running…</span>
                                ) : (
                                  <span
                                    className={
                                      s0Move?.see_value < -50 ? 'text-red-600 font-semibold' : undefined
                                    }
                                  >
                                    {stage0Summary(s0Move)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                                {!isStage1Eligible ? (
                                  <span className="text-slate-300">—</span>
                                ) : stage1Loading ? (
                                  <span className="text-slate-400">Running…</span>
                                ) : (
                                  <span
                                    className={
                                      s1Move?.proceed_to_stage2
                                        ? 'text-emerald-700 font-semibold'
                                        : s1Move && !s1Move.is_valid_sacrifice
                                          ? 'text-red-600'
                                          : undefined
                                    }
                                  >
                                    {stage1Summary(s1Move)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                                {!isStage2Eligible ? (
                                  <span className="text-slate-300">—</span>
                                ) : stage2Loading ? (
                                  <span className="text-slate-400">Running…</span>
                                ) : (
                                  <span
                                    className={
                                      s2Move?.proceed_to_stage3
                                        ? 'text-emerald-700 font-semibold'
                                        : s2Move?.cpl_shallow > 300
                                          ? 'text-red-600'
                                          : undefined
                                    }
                                  >
                                    {stage2Summary(s2Move)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                                {!isStage3Eligible ? (
                                  <span className="text-slate-300">—</span>
                                ) : stage3Loading ? (
                                  <span className="text-slate-400">Running…</span>
                                ) : (
                                  <span
                                    className={
                                      s3Move?.is_sound
                                        ? 'text-emerald-700 font-semibold'
                                        : s3Move?.proceed_to_stage4
                                          ? 'text-violet-700 font-semibold'
                                          : s3Move
                                            ? 'text-amber-700'
                                            : undefined
                                    }
                                  >
                                    {stage3Summary(s3Move)}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-600 font-mono">
                                {!isStage4Eligible ? (
                                  <span className="text-slate-300">—</span>
                                ) : stage4Loading ? (
                                  <span className="text-slate-400">Running…</span>
                                ) : (
                                  <span
                                    className={
                                      s4Move?.is_brilliant || s4Move?.classification === 'BRILLIANT'
                                        ? 'text-amber-700 font-semibold'
                                        : s4Move?.classification === 'practical_brilliant'
                                          ? 'text-indigo-700 font-semibold'
                                          : s4Move
                                            ? 'text-violet-700'
                                            : undefined
                                    }
                                  >
                                    {stage4Summary(s4Move)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white shadow-sm h-[480px] overflow-hidden">
                <TestMoveStageExplanation
                  navIndex={navIndex}
                  moveLabel={selectedMoveLabel}
                  s0Move={selectedS0Move}
                  s1Move={selectedS1Move}
                  s2Move={selectedS2Move}
                  s3Move={selectedS3Move}
                  stage0Loading={stage0Loading}
                  stage1Loading={stage1Loading}
                  stage2Loading={stage2Loading}
                  stage3Loading={stage3Loading}
                  stage4Loading={stage4Loading}
                  s4Move={selectedS4Move}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
