import React, { useState, useEffect } from 'react';
import { API_BASE } from '../config/api';

const DataPipelineTable = ({
  fen,
  currentMove,
  moveNo,
  player,
  playedMoveStanding,
  bestMovesList,
  prevEval,
  playedMoveEval,
  legalMovesCount,
  bookStatus,
  displayScore,
  winPercent,
  mode = 'analysis',
}) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!fen) return;
    setIsLoading(true);
    fetch(`${API_BASE}/ai/pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen }),
    })
      .then((res) => res.json())
      .then((json) => {
        setError(null);
        setData(json);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [fen]);

  const parseCp = (s) => {
    const t = String(s ?? '').trim().toUpperCase();
    if (!t) return null;
    if (t.startsWith('#') || t.startsWith('M')) {
      const val = parseFloat(t.replace('#', '').replace('M', ''));
      return val > 0 ? 10000 : -10000;
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n * 100 : null;
  };

  const { tables } = data || {};
  const isInitialPosition = moveNo === 0;
  const loading = isLoading && !tables && !!fen;

  return (
    <div className="flex flex-col gap-6">
      {loading && (
        <div className="flex justify-end items-center mb-4 min-h-[32px]">
          <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold animate-pulse bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
            <div className="w-2 h-2 bg-emerald-600 rounded-full"></div>
            Analyzing position...
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
          <h3 className="font-bold mb-1">Pipeline Error</h3>
          <p>{error}</p>
        </div>
      )}

      {!tables && !loading ? (
        <div className="p-10 text-center text-slate-400 italic">Select a move to see pipeline data</div>
      ) : (
        <div className={loading ? "opacity-50 pointer-events-none transition-opacity duration-200" : "transition-opacity duration-200"}>
          {/* Chess Data Pipeline Metrics - Hidden as requested
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="text-emerald-600">♟</span> Chess Data Pipeline Metrics
            </h2>
          </div>

          <table className="w-full text-left text-sm border-collapse">
            ...
          </table>
          */}
        </div>
      )}
    </div>
  );
};

export default DataPipelineTable;
