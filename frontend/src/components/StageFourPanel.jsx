import React, { useMemo, useState } from 'react';

function statusBadge(status) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'running') return 'bg-indigo-100 text-indigo-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function classificationClass(c) {
  if (c === 'BRILLIANT') return 'text-amber-700 font-black';
  if (c === 'practical_brilliant') return 'text-indigo-700 font-semibold';
  if (c === 'great_sacrifice') return 'text-emerald-700';
  return 'text-slate-600';
}

function archetypeLabel(a) {
  return (a || 'masterstroke').replace(/_/g, ' ');
}

export default function StageFourPanel({ data, loading, error, onRerun, navIndex, setNavIndex }) {
  const [expandedPly, setExpandedPly] = useState(null);

  const currentMove = useMemo(() => {
    if (!data?.moves?.length || navIndex <= 0) return null;
    return data.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [data, navIndex]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500 px-4 py-6">
        Running Stage 4 human perception model (rating-relative surprise + archetype)…
      </p>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-red-700 mb-2">{error}</p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-xs font-semibold text-indigo-600 hover:underline">
            Retry Stage 4
          </button>
        )}
      </div>
    );
  }

  const moves = data?.moves || [];

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-100 bg-violet-50/50">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-600">
              Stage 3 passers · <strong className="text-violet-800">no engine</strong> · rating-relative surprise +
              practical brilliance + archetype
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Final brilliance score (0–10) · BRILLIANT ≥ 6.5 + sound at d25
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${statusBadge(data?.status)}`}>
            {data?.status || 'pending'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <Metric label="Analyzed" value={data?.analyzed_count ?? moves.length} accent="text-violet-700" />
          <Metric label="BRILLIANT" value={data?.brilliant_count ?? 0} accent="text-amber-700" />
          <Metric label="Practical+" value={data?.practical_brilliant_count ?? 0} accent="text-indigo-700" />
          <Metric label="Engine" value="None" />
        </div>
      </div>

      {currentMove && (
        <div className="px-4 py-3 border-b border-violet-100 bg-violet-50/70">
          <div className="text-[10px] font-bold uppercase text-violet-900 mb-1">
            Current (ply {currentMove.ply_index})
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{currentMove.san_move}</span>
            <span className={`text-xs uppercase ${classificationClass(currentMove.classification)}`}>
              {currentMove.classification}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-white border border-violet-200 text-violet-800">
              {archetypeLabel(currentMove.archetype)}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
            <span>Score: {currentMove.brilliance_score}</span>
            <span>Surprise: {currentMove.surprise_score}</span>
            <span>PB: {currentMove.pb_score} ({currentMove.pb_category})</span>
            <span>Rating: {currentMove.player_rating}</span>
          </div>
        </div>
      )}

      {moves.length === 0 ? (
        <p className="text-sm text-slate-500 px-4 py-6">No moves reached Stage 4 (requires Stage 3).</p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-2">Ply</th>
                <th className="px-2 py-2">Move</th>
                <th className="px-2 py-2">Score</th>
                <th className="px-2 py-2">Class</th>
                <th className="px-2 py-2">Archetype</th>
                <th className="px-2 py-2">Surprise</th>
                <th className="px-2 py-2">PB</th>
                <th className="px-2 py-2">Elo</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const isActive = navIndex === m.ply_index + 1;
                const rowClass = m.is_brilliant
                  ? 'bg-amber-50/70'
                  : m.classification === 'practical_brilliant'
                    ? 'bg-indigo-50/40'
                    : 'bg-violet-50/30';
                return (
                  <React.Fragment key={m.ply_index}>
                    <tr
                      className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                        isActive ? 'bg-indigo-50 ring-1 ring-indigo-200' : rowClass
                      }`}
                      onClick={() => {
                        setNavIndex(m.ply_index + 1);
                        setExpandedPly(expandedPly === m.ply_index ? null : m.ply_index);
                      }}
                    >
                      <td className="px-2 py-1.5 font-mono">{m.ply_index}</td>
                      <td className="px-2 py-1.5 font-semibold">{m.san_move}</td>
                      <td className="px-2 py-1.5 font-mono font-bold">{m.brilliance_score}</td>
                      <td className={`px-2 py-1.5 uppercase text-[10px] ${classificationClass(m.classification)}`}>
                        {m.classification}
                      </td>
                      <td className="px-2 py-1.5 capitalize">{archetypeLabel(m.archetype)}</td>
                      <td className="px-2 py-1.5 font-mono">{m.surprise_score}</td>
                      <td className="px-2 py-1.5 font-mono">{m.pb_score}</td>
                      <td className="px-2 py-1.5 font-mono">{m.player_rating}</td>
                    </tr>
                    {expandedPly === m.ply_index && m.features && (
                      <tr className="bg-slate-50">
                        <td colSpan={8} className="px-3 py-2">
                          <pre className="text-[10px] leading-relaxed overflow-x-auto text-slate-600 whitespace-pre-wrap">
                            {JSON.stringify(m.features, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2">
        <p className="text-[10px] text-slate-400">
          Weights: non-obvious 30% · surprise 25% · practical 20% · defense 10% · multiplex 10% · EV 5%
        </p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-[10px] font-semibold text-indigo-600 hover:underline">
            Re-run Stage 4
          </button>
        )}
      </div>
    </>
  );
}

function Metric({ label, value, accent = 'text-slate-900' }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2 py-1.5">
      <div className="text-[10px] text-slate-400 uppercase">{label}</div>
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
