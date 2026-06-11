import React from 'react';

function pctRaw(done, total) {
  if (!total) return 0;
  return (done / total) * 100;
}

function formatPct(n) {
  if (!Number.isFinite(n)) return '0';
  const trimmed = Number(n).toFixed(4).replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
}

const STAGE_KEYS = ['stage0', 'stage1', 'stage2', 'stage3', 'stage4'];

export default function BrillianceAnalyticsBar({ analytics, fileFilterLabel }) {
  if (!analytics) return null;

  const total = analytics.games_total ?? 0;
  const stage4Done = analytics.stage4_done ?? 0;
  const pct = pctRaw(stage4Done, total);

  return (
    <section className="shrink-0 px-4 sm:px-6 pt-4">
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-amber-50/40 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-violet-100">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">
            Brilliance analytics
          </h2>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Pipeline progress across imported games
            {fileFilterLabel ? ` · ${fileFilterLabel}` : ''}
          </p>
        </div>

        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          <MiniStat label="Games" value={total} />
          <MiniStat label="Stage 4 done" value={`${stage4Done}/${total}`} accent="text-violet-700" />
          <MiniStat label="Pending" value={analytics.pipeline_pending} accent="text-amber-700" />
          <MiniStat label="BRILLIANT" value={analytics.brilliant_moves} accent="text-amber-800" highlight />
          <MiniStat label="Practical+" value={analytics.practical_brilliant_moves} accent="text-indigo-700" />
          <MiniStat label="Stage 4 moves" value={analytics.stage4_moves_analyzed} />
          <MiniStat label="Failed games" value={analytics.pipeline_failed} accent="text-red-600" />
          <MiniStat
            label="Top score"
            value={analytics.top_brilliance_score != null ? analytics.top_brilliance_score : '—'}
          />
        </div>

        <div className="px-4 pb-3 space-y-3">
          <div>
            <div className="flex justify-between text-[10px] font-bold uppercase text-slate-500 mb-1">
              <span>Overall pipeline (Stage 4 complete)</span>
              <span className="tabular-nums">{formatPct(pct)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-violet-500 transition-all duration-500"
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-1.5">
            {STAGE_KEYS.map((key) => {
              const done =
                key === 'stage0'
                  ? analytics.stage0_done
                  : key === 'stage1'
                    ? analytics.stage1_done
                    : key === 'stage2'
                      ? analytics.stage2_done
                      : key === 'stage3'
                        ? analytics.stage3_done
                        : analytics.stage4_done;
              return (
                <StageProgressRow
                  key={key}
                  label={key.replace('stage', 'S')}
                  done={done}
                  total={total}
                  pct={pctRaw(done, total)}
                  status={done >= total && total > 0 ? 'completed' : 'pending'}
                />
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function StageProgressRow({ label, done, total, pct, status }) {
  const barColor =
    status === 'completed'
      ? 'bg-emerald-500'
      : status === 'failed'
        ? 'bg-red-500'
        : 'bg-slate-200';

  return (
    <div className="rounded-lg px-2 py-1.5 bg-slate-50">
      <div className="flex justify-between items-center gap-1 text-[10px]">
        <span className="font-bold truncate text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-600 shrink-0">
          {done}/{total}
        </span>
      </div>
      <div className="h-1 rounded-full bg-slate-200 overflow-hidden mt-1">
        <div className={`h-full ${barColor} transition-all duration-300`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent = 'text-slate-900', highlight = false }) {
  return (
    <div
      className={`rounded-lg border px-2 py-1.5 ${
        highlight ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200 bg-white/80'
      }`}
    >
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-sm font-black tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}
