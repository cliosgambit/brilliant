import React, { useMemo } from 'react';

function statusBadge(status) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'running') return 'bg-indigo-100 text-indigo-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  return 'bg-slate-100 text-slate-700';
}

function boolCell(v, yesLabel = 'Yes') {
  if (v) return <span className="text-emerald-700 font-semibold">{yesLabel}</span>;
  return <span className="text-slate-400">—</span>;
}

export default function StageZeroPanel({
  data,
  loading,
  error,
  onRerun,
  navIndex,
  setNavIndex,
}) {
  const [expandedPly, setExpandedPly] = React.useState(null);

  const sacrificeMoves = useMemo(
    () => (data?.moves || []).filter((m) => m.is_sacrifice_candidate),
    [data]
  );

  const currentMove = useMemo(() => {
    if (!data?.moves?.length || navIndex <= 0) return null;
    return data.moves[navIndex - 1] || null;
  }, [data, navIndex]);

  if (loading) {
    return <p className="text-sm text-slate-500 px-4 py-6">Running Stage 0 board analysis on all moves…</p>;
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-red-700 mb-2">{error}</p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-xs font-semibold text-indigo-600 hover:underline">
            Retry Stage 0
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500">
              All moves · <strong className="text-slate-700">no engine</strong> · SEE, king safety, TM, EV, harmony
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${statusBadge(data?.status)}`}>
            {data?.status || 'pending'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-3">
          <Metric label="Moves" value={data?.move_count ?? data?.moves?.length ?? 0} />
          <Metric label="Sacrifice candidates" value={data?.sacrifice_candidate_count ?? sacrificeMoves.length} accent="text-amber-700" />
          <Metric label="→ Stage 1" value={(data?.moves || []).filter((m) => m.proceed_to_stage1).length} accent="text-indigo-700" />
          <Metric label="→ Stage 2" value={(data?.moves || []).filter((m) => m.proceed_to_engine).length} accent="text-orange-700" />
          <Metric label="En prise (pre-move)" value={(data?.moves || []).filter((m) => m.en_prise_before_move).length} />
          <Metric label="Already lost" value={(data?.moves || []).filter((m) => m.already_lost_before_move).length} accent="text-red-700" />
        </div>
      </div>

      {currentMove && (
        <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/60">
          <div className="text-[10px] font-bold uppercase text-emerald-800 mb-1">
            Current move (ply {currentMove.ply_index})
          </div>
          <div className="text-sm font-semibold text-slate-900">{currentMove.san_move}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
            <span>SEE: {currentMove.see_value ?? 0} cp</span>
            <span>Phase: {currentMove.game_phase}</span>
            <span>TM: {currentMove.multiplexing_score}</span>
            <span>EV: {currentMove.ev_score}</span>
            <span>King Δ: {currentMove.king_safety_delta}</span>
            <span>Harmony: {currentMove.harmony_score}</span>
            <span>Control Δ: {currentMove.control_delta}</span>
            <span>Activity Δ: {currentMove.activity_delta}</span>
            <span>En prise: {currentMove.en_prise_before_move ? 'Yes' : 'No'}</span>
            <span>Already lost: {currentMove.already_lost_before_move ? 'Yes' : 'No'}</span>
            <span>Sac candidate: {currentMove.is_sacrifice_candidate ? 'Yes' : 'No'}</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white border-b border-slate-200">
            <tr className="text-left text-[10px] uppercase text-slate-400">
              <th className="px-2 py-2">Ply</th>
              <th className="px-2 py-2">Move</th>
              <th className="px-2 py-2">Phase</th>
              <th className="px-2 py-2">SEE</th>
              <th className="px-2 py-2">Sac?</th>
              <th className="px-2 py-2">Prise</th>
              <th className="px-2 py-2">Lost</th>
              <th className="px-2 py-2">TM</th>
              <th className="px-2 py-2">EV</th>
              <th className="px-2 py-2">KΔ</th>
              <th className="px-2 py-2">Harm</th>
              <th className="px-2 py-2">→S1</th>
              <th className="px-2 py-2">→S2</th>
            </tr>
          </thead>
          <tbody>
            {(data?.moves || []).map((m) => {
              const isActive = navIndex === m.ply_index + 1;
              const isSac = m.is_sacrifice_candidate;
              return (
                <React.Fragment key={m.ply_index}>
                  <tr
                    className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${
                      isActive ? 'bg-indigo-50' : isSac ? 'bg-amber-50/50' : ''
                    }`}
                    onClick={() => {
                      setNavIndex(m.ply_index + 1);
                      setExpandedPly(expandedPly === m.ply_index ? null : m.ply_index);
                    }}
                  >
                    <td className="px-2 py-1.5 font-mono">{m.ply_index}</td>
                    <td className="px-2 py-1.5 font-semibold">{m.san_move}</td>
                    <td className="px-2 py-1.5 capitalize">{m.game_phase}</td>
                    <td className={`px-2 py-1.5 font-mono ${m.see_value < -50 ? 'text-red-600 font-semibold' : ''}`}>
                      {m.see_value}
                    </td>
                    <td className="px-2 py-1.5">{boolCell(m.is_sacrifice_candidate)}</td>
                    <td className="px-2 py-1.5">{boolCell(m.en_prise_before_move)}</td>
                    <td className="px-2 py-1.5">{boolCell(m.already_lost_before_move)}</td>
                    <td className="px-2 py-1.5 font-mono">{m.multiplexing_score}</td>
                    <td className="px-2 py-1.5 font-mono">{m.ev_score}</td>
                    <td className="px-2 py-1.5 font-mono">{m.king_safety_delta}</td>
                    <td className="px-2 py-1.5 font-mono">{m.harmony_score}</td>
                    <td className="px-2 py-1.5">{boolCell(m.proceed_to_stage1)}</td>
                    <td className="px-2 py-1.5">{boolCell(m.proceed_to_engine)}</td>
                  </tr>
                  {expandedPly === m.ply_index && m.features && (
                    <tr className="bg-slate-50">
                      <td colSpan={13} className="px-3 py-2">
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

      {onRerun && (
        <div className="px-4 py-2 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] text-slate-400">Click row → board · expand → full JSON</p>
          <button type="button" onClick={onRerun} className="text-[10px] font-semibold text-indigo-600 hover:underline">
            Re-run Stage 0
          </button>
        </div>
      )}
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
