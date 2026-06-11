import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useChessGame } from '../hooks/useChessGame';
import { API_BASE } from '../config/api';
import LeftSidebar from '../components/LeftSidebar';
import RightSidebar from '../components/RightSidebar';
import PlayerBadge from '../components/PlayerBadge';
import BrillianceStagesPanel from '../components/BrillianceStagesPanel';
import { Chessboard } from 'react-chessboard';

export default function LichessPgnGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [loadError, setLoadError] = useState(null);
  const [gameInfo, setGameInfo] = useState(null);
  const [neighbors, setNeighbors] = useState(null);
  const [pgnLoaded, setPgnLoaded] = useState(false);
  const [stage2, setStage2] = useState(null);
  const [stage3, setStage3] = useState(null);
  const [stage4, setStage4] = useState(null);
  const [engineEvalLoading, setEngineEvalLoading] = useState(true);

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

  useEffect(() => {
    const id = Number(gameId);
    if (!Number.isFinite(id)) {
      setLoadError('Invalid game id');
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setPgnLoaded(false);
    setGameInfo(null);
    setNeighbors(null);

    fetch(`${API_BASE}/api/lichess-pgns/games/${id}/neighbors`)
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setNeighbors(data);
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/lichess-pgns/games/${id}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load game');
        if (cancelled) return;
        setGameInfo(data);
        const ok = loadPGN(data.clean_pgn, {
          skipSessionCreate: true,
          input_source: 'lichess_pgn',
          input_filename: data.original_filename
            ? `${data.original_filename} #${data.game_index + 1}`
            : `Game #${data.game_index + 1}`,
        });
        if (!ok) throw new Error('Could not parse stored PGN');
        setPgnLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message || String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, loadPGN]);

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

  if (loadError) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-red-600 text-sm mb-4">{loadError}</p>
        <Link to="/lichess_pgns" className="text-indigo-600 font-bold text-sm hover:underline">
          ← Back to lichess_pgns
        </Link>
      </div>
    );
  }

  if (!pgnLoaded) {
    return <div className="p-6 text-sm text-slate-500">Loading game…</div>;
  }

  const goToGame = (id) => {
    if (id != null) navigate(`/lichess_pgns/${id}`);
  };

  return (
    <div className="relative flex flex-col w-full min-h-screen font-sans bg-white px-3 sm:px-4 lg:px-6 pt-1 sm:pt-2 lg:pt-4 pb-12 pb-safe">
      <div className="fixed top-14 lg:top-4 right-3 sm:right-6 z-40 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-sm shadow-lg px-1 py-1">
        <button
          type="button"
          disabled={!neighbors?.prev_id}
          onClick={() => goToGame(neighbors?.prev_id)}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Previous game"
          aria-label="Previous game"
        >
          <i className="fas fa-chevron-left text-sm" aria-hidden />
        </button>
        <div className="px-2 min-w-[4.5rem] text-center select-none">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 leading-none">
            Game
          </div>
          <div className="text-xs font-black text-slate-800 tabular-nums leading-tight mt-0.5">
            {neighbors ? `${neighbors.position}/${neighbors.total}` : '…'}
          </div>
        </div>
        <button
          type="button"
          disabled={!neighbors?.next_id}
          onClick={() => goToGame(neighbors?.next_id)}
          className="flex items-center justify-center w-9 h-9 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          title="Next game"
          aria-label="Next game"
        >
          <i className="fas fa-chevron-right text-sm" aria-hidden />
        </button>
      </div>

      <main className="max-w-[1600px] mx-auto w-full flex flex-col gap-4 lg:gap-6 mt-0 lg:mt-1">
        <div className="w-full flex flex-col lg:flex-row gap-4 lg:gap-6 justify-between lg:items-start">
          <div className="hidden lg:flex lg:order-1 min-h-0 w-full lg:w-auto lg:max-w-[16rem] shrink-0 pt-2 lg:pt-4">
            <LeftSidebar
              history={history}
              navIndex={navIndex}
              setNavIndex={setNavIndex}
              timeline={timeline}
              loadPGN={loadPGN}
              moveClassifications={moveClassifications}
              boardWidth={boardWidth}
              hideImport
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
                      id="LichessPgnBoard"
                      boardWidth={boardWidth}
                      position={position}
                      onPieceDrop={onPieceDrop}
                      onSquareClick={onSquareClick}
                      boardOrientation={orientation}
                      arePiecesDraggable={false}
                      customDarkSquareStyle={{ backgroundColor: '#769656' }}
                      customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
                      customSquareStyles={{
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
              loadPGN={loadPGN}
              moveClassifications={moveClassifications}
              boardWidth={boardWidth}
              hideImport
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

        <div className="w-full pt-2 lg:pt-0">
          <BrillianceStagesPanel
            gameId={Number(gameId)}
            navIndex={navIndex}
            setNavIndex={setNavIndex}
            onEngineEvalChange={handleEngineEvalChange}
          />
        </div>
      </main>
    </div>
  );
}
