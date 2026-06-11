const { Chess } = require('chess.js');

function parseHeaders(rawPgn) {
  const headers = {};
  for (const line of String(rawPgn || '').split('\n')) {
    const m = line.match(/^\[(\w+)\s+"(.*)"\]\s*$/);
    if (m) headers[m[1]] = m[2];
  }
  return headers;
}

function extractLichessGameId(rawPgn) {
  const site = parseHeaders(rawPgn).Site || '';
  const m = site.match(/lichess\.org\/([a-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

function parsePgnGame(rawPgn) {
  const text = String(rawPgn || '').trim();
  if (!text) throw new Error('Empty PGN');

  const chess = new Chess();
  try {
    chess.loadPgn(text);
  } catch (e) {
    throw new Error(`Invalid PGN: ${e?.message || String(e)}`);
  }

  const headers = parseHeaders(text);
  const cleanPgn = chess.pgn();
  const verbose = chess.history({ verbose: true });
  const replay = new Chess();
  const moves = [];

  for (let i = 0; i < verbose.length; i++) {
    const fenBefore = replay.fen();
    const m = verbose[i];
    replay.move(m.san);
    moves.push({
      ply_index: i,
      move_number: String(Math.floor(i / 2) + 1),
      turn: m.color === 'w' ? 'w' : 'b',
      san_move: m.san,
      uci_move: m.from + m.to + (m.promotion || ''),
      fen_before_move: fenBefore,
      fen_after_move: replay.fen(),
    });
  }

  return {
    headers,
    cleanPgn,
    lichessGameId: extractLichessGameId(text),
    moves,
  };
}

module.exports = { parseHeaders, extractLichessGameId, parsePgnGame };
