const fs = require('fs');
const readline = require('readline');

function hasMovetext(lines) {
  return lines.some((line) => {
    const t = line.trim();
    return t && !t.startsWith('[');
  });
}

function toGameBlock(lines) {
  return lines.join('\n').trim();
}

/**
 * Stream games from a multi-game PGN file without loading the whole file.
 * Yields { gameIndex, rawPgn } for each game block.
 */
async function* streamPgnGames(filePath, options = {}) {
  const { limit = Infinity, skip = 0, onProgress } = options;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let buffer = [];
  let fileGameIndex = 0;
  let yielded = 0;

  const emit = function* emit() {
    const text = toGameBlock(buffer);
    buffer = [];
    if (!text || !text.startsWith('[')) return;
    const idx = fileGameIndex;
    fileGameIndex += 1;
    if (idx < skip) return;
    if (yielded >= limit) return;
    yield { gameIndex: idx, rawPgn: text };
    yielded += 1;
    if (typeof onProgress === 'function') onProgress({ gameIndex: yielded, fileGameIndex: idx + 1 });
  };

  for await (const line of rl) {
    if (yielded >= limit) break;

    const trimmed = line.trim();

    if (trimmed.startsWith('[') && buffer.length > 0 && hasMovetext(buffer)) {
      for (const game of emit()) {
        yield game;
        if (yielded >= limit) break;
      }
      if (yielded >= limit) break;
    }

    if (trimmed === '') {
      if (buffer.length > 0 && hasMovetext(buffer)) {
        for (const game of emit()) {
          yield game;
          if (yielded >= limit) break;
        }
      }
      continue;
    }

    buffer.push(line);
  }

  if (yielded < limit && buffer.length > 0) {
    for (const game of emit()) {
      yield game;
      if (yielded >= limit) break;
    }
  }
}

module.exports = { streamPgnGames };
