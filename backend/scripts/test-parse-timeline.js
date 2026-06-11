/**
 * Replicate frontend parsePgnToHistoryAndTimeline castling/timeline build.
 */
const { db } = require('../db/database');
const { Chess } = require('chess.js');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const initialPosition = {
  a8: 'bR', b8: 'bN', c8: 'bB', d8: 'bQ', e8: 'bK', f8: 'bB', g8: 'bN', h8: 'bR',
  a7: 'bP', b7: 'bP', c7: 'bP', d7: 'bP', e7: 'bP', f7: 'bP', g7: 'bP', h7: 'bP',
  a2: 'wP', b2: 'wP', c2: 'wP', d2: 'wP', e2: 'wP', f2: 'wP', g2: 'wP', h2: 'wP',
  a1: 'wR', b1: 'wN', c1: 'wB', d1: 'wQ', e1: 'wK', f1: 'wB', g1: 'wN', h1: 'wR',
};

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

function parsePgnToHistoryAndTimeline(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });
  if (moves.length === 0) return null;

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

    const rights = {
      wK: tempGame.getCastlingRights('w').k,
      wQ: tempGame.getCastlingRights('w').q,
      bK: tempGame.getCastlingRights('b').k,
      bQ: tempGame.getCastlingRights('b').q,
    };

    newTimeline.push({
      position: chessToPosition(tempGame),
      turn: tempGame.turn(),
      castling: rights,
      enPassantTarget,
    });
  }

  return newTimeline;
}

const ids = db.prepare('SELECT id FROM analysis_sessions ORDER BY id').all();
let failed = 0;
for (const { id } of ids) {
  const pgn = db.prepare('SELECT pgn_text FROM analysis_sessions WHERE id = ?').get(id).pgn_text;
  try {
    parsePgnToHistoryAndTimeline(pgn);
  } catch (e) {
    failed += 1;
    console.log('FAIL session', id, e.message);
  }
}
console.log('Tested', ids.length, 'sessions, failures', failed);
