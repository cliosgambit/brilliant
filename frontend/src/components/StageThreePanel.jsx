import React, { useMemo, useState } from 'react';

function statusBadge(status) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'running') return 'bg-indigo-100 text-indigo-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function boolCell(v, yesClass = 'text-emerald-700') {
  if (v) return <span className={`${yesClass} font-semibold`}>Yes</span>;
  return <span className="text-slate-400">—</span>;
}

function formatWhiteCp(cp) {
  if (cp == null || !Number.isFinite(cp)) return '—';
  if (Math.abs(cp) >= 9000) {
    const mateIn = Math.max(1, 10000 - Math.abs(cp));
    return cp > 0 ? `+M${mateIn}` : `-M${mateIn}`;
  }
  const pawns = cp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export default function StageThreePanel({ data, loading, error, onRerun, navIndex, setNavIndex }) {
  const [expandedPly, setExpandedPly] = useState(null);

  const currentMove = useMemo(() => {
    if (!data?.moves?.length || navIndex <= 0) return null;
    return data.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [data, navIndex]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500 px-4 py-6">
        Running Stage 3 deep Stockfish (depth curve d5–18, rank d8/d18, defense d18)…
      </p>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-red-700 mb-2">{error}</p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-xs font-semibold text-indigo-600 hover:underline">
            Retry Stage 3
          </button>
        )}
      </div>
    );
  }

  const moves = data?.moves || [];

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-100 bg-red-50/40">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-600">
              Stage 2 passers only · <strong className="text-red-800">Stockfish d5–18 depth curve</strong> + rank
              d8/d18 + defense d18
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              All cp evals in <strong>white POV</strong> (+ = white better) · rising curve &amp; non-obviousness signals
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${statusBadge(data?.status)}`}>
            {data?.status || 'pending'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          <Metric label="Analyzed" value={data?.analyzed_count ?? moves.length} accent="text-red-700" />
          <Metric label="Sound (d18)" value={data?.sound_count ?? 0} accent="text-emerald-700" />
          <Metric label="Unsound" value={data?.unsound_count ?? 0} accent="text-amber-700" />
          <Metric label="Rising curve" value={data?.rising_curve_count ?? 0} />
          <Metric label="Non-obvious" value={data?.non_obvious_count ?? 0} accent="text-indigo-700" />
        </div>
      </div>

      {currentMove && (
        <div className="px-4 py-3 border-b border-red-100 bg-red-50/60">
          <div className="text-[10px] font-bold uppercase text-red-900 mb-1">
            Current (ply {currentMove.ply_index})
          </div>
          <div className="text-sm font-semibold text-slate-900">{currentMove.san_move}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
            <span>Deep eval: {formatWhiteCp(currentMove.deep_eval_cp)}</span>
            <span>Non-obvious: {currentMove.non_obvious_score?.toFixed?.(2) ?? currentMove.non_obvious_score}</span>
            <span>Rank d8→d18: {currentMove.rank_at_depth8}→{currentMove.rank_at_depth22}</span>
            <span>Depth gain: {currentMove.depth_gain} cp</span>
            <span>Rising curve: {currentMove.is_rising_curve ? 'Yes' : 'No'}</span>
            <span>Defense diff: {currentMove.defense_difficulty}</span>
            <span>Sound: {currentMove.is_sound ? 'Yes' : 'No'}</span>
            <span>
              → Stage 4:{' '}
              {currentMove.classification_if_unsound || (currentMove.proceed_to_stage4 ? 'Proceed' : '—')}
            </span>
          </div>
          {currentMove.depth_evals && (
            <div className="mt-2 text-[10px] font-mono text-slate-500">
              Depth curve (white POV):{' '}
              {Object.entries(currentMove.depth_evals)
                .map(([d, cp]) => `d${d}=${formatWhiteCp(cp)}`)
                .join(' · ')}
            </div>
          )}
        </div>
      )}

      {moves.length === 0 ? (
        <p className="text-sm text-slate-500 px-4 py-6">No moves passed Stage 2 gate (CPL / forced / EP).</p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-2">Ply</th>
                <th className="px-2 py-2">Move</th>
                <th className="px-2 py-2">Deep</th>
                <th className="px-2 py-2">Gain</th>
                <th className="px-2 py-2">R8→R22</th>
                <th className="px-2 py-2">NO score</th>
                <th className="px-2 py-2">Rise</th>
                <th className="px-2 py-2">Def</th>
                <th className="px-2 py-2">Sound</th>
                <th className="px-2 py-2">→S4</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const isActive = navIndex === m.ply_index + 1;
                const rowClass = m.is_sound
                  ? 'bg-emerald-50/60'
                  : m.is_rising_curve
                    ? 'bg-indigo-50/40'
                    : 'bg-red-50/30';
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
                      <td className="px-2 py-1.5 font-mono">{formatWhiteCp(m.deep_eval_cp)}</td>
                      <td className="px-2 py-1.5 font-mono">{m.depth_gain}</td>
                      <td className="px-2 py-1.5 font-mono">
                        {m.rank_at_depth8}→{m.rank_at_depth22}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{m.non_obvious_score}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_rising_curve, 'text-indigo-700')}</td>
                      <td className="px-2 py-1.5 font-mono">{m.defense_difficulty}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_sound)}</td>
                      <td className="px-2 py-1.5 text-[10px]">
                        {m.classification_if_unsound || (m.proceed_to_stage4 ? '✓' : '—')}
                      </td>
                    </tr>
                    {expandedPly === m.ply_index && m.features && (
                      <tr className="bg-slate-50">
                        <td colSpan={10} className="px-3 py-2">
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
          Soft gate: deep eval ≥ −30cp (mover) at d18 · unsound → speculative_sacrifice · continues to Stage 4
        </p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-[10px] font-semibold text-indigo-600 hover:underline">
            Re-run Stage 3
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
