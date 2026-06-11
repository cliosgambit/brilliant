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

const SAC_TYPE_LABELS = {
  queen_sacrifice: 'Queen sac',
  exchange_sacrifice: 'Exchange sac',
  real_sacrifice: 'Real sac',
  pseudo_sacrifice: 'Pseudo sac',
  positional_piece_placement: 'Positional',
  tactical_sacrifice: 'Tactical',
  unknown: 'Unknown',
};

export default function StageOnePanel({ data, loading, error, onRerun, navIndex, setNavIndex }) {
  const [expandedPly, setExpandedPly] = useState(null);

  const currentMove = useMemo(() => {
    if (!data?.moves?.length || navIndex <= 0) return null;
    return data.moves.find((m) => m.ply_index === navIndex - 1) || null;
  }, [data, navIndex]);

  if (loading) {
    return (
      <p className="text-sm text-slate-500 px-4 py-6">
        Running Stage 1 sacrifice classification (Stage 0 candidates only)…
      </p>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6">
        <p className="text-sm text-red-700 mb-2">{error}</p>
        {onRerun && (
          <button type="button" onClick={onRerun} className="text-xs font-semibold text-indigo-600 hover:underline">
            Retry Stage 1
          </button>
        )}
      </div>
    );
  }

  const moves = data?.moves || [];

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/40">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-slate-600">
              Stage 0 candidates only · <strong className="text-slate-800">no Stockfish</strong> · trade/hanging/pseudo
              filter · forced-move proxy
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              Stockfish enters at Stage 2 (shallow depth 8–12) — not used here
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${statusBadge(data?.status)}`}>
            {data?.status || 'pending'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          <Metric label="Candidates" value={data?.candidate_count ?? moves.length} accent="text-amber-700" />
          <Metric label="Valid sacrifices" value={data?.valid_sacrifice_count ?? 0} accent="text-emerald-700" />
          <Metric label="Disqualified" value={data?.disqualified_count ?? 0} accent="text-red-600" />
          <Metric label="Forced moves" value={data?.forced_move_count ?? 0} />
          <Metric label="→ Stage 2" value={data?.proceed_to_stage2_count ?? 0} accent="text-indigo-700" />
        </div>
      </div>

      {currentMove && (
        <div className="px-4 py-3 border-b border-amber-100 bg-amber-50/60">
          <div className="text-[10px] font-bold uppercase text-amber-900 mb-1">
            Current candidate (ply {currentMove.ply_index})
          </div>
          <div className="text-sm font-semibold text-slate-900">{currentMove.san_move}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
            <span>Type: {SAC_TYPE_LABELS[currentMove.sac_type] || currentMove.sac_type}</span>
            <span>Valid: {currentMove.is_valid_sacrifice ? 'Yes' : 'No'}</span>
            <span>Pseudo: {currentMove.is_pseudo ? 'Yes' : 'No'}</span>
            <span>Mat loss: {currentMove.material_loss_cp} cp</span>
            <span>Uncertainty: {currentMove.sacrifice_uncertainty}</span>
            <span>Recaptures: {currentMove.recapture_options}</span>
            <span>Forced: {currentMove.is_forced ? currentMove.forced_reason : 'No'}</span>
            <span>→ Stage 2: {currentMove.proceed_to_stage2 ? 'Proceed' : currentMove.gate_fail_reason || 'No'}</span>
          </div>
          {currentMove.disqualifiers?.length > 0 && (
            <p className="text-xs text-red-600 mt-1">
              Disqualifiers: {currentMove.disqualifiers.join(', ')}
            </p>
          )}
        </div>
      )}

      {moves.length === 0 ? (
        <p className="text-sm text-slate-500 px-4 py-6">No Stage 0 sacrifice candidates in this game.</p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white border-b border-slate-200">
              <tr className="text-left text-[10px] uppercase text-slate-400">
                <th className="px-2 py-2">Ply</th>
                <th className="px-2 py-2">Move</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Valid</th>
                <th className="px-2 py-2">Pseudo</th>
                <th className="px-2 py-2">MatΔ</th>
                <th className="px-2 py-2">Uncert</th>
                <th className="px-2 py-2">Rcpt</th>
                <th className="px-2 py-2">Forced</th>
                <th className="px-2 py-2">Fail</th>
                <th className="px-2 py-2">→S2</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const isActive = navIndex === m.ply_index + 1;
                const rowClass = m.proceed_to_stage2
                  ? 'bg-emerald-50/60'
                  : m.is_valid_sacrifice
                    ? 'bg-amber-50/40'
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
                      <td className="px-2 py-1.5">{SAC_TYPE_LABELS[m.sac_type] || m.sac_type}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_valid_sacrifice)}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_pseudo, 'text-amber-700')}</td>
                      <td className="px-2 py-1.5 font-mono">{m.material_loss_cp}</td>
                      <td className="px-2 py-1.5 font-mono">{m.sacrifice_uncertainty}</td>
                      <td className="px-2 py-1.5 font-mono">{m.recapture_options}</td>
                      <td className="px-2 py-1.5">{boolCell(m.is_forced, 'text-orange-700')}</td>
                      <td className="px-2 py-1.5 text-red-600 text-[10px]">
                        {m.disqualifiers?.[0] || m.gate_fail_reason || '—'}
                      </td>
                      <td className="px-2 py-1.5">{boolCell(m.proceed_to_stage2)}</td>
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

      {onRerun && (
        <div className="px-4 py-2 border-t border-slate-100 flex justify-between items-center">
          <p className="text-[10px] text-slate-400">
            Gate: valid sacrifice AND not forced → Stage 2 (Stockfish)
          </p>
          <button type="button" onClick={onRerun} className="text-[10px] font-semibold text-indigo-600 hover:underline">
            Re-run Stage 1
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
