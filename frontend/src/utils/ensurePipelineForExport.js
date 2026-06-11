import { API_BASE } from '../config/api';

/**
 * Fetches /ai/pipeline for every timeline index used by the analysis export
 * (position before each row's move: targetIdx = idx > 0 ? idx - 1 : 0).
 */
export async function ensurePipelineSlotsForExport(timeline, pipelineData, positionToFENExport) {
  const len = timeline.length;
  const merged = Array.from({ length: len }, (_, i) => pipelineData[i] ?? null);

  const need = new Set();
  for (let idx = 0; idx < len; idx++) {
    const targetIdx = idx > 0 ? idx - 1 : 0;
    if (!merged[targetIdx]?.tables) need.add(targetIdx);
  }

  await Promise.all(
    [...need].map(async (ti) => {
      const e = timeline[ti];
      if (!e) return;
      const fen = positionToFENExport(e.position, e.turn, e.castling, e.enPassantTarget);
      try {
        const res = await fetch(`${API_BASE}/ai/pipeline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen }),
        });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.tables) merged[ti] = json;
      } catch {
        /* ignore */
      }
    })
  );

  return merged;
}
