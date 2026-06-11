import React, { useMemo } from 'react';
import { useChessGame } from '../hooks/useChessGame';
import Header from '../components/Header';
import LeftSidebar from '../components/LeftSidebar';
import RightSidebar from '../components/RightSidebar';
import GameControls from '../components/GameControls';
import EvaluationBar from '../components/EvaluationBar';
import PlayerBadge from '../components/PlayerBadge';
import { Chessboard } from 'react-chessboard';

const ChessBoardPage = () => {
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
    currentMove,
    playedMoveEval,
    legalMovesCount,
    bookStatusByPly,
    moveClassifications,
    multipv,
    pgnMetadata,
  } = useChessGame();

  const whitePlayer = pgnMetadata?.White;
  const whiteRating = pgnMetadata?.WhiteElo;
  const blackPlayer = pgnMetadata?.Black;
  const blackRating = pgnMetadata?.BlackElo;

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

  const pieces = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
  const customPieces = useMemo(() => {
    const p = {};
    pieces.forEach(piece => {
      p[piece] = ({ squareWidth }) => (
        <img
          src={`/pieces/${piece}.svg`}
          alt={piece}
          style={{ width: squareWidth, height: squareWidth }}
        />
      );
    });
    return p;
  }, []);

  return (
    <div className="flex flex-col w-full flex-none min-h-0 font-sans bg-white px-3 sm:px-4 lg:px-6 pt-3 sm:pt-4 lg:pt-6 pb-6 pb-safe lg:flex-1 lg:min-h-0">
      <div className="shrink-0">
        <Header />
      </div>
      <main className="max-w-[1600px] mx-auto w-full flex flex-col lg:flex-row gap-4 lg:gap-6 flex-none lg:flex-1 lg:min-h-0 mt-2 sm:mt-3 justify-between">
        <div className="hidden lg:flex lg:order-1 min-h-0 w-full lg:w-auto lg:max-w-[16rem] shrink-0">
          <LeftSidebar 
            history={history} 
            navIndex={navIndex} 
            setNavIndex={setNavIndex} 
            timeline={timeline} 
            resetBoard={resetBoard} 
            loadPGN={loadPGN}
            moveClassifications={moveClassifications}
            boardWidth={boardWidth}
          />
        </div>
        <section className="flex-none lg:flex-1 flex flex-col items-center justify-center gap-4 min-w-0 min-h-0 py-2 lg:order-2">
          <GameControls 
            className="order-2 lg:order-1 w-full shrink-0"
            turn={turn} 
            whiteAI={whiteAI} 
            setWhiteAI={setWhiteAI} 
            blackAI={blackAI} 
            setBlackAI={setBlackAI} 
            orientation={orientation} 
            setOrientation={setOrientation} 
          />
          <div className="board-and-eval w-full flex-none lg:flex-1 min-h-0 order-1 lg:order-2 flex flex-row items-center justify-center gap-4" ref={boardContainerRef} style={{ height: `${boardWidth + 112}px` }}>
            <div className="inline-flex flex-row gap-4 items-center justify-center p-2 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <EvaluationBar 
                percent={evalPercent} 
                display={displayScore} 
                orientation={orientation}
                barHeight={boardWidth}
              />
              <div className="flex flex-col gap-2 min-w-0" style={{ width: boardWidth }}>
                <PlayerBadge {...topPlayer} />
                <div className="chessboard-wrapper" style={{ width: boardWidth, height: boardWidth }}>
                  <Chessboard
                    id="MainBoard"
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
                    customPieces={customPieces}
                  />
                </div>
                <PlayerBadge {...bottomPlayer} />
              </div>
            </div>
          </div>
        </section>
        <div className="hidden lg:flex lg:order-3 min-h-0 w-full lg:w-auto lg:max-w-[20rem] shrink-0">
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
            resetBoard={resetBoard} 
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
            boardWidth={boardWidth}
          />
        </div>
      </main>
    </div>
  );
};

export default ChessBoardPage;
