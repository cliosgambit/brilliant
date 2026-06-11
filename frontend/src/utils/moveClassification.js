/**
 * CPL-based move classification (chess_move_classification_report).
 * deltaFromBest is in pawns: 1.0 pawn = 100 centipawns.
 *
 * | Classification | CPL range |
 * | Best           | 0         |
 * | Excellent      | < 50cp    |
 * | Good           | < 100cp   |
 * | Inaccuracy     | 100–300cp |
 * | Mistake        | 300–500cp |
 * | Blunder        | > 500cp   |
 */
export function classifyMoveByCplDelta(deltaFromBestPawns) {
  if (!Number.isFinite(deltaFromBestPawns)) return null;
  if (deltaFromBestPawns <= 0) return 'best';
  if (deltaFromBestPawns < 0.5) return 'excellent';
  if (deltaFromBestPawns < 1.0) return 'good';
  if (deltaFromBestPawns < 3.0) return 'inaccuracy';
  if (deltaFromBestPawns < 5.0) return 'mistake';
  return 'blunder';
}

/** Great move: near-best (0–30cp) in a narrow winning path — optional tier above best. */
export function classifyMoveByCplDeltaWithGreat(deltaFromBestPawns) {
  const base = classifyMoveByCplDelta(deltaFromBestPawns);
  if (base === 'best' && deltaFromBestPawns > 0 && deltaFromBestPawns <= 0.3) {
    return 'great';
  }
  return base;
}
