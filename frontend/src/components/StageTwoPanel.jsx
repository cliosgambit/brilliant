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

export default function StageTwoPanel({ data, loading, error, onRerun, navIndex, setNavIndex }) {
  const [expandedPly, setExpandedPly] = useState(null);

  const currentMove = useMemo(() => {
    if (!data?.moves?.length || navIndex <= 0) return null;
    return data.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [data, navIndex]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500 px-4 py-6">
        Running Stage 2 shallow Stockfish (depth 12, multipv 5) on engine candidates…
      </p>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-red-700 mb-2">{error}</p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-xs font-semibold text-indigo-600 hover:underline">
            Retry Stage 2
          </button>
        )}
      </div>
    );
  }

  const moves = data?.moves || [];

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-100 bg-orange-50/50">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-600">
              Stage 1 passers only · <strong className="text-orange-800">Stockfish depth 12</strong> (multipv 5)
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              CPL, EP delta, engine forced-move check, opponent response width · <strong>white POV</strong> cp
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${statusBadge(data?.status)}`}>
            {data?.status || 'pending'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          <Metric label="Analyzed" value={data?.analyzed_count ?? moves.length} accent="text-orange-700" />
          <Metric label="→ Stage 3" value={data?.proceed_to_stage3_count ?? 0} accent="text-indigo-700" />
          <Metric label="Disqualified" value={data?.disqualified_count ?? 0} accent="text-red-600" />
          <Metric label="Engine forced" value={data?.forced_engine_count ?? 0} />
          <Metric label="Unsound (CPL/EP)" value={data?.unsound_count ?? 0} />
        </div>
      </div>

      {currentMove && (
        <div className="px-4 py-3 border-b border-orange-100 bg-orange-50/70">
          <div className="text-[10px] font-bold uppercase text-orange-900 mb-1">
            Current (ply {currentMove.ply_index})
          </div>
          <div className="text-sm font-semibold text-slate-900">{currentMove.san_move}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
            <span>Best: {currentMove.best_move}</span>
            <span>CPL: {currentMove.cpl_shallow} cp</span>
            <span>Our eval: {currentMove.our_score_cp} cp</span>
            <span>Rank: {currentMove.our_rank_in_top5}</span>
            <span>EP Δ: {currentMove.ep_delta_shallow}</span>
            <span>Response width: {currentMove.response_width}</span>
            <span>Engine forced: {currentMove.is_forced_engine ? 'Yes' : 'No'}</span>
            <span>→ Stage 3: {currentMove.proceed_to_stage3 ? 'Proceed' : currentMove.gate_fail_reason}</span>
          </div>
        </div>
      )}

      {moves.length === 0 ? (
        <p className="text-sm text-slate-500 px-4 py-6">
          No moves passed the Stage 2 entry gate (valid sacrifice, quiet brilliance, or defensive resource).
        </p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-2">Path</th>
                <th className="px-2 py-2">Ply</th>
                <th className="px-2 py-2">Move</th>
                <th className="px-2 py-2">Best</th>
                <th className="px-2 py-2">CPL</th>
                <th className="px-2 py-2">EPΔ</th>
                <th className="px-2 py-2">Rank</th>
                <th className="px-2 py-2">Resp</th>
                <th className="px-2 py-2">EngF</th>
                <th className="px-2 py-2">Fail</th>
                <th className="px-2 py-2">→S3</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const isActive = navIndex === m.ply_index + 1;
                const rowClass = m.proceed_to_stage3
                  ? 'bg-emerald-50/60'
                  : m.cpl_shallow > 300
                    ? 'bg-red-50/40'
                    : 'bg-orange-50/30';
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
                      <td className="px-2 py-1.5 text-[10px] capitalize text-slate-500">{m.candidate_path || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{m.ply_index}</td>
                      <td className="px-2 py-1.5 font-semibold">{m.san_move}</td>
                      <td className="px-2 py-1.5">{m.best_move}</td>
                      <td
                        className={`px-2 py-1.5 font-mono ${
                          m.cpl_shallow > 300 ? 'text-red-600 font-semibold' : m.cpl_shallow <= 50 ? 'text-emerald-700' : ''
                        }`}
                      >
                        {m.cpl_shallow}
                      </td>
                      <td className="px-2 py-1.5 font-mono">{m.ep_delta_shallow}</td>
                      <td className="px-2 py-1.5 font-mono">{m.our_rank_in_top5}</td>
                      <td className="px-2 py-1.5 font-mono">{m.response_width}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_forced_engine, 'text-orange-700')}</td>
                      <td className="px-2 py-1.5 text-red-600 text-[10px]">{m.gate_fail_reason || '—'}</td>
                      <td className="px-2 py-1.5">{boolCell(m.proceed_to_stage3)}</td>
                    </tr>
                    {expandedPly === m.ply_index && m.features && (
                      <tr className="bg-slate-50">
                        <td colSpan={11} className="px-3 py-2">
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
          Gate: CPL ≤ 300 · not engine-forced · EP Δ ≥ −0.15 · pre-position EP &lt; 0.80 → Stage 3
        </p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-[10px] font-semibold text-indigo-600 hover:underline">
            Re-run Stage 2
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
