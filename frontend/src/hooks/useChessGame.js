import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Chess } from 'chess.js';
import { API_BASE } from '../config/api';
import { classifyPlayedMoveAtNavIndex, getPlayedMoveClassAndStandingAtNavIndex } from '../utils/playedMoveClassification';

const initialPosition = {
  a8: 'bR', b8: 'bN', c8: 'bB', d8: 'bQ', e8: 'bK', f8: 'bB', g8: 'bN', h8: 'bR',
  a7: 'bP', b7: 'bP', c7: 'bP', d7: 'bP', e7: 'bP', f7: 'bP', g7: 'bP', h7: 'bP',
  a2: 'wP', b2: 'wP', c2: 'wP', d2: 'wP', e2: 'wP', f2: 'wP', g2: 'wP', h2: 'wP',
  a1: 'wR', b1: 'wN', c1: 'wB', d1: 'wQ', e1: 'wK', f1: 'wB', g1: 'wN', h1: 'wR',
};

const ALL_SQUARES = (() => {
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = ['1','2','3','4','5','6','7','8'];
  const res = [];
  for (let r = 0; r < ranks.length; r++) {
    for (let f = 0; f < files.length; f++) {
      res.push(files[f] + ranks[r]);
    }
  }
  return res;
})();

const FILES = ['a','b','c','d','e','f','g','h'];
const RANKS = ['1','2','3','4','5','6','7','8'];
const inBounds = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const squareToCoord = (sq) => ({ f: FILES.indexOf(sq[0]), r: RANKS.indexOf(sq[1]) });
const coordToSquare = (f, r) => FILES[f] + RANKS[r];

const applyMove = (position, from, to, promoteTo, epTarget) => {
  const next = { ...position };
  const piece = next[from];
  if (!piece) return next;
  if (piece[1] === 'P' && epTarget && to === epTarget && !position[to]) {
    const file = to[0];
    const rank = Number(to[1]);
    const behind = piece[0] === 'w' ? (rank - 1) : (rank + 1);
    const behindSq = file + String(behind);
    if (next[behindSq] && next[behindSq][1] === 'P' && next[behindSq][0] !== piece[0]) {
      delete next[behindSq];
    }
  }
  delete next[from];
  next[to] = piece;
  if (piece[1] === 'P' && promoteTo) {
    const color = piece[0];
    next[to] = color + promoteTo;
  }
  if (piece[1] === 'K') {
    if (from === 'e1' && to === 'g1') {
      if (next['h1'] === 'wR') {
        delete next['h1'];
        next['f1'] = 'wR';
      }
    } else if (from === 'e1' && to === 'c1') {
      if (next['a1'] === 'wR') {
        delete next['a1'];
        next['d1'] = 'wR';
      }
    } else if (from === 'e8' && to === 'g8') {
      if (next['h8'] === 'bR') {
        delete next['h8'];
        next['f8'] = 'bR';
      }
    } else if (from === 'e8' && to === 'c8') {
      if (next['a8'] === 'bR') {
        delete next['a8'];
        next['d8'] = 'bR';
      }
    }
  }
  return next;
};

const getKingSquare = (position, color) => {
  for (const sq of ALL_SQUARES) {
    if (position[sq] === (color + 'K')) return sq;
  }
  return null;
};

const attackedBySliding = (position, square, byColor, deltas) => {
  const { f, r } = squareToCoord(square);
  for (const [df, dr] of deltas) {
    let nf = f + df;
    let nr = r + dr;
    while (inBounds(nf, nr)) {
      const nsq = coordToSquare(nf, nr);
      const p = position[nsq];
      if (!p) {
        nf += df;
        nr += dr;
        continue;
      }
      if (p[0] !== byColor) break;
      if (p[1] === 'B' && Math.abs(df) === 1 && Math.abs(dr) === 1) return true;
      if (p[1] === 'R' && (df === 0 || dr === 0)) return true;
      if (p[1] === 'Q') return true;
      break;
    }
  }
  return false;
};

const isSquareAttacked = (position, square, byColor) => {
  const { f, r } = squareToCoord(square);
  const pawnDir = byColor === 'w' ? 1 : -1;
  for (const df of [-1, 1]) {
    const nf = f + df;
    const nr = r + pawnDir;
    if (inBounds(nf, nr)) {
      const nsq = coordToSquare(nf, nr);
      if (position[nsq] === (byColor + 'P')) return true;
    }
  }
  const knightJumps = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  for (const [df, dr] of knightJumps) {
    const nf = f + df;
    const nr = r + dr;
    if (!inBounds(nf, nr)) continue;
    const nsq = coordToSquare(nf, nr);
    if (position[nsq] === (byColor + 'N')) return true;
  }
  const kingAdj = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (const [df, dr] of kingAdj) {
    const nf = f + df;
    const nr = r + dr;
    if (!inBounds(nf, nr)) continue;
    const nsq = coordToSquare(nf, nr);
    if (position[nsq] === (byColor + 'K')) return true;
  }
  if (attackedBySliding(position, square, byColor, [[1,0],[-1,0],[0,1],[0,-1]])) return true;
  if (attackedBySliding(position, square, byColor, [[1,1],[1,-1],[-1,1],[-1,-1]])) return true;
  return false;
};

const isInCheck = (position, color) => {
  const ksq = getKingSquare(position, color);
  if (!ksq) return false;
  const enemy = color === 'w' ? 'b' : 'w';
  return isSquareAttacked(position, ksq, enemy);
};

const computeCastlingUpdate = (castling, piece, from, next) => {
  const updated = { ...castling };
  if (piece === 'wK') {
    updated.wK = false;
    updated.wQ = false;
  }
  if (piece === 'bK') {
    updated.bK = false;
    updated.bQ = false;
  }
  if (piece === 'wR') {
    if (from === 'h1') updated.wK = false;
    if (from === 'a1') updated.wQ = false;
  }
  if (piece === 'bR') {
    if (from === 'h8') updated.bK = false;
    if (from === 'a8') updated.bQ = false;
  }
  if (updated.wK && next['h1'] !== 'wR') updated.wK = false;
  if (updated.wQ && next['a1'] !== 'wR') updated.wQ = false;
  if (updated.bK && next['h8'] !== 'bR') updated.bK = false;
  if (updated.bQ && next['a8'] !== 'bR') updated.bQ = false;
  return updated;
};

const isOwn = (position, sq, color) => {
  const p = position[sq];
  return !!p && p[0] === color;
};

const isEnemy = (position, sq, color) => {
  const p = position[sq];
  return !!p && p[0] !== color;
};

const isEmpty = (position, sq) => !position[sq];

const slidingMoves = (position, from, color, deltas) => {
  const { f, r } = squareToCoord(from);
  const moves = [];
  for (const [df, dr] of deltas) {
    let nf = f + df;
    let nr = r + dr;
    while (inBounds(nf, nr)) {
      const nsq = coordToSquare(nf, nr);
      if (isOwn(position, nsq, color)) break;
      if (isEnemy(position, nsq, color)) {
        moves.push(nsq);
        break;
      }
      moves.push(nsq);
      nf += df;
      nr += dr;
    }
  }
  return moves;
};

const getLegalMoves = (position, from, rights, epTarget) => {
  const piece = position[from];
  if (!piece) return [];
  const color = piece[0];
  const type = piece[1];
  const { f, r } = squareToCoord(from);
  const moves = [];
  if (type === 'P') {
    const dir = color === 'w' ? 1 : -1;
    const oneR = r + dir;
    if (inBounds(f, oneR)) {
      const oneSq = coordToSquare(f, oneR);
      if (isEmpty(position, oneSq)) moves.push(oneSq);
    }
    const startRank = color === 'w' ? 1 : 6;
    const twoR = r + dir * 2;
    if (r === startRank && inBounds(f, twoR)) {
      const oneSq = coordToSquare(f, r + dir);
      const twoSq = coordToSquare(f, twoR);
      if (isEmpty(position, oneSq) && isEmpty(position, twoSq)) moves.push(twoSq);
    }
    for (const df of [-1, 1]) {
      const cf = f + df;
      const cr = r + dir;
      if (inBounds(cf, cr)) {
        const csq = coordToSquare(cf, cr);
        if (isEnemy(position, csq, color)) {
          moves.push(csq);
        } else if (epTarget && csq === epTarget) {
          const behindR = color === 'w' ? (cr - 1) : (cr + 1);
          if (inBounds(cf, behindR)) {
            const behindSq = coordToSquare(cf, behindR);
            const enemyPawn = color === 'w' ? 'bP' : 'wP';
            if (position[behindSq] === enemyPawn) {
              moves.push(csq);
            }
          }
        }
      }
    }
  } else if (type === 'N') {
    const jumps = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
    for (const [df, dr] of jumps) {
      const nf = f + df;
      const nr = r + dr;
      if (!inBounds(nf, nr)) continue;
      const nsq = coordToSquare(nf, nr);
      if (!isOwn(position, nsq, color)) moves.push(nsq);
    }
  } else if (type === 'K') {
    const adj = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [df, dr] of adj) {
      const nf = f + df;
      const nr = r + dr;
      if (!inBounds(nf, nr)) continue;
      const nsq = coordToSquare(nf, nr);
      if (!isOwn(position, nsq, color)) moves.push(nsq);
    }
    const enemy = color === 'w' ? 'b' : 'w';
    if (!isInCheck(position, color)) {
      if (color === 'w' && from === 'e1') {
        if (rights?.wK && position['h1'] === 'wR' && isEmpty(position, 'f1') && isEmpty(position, 'g1')) {
          if (!isSquareAttacked(position, 'e1', enemy) && !isSquareAttacked(position, 'f1', enemy) && !isSquareAttacked(position, 'g1', enemy)) {
            moves.push('g1');
          }
        }
        if (rights?.wQ && position['a1'] === 'wR' && isEmpty(position, 'd1') && isEmpty(position, 'c1') && isEmpty(position, 'b1')) {
          if (!isSquareAttacked(position, 'e1', enemy) && !isSquareAttacked(position, 'd1', enemy) && !isSquareAttacked(position, 'c1', enemy)) {
            moves.push('c1');
          }
        }
      }
      if (color === 'b' && from === 'e8') {
        if (rights?.bK && position['h8'] === 'bR' && isEmpty(position, 'f8') && isEmpty(position, 'g8')) {
          if (!isSquareAttacked(position, 'e8', enemy) && !isSquareAttacked(position, 'f8', enemy) && !isSquareAttacked(position, 'g8', enemy)) {
            moves.push('g8');
          }
        }
        if (rights?.bQ && position['a8'] === 'bR' && isEmpty(position, 'd8') && isEmpty(position, 'c8') && isEmpty(position, 'b8')) {
          if (!isSquareAttacked(position, 'e8', enemy) && !isSquareAttacked(position, 'd8', enemy) && !isSquareAttacked(position, 'c8', enemy)) {
            moves.push('c8');
          }
        }
      }
    }
  } else if (type === 'B') {
    moves.push(...slidingMoves(position, from, color, [[1,1],[1,-1],[-1,1],[-1,-1]]));
  } else if (type === 'R') {
    moves.push(...slidingMoves(position, from, color, [[1,0],[-1,0],[0,1],[0,-1]]));
  } else if (type === 'Q') {
    moves.push(...slidingMoves(position, from, color, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]));
  }
  const final = [];
  for (const to of moves) {
    const next = applyMove(position, from, to, undefined, epTarget);
    if (!isInCheck(next, color)) {
      if (type !== 'K' || !isSquareAttacked(position, to, color === 'w' ? 'b' : 'w')) {
        final.push(to);
      }
    }
  }
  return final;
};

/** Legal moves for the side to move at the position before timeline ply `plyIndex` (matches sidebar). */
export function countLegalMovesAtPly(timeline, plyIndex) {
  if (!timeline?.length) return 0;
  const targetIdx = plyIndex > 0 ? plyIndex - 1 : 0;
  const entry = timeline[targetIdx];
  if (!entry) return 0;

  const pos = entry.position;
  const t = entry.turn;
  const cr = entry.castling;
  const ep = entry.enPassantTarget;

  let count = 0;
  for (const sq of ALL_SQUARES) {
    const piece = pos[sq];
    if (piece && piece[0] === t) {
      count += getLegalMoves(pos, sq, cr, ep).length;
    }
  }
  return count;
}

const chessToPosition = (chess) => {
  const board = chess.board();
  const position = {};
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) {
        const sq = FILES[f] + (8 - r);
        position[sq] = piece.color + piece.type.toUpperCase();
      }
    }
  }
  return position;
};

/** @returns {{ newHistory: object[], newTimeline: object[], header: object } | null} */
function parsePgnToHistoryAndTimeline(pgn) {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const moves = chess.history({ verbose: true });
    const header = chess.header();

    if (moves.length === 0) return null;

    // Extract clocks using regex from the PGN string
    // Format: {[%clk 0:03:01.9]}
    const clockRegex = /\[%clk\s+([\d:.]+)\]/g;
    const clocks = [];
    let match;
    while ((match = clockRegex.exec(pgn)) !== null) {
      clocks.push(match[1]);
    }

    // If we have one extra clock, it's usually the starting clock for white.
    // We want clocks[1] for move 1, clocks[2] for move 2, etc.
    const clockOffset = clocks.length === moves.length + 1 ? 1 : 0;

    const newHistory = moves.map((move, i) => {
      const pLetter = move.piece === 'p' ? '' : move.piece.toUpperCase();
      const isCapture = move.flags.includes('c') || move.flags.includes('e');
      const lan = `${pLetter}${move.from}${isCapture ? 'x' : '-'}${move.to}${move.promotion ? '=' + move.promotion.toUpperCase() : ''}`;
      return {
        san: move.san,
        lan,
        color: move.color,
        uci: move.from + move.to + (move.promotion || ''),
        clock: clocks[i + clockOffset] || null,
      };
    });

    const newTimeline = [{
      position: initialPosition,
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassantTarget: null,
    }];
    const tempGame = new Chess();

    for (const move of moves) {
      tempGame.move(move.san);
      const lastMove = tempGame.history({ verbose: true }).slice(-1)[0];
      let enPassantTarget = null;
      if (lastMove.piece === 'p' && Math.abs(lastMove.from.charCodeAt(1) - lastMove.to.charCodeAt(1)) === 2) {
        enPassantTarget = lastMove.from[0] + (lastMove.color === 'w' ? '3' : '6');
      }

      newTimeline.push({
        position: chessToPosition(tempGame),
        turn: tempGame.turn(),
        castling: {
          wK: tempGame.getCastlingRights('w').k,
          wQ: tempGame.getCastlingRights('w').q,
          bK: tempGame.getCastlingRights('b').k,
          bQ: tempGame.getCastlingRights('b').q,
        },
        enPassantTarget,
      });
    }

    return { newHistory, newTimeline, header };
  } catch (err) {
    console.error('PGN Parse error:', err);
    return null;
  }
}

const mateDistanceToClassificationScore = (mateDistance) => {
  if (!Number.isFinite(mateDistance)) return 999;
  const normalized = Math.max(1, Math.abs(Math.trunc(mateDistance)));
  if (normalized <= 10) return (11 - normalized) * 1000;
  return 999;
};

const scoreToWhiteClassificationValue = (scoreObj, turnForScore) => {
  if (!scoreObj || !Number.isFinite(scoreObj.value)) return null;
  if (scoreObj.type === 'cp') {
    let pawns = scoreObj.value / 100;
    if (turnForScore === 'b') pawns = -pawns;
    return pawns;
  }
  if (scoreObj.type === 'mate') {
    const sign = Math.sign(scoreObj.value);
    const mapped = mateDistanceToClassificationScore(scoreObj.value);
    if (sign === 0) return 0;
    const whiteSigned = turnForScore === 'b' ? -sign : sign;
    return whiteSigned * mapped;
  }
  return null;
};

export const useChessGame = (options = {}) => {
  const multipv = options.multipv || 3;
  const enableAnalysis = options.enableAnalysis !== false;
  const boardLayout = options.boardLayout || 'full';
  const [position, setPosition] = useState(initialPosition);
  const [selected, setSelected] = useState(null);
  const [targets, setTargets] = useState([]);
  const [turn, setTurn] = useState('w');
  const [castling, setCastling] = useState({ wK: true, wQ: true, bK: true, bQ: true });
  const [history, setHistory] = useState([]);
  const [timeline, setTimeline] = useState([{ position: initialPosition, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true } }]);
  const [navIndex, setNavIndex] = useState(0);
  const [whiteAI, setWhiteAI] = useState(false);
  const [blackAI, setBlackAI] = useState(false);
  const [orientation, setOrientation] = useState('white');
  const [analysis, setAnalysis] = useState([]);
  const [analysisSessionId, setAnalysisSessionId] = useState(null);
  const [pgnMetadata, setPgnMetadata] = useState(null);
  const [bookStatusByPly, setBookStatusByPly] = useState([]);
  const [firstNonBookPly, setFirstNonBookPly] = useState(null);

  const [pipelineData, setPipelineData] = useState([]);
  const [enPassantTarget, setEnPassantTarget] = useState(null);


  const [gameOver, setGameOver] = useState(false);

  // Analysis Queue & Worker
  const [analysisQueue, setAnalysisQueue] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzedIndicesRef = useRef(new Set());

  const boardContainerRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(560);

  const positionToFEN = useCallback((pos, t, cr, epSq) => {
    const ranks = [];
    for (let r = 8; r >= 1; r--) {
      let empty = 0;
      let line = '';
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + r;
        const p = pos[sq];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            line += String(empty);
            empty = 0;
          }
          const type = p[1];
          const letter = ({ P: 'P', N: 'N', B: 'B', R: 'R', Q: 'Q', K: 'K' })[type];
          line += p[0] === 'w' ? letter : letter.toLowerCase();
        }
      }
      if (empty > 0) line += String(empty);
      ranks.push(line);
    }
    const board = ranks.join('/');
    const turnStr = t === 'w' ? 'w' : 'b';
    let castlingStr = '';
    if (cr.wK) castlingStr += 'K';
    if (cr.wQ) castlingStr += 'Q';
    if (cr.bK) castlingStr += 'k';
    if (cr.bQ) castlingStr += 'q';
    if (!castlingStr) castlingStr = '-';
    const ep = epSq || '-';
    return `${board} ${turnStr} ${castlingStr} ${ep} 0 1`;
  }, []);

  const analyzePosition = useCallback(async (pos, t, cr, ep, idx) => {
    // Prevent duplicate analysis if already complete
    const currentA = analysis[idx];
    if (currentA && (currentA.error || currentA.score)) return;
    if (analyzedIndicesRef.current.has(idx)) return;
    analyzedIndicesRef.current.add(idx);

    const fen = positionToFEN(pos, t, cr, ep);
    
    // Check for terminal state using chess.js
    const checker = new Chess(fen);
    if (checker.isGameOver()) {
      let score;
      if (checker.isCheckmate()) {
        score = { type: 'mate', value: 0 };
      } else {
        score = { type: 'cp', value: 0 };
      }
      setAnalysis(a => {
        const next = [...a];
        next[idx] = { score, depth: 0, lines: [] };
        return next;
      });
      try {
        const pipelineRes = await fetch(`${API_BASE}/ai/pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen }),
        });
        if (pipelineRes.ok) {
          const pData = await pipelineRes.json();
          setPipelineData((p) => {
            const next = [...p];
            while (next.length <= idx) next.push(null);
            next[idx] = pData;
            return next;
          });
        }
      } catch (e) {
        console.log('Pipeline fetch skipped (game over)', e);
      }
      return;
    }

    // Skip analysis ONLY for empty positions
    const isEmptyFEN = fen.startsWith('8/8/8/8/8/8/8/8');
    if (isEmptyFEN) {
      const defaultAnalysis = { score: { type: 'cp', value: 0 }, depth: 0, lines: [] };
      setAnalysis(a => {
        const next = [...a];
        next[idx] = defaultAnalysis;
        return next;
      });
      try {
        const pipelineRes = await fetch(`${API_BASE}/ai/pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen }),
        });
        if (pipelineRes.ok) {
          const pData = await pipelineRes.json();
          setPipelineData((p) => {
            const next = [...p];
            while (next.length <= idx) next.push(null);
            next[idx] = pData;
            return next;
          });
        }
      } catch (e) {
        console.log('Pipeline fetch skipped (empty FEN)', e);
      }
      return;
    }

    try {
      const currentFen = positionToFEN(pos, t, cr, ep);
      const prevEntry = idx > 0 ? timeline[idx - 1] : null;
      const previousFen = prevEntry
        ? positionToFEN(prevEntry.position, prevEntry.turn, prevEntry.castling, prevEntry.enPassantTarget)
        : currentFen;

      const analyzeRes = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previous_fen: previousFen,
          current_fen: currentFen,
          multipv: multipv
        })
      });
      if (!analyzeRes.ok) {
        throw new Error(`Analyze request failed: ${analyzeRes.status}`);
      }
      const aData = await analyzeRes.json();

      setAnalysis(a => {
        const next = [...a];
        next[idx] = aData;
        return next;
      });

      const pipelineRes = await fetch(`${API_BASE}/ai/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen })
      });
      if (!pipelineRes.ok) {
        throw new Error(`Pipeline request failed: ${pipelineRes.status}`);
      }
      const pData = await pipelineRes.json();

      setPipelineData(p => {
        const next = [...p];
        next[idx] = pData;
        return next;
      });

    } catch (e) {
      console.log('Analysis/Pipeline error', e);
      // Mark this index as failed so the queue does not retry forever.
      setAnalysis(a => {
        const next = [...a];
        next[idx] = { error: String(e?.message || e), depth: 0, lines: [] };
        return next;
      });
    }
  }, [analysis, positionToFEN, timeline]);

  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const stack = el.querySelector('[data-board-fit-stack]');
      const evalBar = boardLayout === 'minimal' ? null : el.querySelector('.eval-bar-bg');
      const styles = window.getComputedStyle(el);
      const gap = Number.parseFloat(styles.gap || styles.columnGap || '16') || 16;
      const evalW =
        boardLayout === 'minimal' ? 0 : (evalBar?.getBoundingClientRect().width || 28) + gap;

      let innerW;
      let innerH;

      if (boardLayout === 'minimal' && stack) {
        const stackStyles = window.getComputedStyle(stack);
        const padX =
          (Number.parseFloat(stackStyles.paddingLeft) || 0) +
          (Number.parseFloat(stackStyles.paddingRight) || 0);
        const padY =
          (Number.parseFloat(stackStyles.paddingTop) || 0) +
          (Number.parseFloat(stackStyles.paddingBottom) || 0);
        const rect = stack.getBoundingClientRect();
        let badgeH = 0;
        stack.querySelectorAll('[data-player-badge]').forEach((node) => {
          badgeH += node.getBoundingClientRect().height;
        });
        const rowGap = Number.parseFloat(stackStyles.rowGap || stackStyles.gap || '0') || 0;
        innerW = Math.max(0, rect.width - padX);
        innerH = Math.max(0, rect.height - padY - badgeH - rowGap * 2);
      } else {
        innerW = Math.max(0, el.clientWidth - evalW);
        innerH = el.clientHeight;
        const scrollRoot = el.closest('[data-app-scroll-root]');
        if (scrollRoot) {
          const sr = scrollRoot.getBoundingClientRect();
          const er = el.getBoundingClientRect();
          innerH = Math.max(innerH || 0, sr.bottom - er.top - 24);
        }
      }

      if (innerW < 80 || innerH < 80) return;
      const side = Math.max(160, Math.min(Math.floor(innerW), Math.floor(innerH), 1200));
      setBoardWidth(side);
    };

    updateSize();
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);
    const stackEl = el.querySelector('[data-board-fit-stack]');
    if (stackEl) ro.observe(stackEl);
    const scrollRootEl = el.closest('[data-app-scroll-root]');
    if (scrollRootEl) ro.observe(scrollRootEl);
    const pageRoot = el.closest('.lichess-game-view');
    if (pageRoot) ro.observe(pageRoot);
    window.addEventListener('resize', updateSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [boardLayout]);

  useEffect(() => {
    const entry = timeline[navIndex];
    if (!entry) return;

    // Restore board state synchronization
    setPosition(entry.position);
    setTurn(entry.turn);
    setCastling(entry.castling);
    setEnPassantTarget(entry.enPassantTarget);

    if (!enableAnalysis) return;

    // Update the queue with any missing indices
    const missing = timeline
      .map((_, idx) => idx)
      .filter(idx => {
        const a = analysis[idx];
        const isComplete = analyzedIndicesRef.current.has(idx) || (a && (a.error || a.score));
        return !isComplete && !analysisQueue.includes(idx);
      });

    if (missing.length > 0) {
      setAnalysisQueue(q => {
        const newItems = missing.filter(idx => !q.includes(idx));
        if (newItems.length === 0) return q;
        
        let nextQ = [...q, ...newItems];
        // Sort so the current view index is processed first, then others chronologically
        return nextQ.sort((a, b) => {
          if (a === navIndex) return -1;
          if (b === navIndex) return 1;
          return a - b;
        });
      });
    }
  }, [navIndex, timeline, analysis, analysisQueue, enableAnalysis]);

  // SEQUENTIAL WORKER LOOP
  useEffect(() => {
    if (!enableAnalysis || isAnalyzing || analysisQueue.length === 0) return;

    const processNext = async () => {
      const idx = analysisQueue[0];
      const entry = timeline[idx];
      
      if (!entry) {
        setAnalysisQueue(q => q.slice(1));
        return;
      }

      setIsAnalyzing(true);
      try {
        await analyzePosition(entry.position, entry.turn, entry.castling, entry.enPassantTarget, idx);
      } catch (e) {
        console.error('Queue worker error', e);
      } finally {
        setAnalysisQueue(q => q.slice(1));
        setIsAnalyzing(false);
      }
    };

    processNext();
  }, [isAnalyzing, analysisQueue, timeline, analyzePosition, enableAnalysis]);

  const aiInFlight = useRef(false);
  const lastAiMs = useRef(0);

  const movePiece = useCallback((from, to, promoteTo) => {
    if (gameOver) return;
    const piece = position[from];
    if (!piece) return;
    
    const captured = position[to];
    const epCapture = piece[1] === 'P' && !captured && enPassantTarget === to;
    const nextPos = applyMove(position, from, to, promoteTo, enPassantTarget);
    const nextCastling = computeCastlingUpdate(castling, piece, from, nextPos);
    
    let san = '';
    let lan = '';
    if (piece[1] === 'K' && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
      san = to[0] === 'g' ? 'O-O' : 'O-O-O';
      lan = san;
    } else {
      const pLetter = piece[1] === 'P' ? '' : piece[1];
      const isCapture = captured || epCapture;
      const captureMark = isCapture ? 'x' : '';
      san = `${pLetter}${captureMark}${to}`;
      lan = `${pLetter}${from}${isCapture ? 'x' : '-'}${to}${promoteTo ? '=' + promoteTo : ''}`;
    }

    const nextTurn = turn === 'w' ? 'b' : 'w';
    let nextEP = null;
    if (piece[1] === 'P' && Math.abs(Number(from[1]) - Number(to[1])) === 2) {
      nextEP = from[0] + (piece[0] === 'w' ? '3' : '6');
    }

    setPosition(nextPos);
    setCastling(nextCastling);
    setTurn(nextTurn);
    setEnPassantTarget(nextEP);
    setHistory(h => [...h.slice(0, navIndex), { 
      san, 
      lan,
      color: turn, 
      uci: from + to + (promoteTo || '') 
    }]);
    setTimeline(tl => [...tl.slice(0, navIndex + 1), { position: nextPos, turn: nextTurn, castling: nextCastling, enPassantTarget: nextEP }]);
    setNavIndex(idx => idx + 1);
    
    setAnalysis(a => a.slice(0, navIndex + 1));
    setPipelineData(p => p.slice(0, navIndex + 1));
    setBookStatusByPly((prev) => prev.slice(0, navIndex + 1));
    setFirstNonBookPly((prev) => {
      if (prev == null) return null;
      return prev <= navIndex ? prev : null;
    });
    analyzedIndicesRef.current = new Set(
      [...analyzedIndicesRef.current].filter((idx) => idx <= navIndex)
    );
    setAnalysisQueue([]); // Clear queue for new moves
  }, [gameOver, position, enPassantTarget, castling, turn, navIndex]);

  const requestAIMove = useCallback(async () => {
    if (navIndex !== timeline.length - 1) return;
    if (gameOver) return;
    if (aiInFlight.current) return;
    aiInFlight.current = true;
    const now = Date.now();
    const gap = now - lastAiMs.current;
    const waitMs = gap >= 100 ? 0 : (100 - gap);
    if (waitMs > 0) {
      await new Promise(r => setTimeout(r, waitMs));
    }
    try {
      const currentFen = positionToFEN(position, turn, castling, enPassantTarget);
      const prevEntry = navIndex > 0 ? timeline[navIndex - 1] : null;
      const previousFen = prevEntry
        ? positionToFEN(prevEntry.position, prevEntry.turn, prevEntry.castling, prevEntry.enPassantTarget)
        : currentFen;
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          previous_fen: previousFen,
          current_fen: currentFen,
          multipv: multipv
        })
      });
      const data = await res.json();
      const mv = data?.move || data?.bestmove;
      if (mv && typeof mv === 'string' && mv.length >= 4) {
        const from = mv.slice(0, 2);
        const to = mv.slice(2, 4);
        const promoChar = mv.length >= 5 ? mv[4].toUpperCase() : undefined;
        if (navIndex === timeline.length - 1) {
          const legal = getLegalMoves(position, from, castling, enPassantTarget);
          if (legal.includes(to)) {
            lastAiMs.current = Date.now();
            return { from, to, promoChar };
          }
        }
      }
    } catch (e) {
      console.log('AI request error', e);
    } finally {
      aiInFlight.current = false;
    }
    return null;
  }, [position, turn, castling, enPassantTarget, navIndex, timeline.length, gameOver, positionToFEN]);

  useEffect(() => {
    if (navIndex !== timeline.length - 1 || gameOver) return;
    if ((turn === 'w' && whiteAI) || (turn === 'b' && blackAI)) {
      const handleAI = async () => {
        const move = await requestAIMove();
        if (move) {
          movePiece(move.from, move.to, move.promoChar);
        }
      };
      handleAI();
    }
  }, [whiteAI, blackAI, turn, navIndex, timeline.length, requestAIMove, gameOver, movePiece]);

  const onSquareClick = (square) => {
    if (selected) {
      if (targets.includes(square)) {
        movePiece(selected, square);
      }
      setSelected(null);
      setTargets([]);
    } else {
      const piece = position[square];
      if (piece && piece[0] === turn) {
        const legal = getLegalMoves(position, square, castling, enPassantTarget);
        setSelected(square);
        setTargets(legal);
      }
    }
  };

  const onPieceDrop = useCallback((sourceSquare, targetSquare, piece) => {
    if (piece[0] !== turn) return false;
    const legal = getLegalMoves(position, sourceSquare, castling, enPassantTarget);
    if (legal.includes(targetSquare)) {
      movePiece(sourceSquare, targetSquare);
      return true;
    }
    return false;
  }, [turn, position, castling, enPassantTarget, movePiece]);

  const resetBoard = () => {
    setPosition(initialPosition);
    setTurn('w');
    setCastling({ wK: true, wQ: true, bK: true, bQ: true });
    setHistory([]);
    setTimeline([{ position: initialPosition, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true } }]);
    setNavIndex(0);
    setEnPassantTarget(null);
    setGameOver(false);
    analyzedIndicesRef.current.clear();
    setAnalysisQueue([]); // Reset analysis queue
    setPipelineData([]);
    setAnalysisSessionId(null);
    setBookStatusByPly([]);
    setFirstNonBookPly(null);
    lastKnownEval.current = { percent: 50, display: { text: "0.0", side: 'w' } };
  };

  const loadPGN = useCallback((pgn, meta = {}) => {
    const parsed = parsePgnToHistoryAndTimeline(pgn);
    if (!parsed) {
      console.error('PGN load error');
      return false;
    }

    const { newHistory, newTimeline, header } = parsed;

    setHistory(newHistory);
    setTimeline(newTimeline);
    setNavIndex(newTimeline.length - 1);
    setAnalysis(new Array(newTimeline.length).fill(null));
    setPipelineData(new Array(newTimeline.length).fill(null));
    analyzedIndicesRef.current.clear();
    setAnalysisQueue([]);
    setAnalysisSessionId(null);
    setPgnMetadata(header);
    setBookStatusByPly([]); // Reset book status
    setFirstNonBookPly(null);

    if (!meta.skipSessionCreate) {
      const totalPlies = newTimeline.length;
      fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pgn_text: pgn,
          input_filename: meta.input_filename != null ? String(meta.input_filename) : (header.White && header.Black ? `${header.White} vs ${header.Black}` : null),
          input_source: meta.input_source != null ? String(meta.input_source) : 'pgn_paste',
          progress_total: totalPlies,
          pgn_metadata: JSON.stringify(header),
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Create session ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (data?.id != null) setAnalysisSessionId(Number(data.id));
        })
        .catch((err) => console.error('[analysis session]', err.message));
    }

    return true;
  }, []);

  const restoreSessionFromDb = useCallback(async (sessionId) => {
    const id = Number(sessionId);
    if (!Number.isFinite(id)) return false;
    try {
      const [sRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/api/sessions/${id}`),
        fetch(`${API_BASE}/api/sessions/${id}/moves`),
      ]);
      if (!sRes.ok) return false;
      const { session } = await sRes.json();
      const movesPayload = mRes.ok ? await mRes.json() : { moves: [] };
      const moves = movesPayload.moves || [];
      const pgn = session?.pgn_text;
      if (!pgn || typeof pgn !== 'string') return false;

      const parsed = parsePgnToHistoryAndTimeline(pgn);
      if (!parsed) return false;

      const { newHistory, newTimeline, header } = parsed;
      const len = newTimeline.length;

      // Use stored metadata if available, otherwise fallback to parsed header
      let metaHeader = header;
      if (session.pgn_metadata) {
        try {
          metaHeader = JSON.parse(session.pgn_metadata);
        } catch (e) {
          console.warn('Failed to parse stored pgn_metadata', e);
        }
      }

      setHistory(newHistory);
      setTimeline(newTimeline);
      setNavIndex(len - 1);
      setPgnMetadata(metaHeader);
      setGameOver(false);
      setSelected(null);
      setTargets([]);

      const analysisArr = new Array(len).fill(null);
      const pipelineArr = new Array(len).fill(null);
      const analyzed = new Set();

      for (const row of moves) {
        const pi = Number(row.ply_index);
        if (!Number.isFinite(pi) || pi < 0 || pi >= len) continue;
        if (row.stockfish_json) {
          try {
            analysisArr[pi] = JSON.parse(row.stockfish_json);
            analyzed.add(pi);
          } catch {
            /* ignore */
          }
        }
        if (row.pipeline_json) {
          try {
            pipelineArr[pi] = JSON.parse(row.pipeline_json);
          } catch {
            /* ignore */
          }
        }
      }

      setAnalysis(analysisArr);
      setPipelineData(pipelineArr);
      analyzedIndicesRef.current = analyzed;
      setAnalysisQueue([]);
      setAnalysisSessionId(null);
      setBookStatusByPly([]); // Reset book status
      setFirstNonBookPly(null);

      const last = newTimeline[len - 1];
      setPosition(last.position);
      setTurn(last.turn);
      setCastling(last.castling);
      setEnPassantTarget(last.enPassantTarget ?? null);

      return true;
    } catch (e) {
      console.error('[restoreSession]', e);
      return false;
    }
  }, []);

  // BOOK CHECK EFFECT
  useEffect(() => {
    if (!enableAnalysis) return;

    if (history.length === 0) {
      // Handle initial position
      if (bookStatusByPly[0] == null) {
        setBookStatusByPly([
          { isBook: true, opening: null, nextMoves: [] }
        ]);
      }
      return;
    }

    // We want to check book status for ALL plies that don't have it yet.
    // However, the current logic only checks the "latest" move.
    // Let's modify it to be more robust for PGN imports.
    
    const missingIndices = [];
    for (let i = 1; i <= history.length; i++) {
      if (bookStatusByPly[i] === undefined || bookStatusByPly[i] === null) {
        missingIndices.push(i);
      }
    }

    if (missingIndices.length === 0) return;

    // Check sequentially from the first missing index.
    const targetPly = Math.min(...missingIndices);
    
    // If the previous ply is already marked as not book, this one is too.
    if (targetPly > 1 && bookStatusByPly[targetPly - 1] && !bookStatusByPly[targetPly - 1].isBook) {
      setBookStatusByPly(prev => {
        const next = [...prev];
        while (next.length <= history.length) next.push(null);
        next[targetPly] = { isBook: false, opening: null, nextMoves: [] };
        return next;
      });
      return;
    }

    const moves = history.slice(0, targetPly).map((m) => m?.san).filter(Boolean);
    
    if (moves.length === 0) return;

    let cancelled = false;
    fetch(`${API_BASE}/api/book/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moves }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const isBook = !!data?.is_book_move;
        setBookStatusByPly((prev) => {
          const next = [...prev];
          // Ensure array is large enough
          while (next.length <= history.length) next.push(null);
          
          const slot = {
            isBook,
            opening: data?.opening || null,
            nextMoves: Array.isArray(data?.next_book_moves) ? data.next_book_moves : [],
          };

          if (isBook) {
            // If move N is book, moves 1..N are all book.
            for (let p = 1; p <= targetPly; p++) {
              // Only overwrite if not already set or if we have better info
              if (!next[p] || (!next[p].opening && slot.opening)) {
                next[p] = slot;
              }
            }
          } else {
            // If move N is NOT book, moves N..END are all NOT book.
            for (let p = targetPly; p <= history.length; p++) {
              if (!next[p]) {
                next[p] = slot;
              }
            }
          }
          return next;
        });

        if (!isBook && (firstNonBookPly === null || targetPly < firstNonBookPly)) {
          setFirstNonBookPly(targetPly);
        }
      })
      .catch((e) => {
        console.error('[book-check]', e);
      });

    return () => {
      cancelled = true;
    };
  }, [history, firstNonBookPly, bookStatusByPly, enableAnalysis]);

  const lastKnownEval = useRef({ percent: 50, display: { text: "0.00", side: 'w' } });

  const currentTurn = timeline[navIndex]?.turn || turn;

  const navigateHistory = useCallback((direction) => {
    setNavIndex(prev => {
      if (direction === 'prev') return Math.max(0, prev - 1);
      if (direction === 'next') return Math.min(timeline.length - 1, prev + 1);
      if (direction === 'start') return 0;
      if (direction === 'end') return timeline.length - 1;
      return prev;
    });
  }, [timeline.length]);

  useEffect(() => {
     const handleKeyDown = (e) => {
       if (e.key === 'ArrowLeft') {
         e.preventDefault(); // Prevent page scroll
         navigateHistory('prev');
       } else if (e.key === 'ArrowRight') {
         e.preventDefault(); // Prevent page scroll
         navigateHistory('next');
       }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
   }, [navigateHistory]);

  const { percent: evalPercent, display: displayScore } = useMemo(() => {
    const cur = analysis[navIndex];
    if (!cur || !cur.score) {
      return lastKnownEval.current;
    }

    const s = cur.score;
    const turnOfAnalysis = timeline[navIndex]?.turn || turn;

    let v;
    if (s.type === 'cp') {
      v = s.value / 100;
      if (turnOfAnalysis === 'b') v = -v; // Convert to White's perspective
    } else { // 'mate'
      v = s.value;
      if (turnOfAnalysis === 'b') v = -v; // Convert to White's perspective
    }

    let percent;
    const whiteWinProb = cur?.winProbability?.white;
    if (typeof whiteWinProb === 'number' && Number.isFinite(whiteWinProb)) {
      percent = Math.max(0, Math.min(100, whiteWinProb));
    } else
    if (s.type === 'mate') {
      if (v > 0) percent = 100;
      else if (v < 0) percent = 0;
      else {
        // Mate in 0 means side-to-move is checkmated.
        percent = turnOfAnalysis === 'w' ? 0 : 100;
      }
    } else {
      // Piecewise linear mapping based on user's definition
      if (v >= 8) percent = 100;
      else if (v >= 4) percent = 90 + ((v - 4) / 4) * 10;
      else if (v >= 0) percent = 50 + (v / 4) * 40;
      else if (v >= -4) percent = 10 + ((v + 4) / 4) * 40;
      else if (v >= -8) percent = 0 + ((v + 8) / 4) * 10;
      else percent = 0;
    }

    const side = v >= 0 ? 'w' : 'b';
    
    const displayScoreValue = s.type === 'mate' ? `M${Math.abs(v)}` : (v >= 0 ? '+' : '') + v.toFixed(2);
    const display = { text: displayScoreValue, side };

    const result = { percent, display };
    lastKnownEval.current = result;
    return result;
  }, [analysis, navIndex, timeline, turn]);

  const bestMovesList = useMemo(() => {
    // Backend provides best lines for previous_fen inside the current analysis entry.
    const cur = analysis[navIndex];
    if (!cur || !cur.lines) return [];
    
    const turnOfAnalysis = navIndex > 0
      ? timeline[navIndex - 1]?.turn
      : timeline[0]?.turn;
    
    return cur.lines.map(line => {
      const raw = line?.score?.value;
      const isMate = line?.score?.type === 'mate';
      const rawCpOrMate = Number.isFinite(raw) ? raw : 0;
      const firstMoveRaw = line?.firstMoveScore?.value;
      const firstMoveIsMate = line?.firstMoveScore?.type === 'mate';
      const firstMoveRawCpOrMate = Number.isFinite(firstMoveRaw) ? firstMoveRaw : null;
      let whiteEval = isMate ? rawCpOrMate : (rawCpOrMate / 100);
      if (turnOfAnalysis === 'b') whiteEval = -whiteEval; // White perspective for display
      const scoreStr = isMate ? `#${whiteEval}` : (whiteEval >= 0 ? '+' : '') + whiteEval.toFixed(2);

      let firstMoveWhiteEval = null;
      let firstMoveClassificationWhiteEval = null;
      let firstMoveScoreStr = null;
      let rankingIsMate = false;
      let rankingMateDistance = null;
      if (firstMoveRawCpOrMate !== null) {
        firstMoveWhiteEval = firstMoveIsMate ? firstMoveRawCpOrMate : (firstMoveRawCpOrMate / 100);
        // firstMoveScore is evaluated on the position AFTER first move, where side-to-move flips.
        // Convert to White perspective from that post-move side-to-move score.
        if (turnOfAnalysis === 'w') firstMoveWhiteEval = -firstMoveWhiteEval;
        firstMoveScoreStr = firstMoveIsMate
          ? `#${firstMoveWhiteEval}`
          : (firstMoveWhiteEval >= 0 ? '+' : '') + firstMoveWhiteEval.toFixed(2);
        firstMoveClassificationWhiteEval = scoreToWhiteClassificationValue(
          line.firstMoveScore,
          turnOfAnalysis === 'w' ? 'b' : 'w'
        );
        rankingIsMate = !!firstMoveIsMate;
        rankingMateDistance = firstMoveIsMate ? Math.abs(firstMoveWhiteEval) : null;
      } else {
        // Fallback to full PV score only when first-move specific eval is unavailable.
        firstMoveScoreStr = scoreStr;
        firstMoveWhiteEval = whiteEval;
        firstMoveClassificationWhiteEval = scoreToWhiteClassificationValue(line.score, turnOfAnalysis);
        rankingIsMate = isMate;
        rankingMateDistance = isMate ? Math.abs(whiteEval) : null;
      }

      const rankingMoverEval = Number.isFinite(firstMoveClassificationWhiteEval)
        ? (turnOfAnalysis === 'w' ? firstMoveClassificationWhiteEval : -firstMoveClassificationWhiteEval)
        : -Infinity;

      return {
        move: line.pv.split(' ')[0], // UCI move
        score: scoreStr,
        moverEval: rankingMoverEval,
        whiteEval: firstMoveWhiteEval,
        classificationWhiteEval: firstMoveClassificationWhiteEval,
        isMate: rankingIsMate,
        mateDistance: rankingMateDistance,
        firstMoveScore: firstMoveScoreStr,
        firstMoveWhiteEval,
      };
    });
  }, [analysis, navIndex, timeline]);

  const prevEval = useMemo(() => {
    if (navIndex === 0) return null;
    const prev = analysis[navIndex - 1];
    if (!prev || !prev.score) return null;
    
    const s = prev.score;
    const turnOfAnalysis = timeline[navIndex - 1]?.turn;
    let v = s.type === 'cp' ? s.value / 100 : s.value;
    if (turnOfAnalysis === 'b') v = -v;
    return s.type === 'mate' ? `#${v}` : (v >= 0 ? '+' : '') + v.toFixed(2);
  }, [analysis, navIndex, timeline]);

  const playedMoveEval = useMemo(() => {
    if (navIndex === 0) return null;
    const current = analysis[navIndex];
    const prev = analysis[navIndex - 1];
    
    const moveUCI = history[navIndex - 1]?.uci;
    if (!moveUCI) return null;

    const turnOfAnalysis = timeline[navIndex - 1]?.turn;

    // 1. Check current analysis for specific playedMoveEval (searchmoves)
    if (current?.playedMoveEval) {
      let v = current.playedMoveEval.type === 'cp' ? current.playedMoveEval.value / 100 : current.playedMoveEval.value;
      if (turnOfAnalysis === 'b') v = -v;
      return current.playedMoveEval.type === 'mate' ? `#${v}` : (v >= 0 ? '+' : '') + v.toFixed(2);
    }

    // 2. Otherwise look for it in current entry's previous_fen MultiPV lines
    if (current?.lines) {
      const line = current.lines.find(l => l.pv.startsWith(moveUCI));
      if (line) {
        let v = line.score.type === 'cp' ? line.score.value / 100 : line.score.value;
        if (turnOfAnalysis === 'b') v = -v;
        return line.score.type === 'mate' ? `#${v}` : (v >= 0 ? '+' : '') + v.toFixed(2);
      }
    }



    return null;
  }, [analysis, navIndex, history, timeline]);

  const legalMovesCount = useMemo(
    () => countLegalMovesAtPly(timeline, navIndex),
    [navIndex, timeline]
  );

  const moveClassifications = useMemo(() => {
    if (!history.length) return [];
    return history.map((_, hi) => classifyPlayedMoveAtNavIndex(analysis, timeline, history, hi + 1, bookStatusByPly));
  }, [analysis, history, timeline, bookStatusByPly]);

  const analysisProgress = useMemo(() => {
    if (timeline.length === 0) return 100;
    // Count as analyzed if score exists or we recorded an error (avoid infinite retries).
    const analyzedCount = timeline.filter((_, idx) => {
      const a = analysis[idx];
      return a && (a.error || a.score);
    }).length;
    return Math.round((analyzedCount / timeline.length) * 100);
  }, [timeline, analysis]);

  const mergePipelineDataAtIndex = useCallback((idx, data) => {
    if (!data?.tables) return;
    setPipelineData((prev) => {
      if (prev[idx]?.tables) return prev;
      const out = [...prev];
      while (out.length <= idx) out.push(null);
      out[idx] = data;
      return out;
    });
  }, []);

  const mergePipelineSlots = useCallback((slots) => {
    setPipelineData((prev) => {
      const maxLen = Math.max(prev.length, slots.length);
      const out = [...prev];
      while (out.length < maxLen) out.push(null);
      let changed = false;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i]?.tables && out[i] !== slots[i]) {
          out[i] = slots[i];
          changed = true;
        }
      }
      return changed ? out : prev;
    });
  }, []);

  return {
    position,
    selected,
    targets,
    turn,
    castling,
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

    pipelineData,
    mergePipelineDataAtIndex,
    mergePipelineSlots,
    enPassantTarget,
    gameOver,
    boardWidth,
    boardContainerRef,
    onSquareClick,
    onPieceDrop,
    resetBoard,
    loadPGN,
    restoreSessionFromDb,
    evalPercent,
    displayScore,
    currentTurn,
    currentFEN: positionToFEN(position, turn, castling, enPassantTarget),
    fenAtMove: navIndex > 0 ? positionToFEN(timeline[navIndex - 1].position, timeline[navIndex - 1].turn, timeline[navIndex - 1].castling, timeline[navIndex - 1].enPassantTarget) : positionToFEN(timeline[0].position, timeline[0].turn, timeline[0].castling, timeline[0].enPassantTarget),
    navigateHistory,
    currentMove: history[navIndex - 1] || null,
    bestMove: analysis[navIndex]?.move || analysis[navIndex]?.bestmove || (analysis[navIndex]?.lines?.[0]?.pv?.split(' ')?.[0]) || null,
    winPercent: evalPercent,
    bestMovesList,
    prevEval,
    playedMoveEval,
    legalMovesCount,
    bookStatusByPly,
    firstNonBookPly,
    moveClassifications,
    analysisProgress,
    analysisSessionId,
    pgnMetadata,
    multipv,
  };
};
