import React, { useMemo } from 'react';

const SAC_TYPE_SHORT = {
  queen_sacrifice: 'Queen sac',
  exchange_sacrifice: 'Exch sac',
  real_sacrifice: 'Real sac',
  pseudo_sacrifice: 'Pseudo',
  positional_piece_placement: 'Positional',
  tactical_sacrifice: 'Tactical',
  unknown: 'Unknown',
};

function PassCell({ pass, na }) {
  if (na) return <span className="text-slate-300">—</span>;
  if (pass == null) return <span className="text-slate-400">·</span>;
  return (
    <span className={pass ? 'text-emerald-600 font-bold' : 'text-red-600 font-bold'}>
      {pass ? 'true' : 'false'}
    </span>
  );
}

function ScoreTable({ rows }) {
  return (
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-slate-400 uppercase">
          <th className="text-left font-semibold pb-1 pr-1">Check</th>
          <th className="text-right font-semibold pb-1 px-1 w-12">Got</th>
          <th className="text-right font-semibold pb-1 px-1 w-14">Need</th>
          <th className="text-right font-semibold pb-1 pl-1 w-10">OK</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.label}
            className={`border-t border-slate-100 ${row.highlight ? 'bg-slate-50/80' : ''}`}
          >
            <td className="py-1 pr-1 text-slate-700 font-medium">{row.label}</td>
            <td className="py-1 px-1 text-right font-mono text-slate-800">{row.got}</td>
            <td className="py-1 px-1 text-right font-mono text-slate-400">{row.need}</td>
            <td className="py-1 pl-1 text-right">
              <PassCell pass={row.pass} na={row.na} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function buildStage0Rows(s0) {
  if (!s0) return [];

  const see = s0.features?.see ?? {};
  const seeValue = s0.see_value ?? see.see_value ?? 0;
  const isCapture = Boolean(s0.is_capture ?? see.is_capture);
  const positionalRisk = Boolean(see.positional_risk);

  const rows = [
    {
      label: 'SEE',
      got: isCapture ? seeValue : '—',
      need: '< −100',
      pass: isCapture ? seeValue < -100 : null,
      na: !isCapture,
    },
    {
      label: 'Positional risk',
      got: positionalRisk ? 'true' : 'false',
      need: 'true',
      pass: positionalRisk,
    },
    {
      label: 'Sacrifice cand.',
      got: s0.is_sacrifice_candidate ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s0.is_sacrifice_candidate),
    },
    {
      label: '→ Stage 1',
      got: s0.proceed_to_stage1 ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s0.proceed_to_stage1),
      highlight: true,
    },
    {
      label: 'En prise',
      got: s0.en_prise_before_move ? 'true' : 'false',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Already lost',
      got: s0.already_lost_before_move ? 'true' : 'false',
      need: 'false',
      pass: !s0.already_lost_before_move,
    },
    {
      label: 'TM',
      got: s0.multiplexing_score ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'EV',
      got: s0.ev_score ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Harmony',
      got: s0.harmony_score ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'King Δ',
      got: s0.king_safety_delta ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
  ];

  return rows;
}

function buildStage1Rows(s0, s1) {
  if (!s0?.proceed_to_stage1) return [];
  if (!s1) return [];

  const seeValue = s0.see_value ?? s1.features?.stage0?.see_value ?? 0;
  const isCapture = Boolean(s0.is_capture ?? s1.features?.stage0?.is_capture);
  const isExchange = s1.sac_type === 'exchange_sacrifice';
  const dynamicScore = s1.features?.dynamic_score ?? null;
  const tacticalBypass = Boolean(s1.features?.tactical_bypass);
  const disqualifiers = s1.disqualifiers ?? [];

  const rows = [
    {
      label: 'Type',
      got: SAC_TYPE_SHORT[s1.sac_type] || s1.sac_type,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Valid sacrifice',
      got: s1.is_valid_sacrifice ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s1.is_valid_sacrifice),
    },
  ];

  if (isCapture) {
    rows.push({
      label: 'SEE (win cap)',
      got: seeValue,
      need: '< 150',
      pass: seeValue < 150,
    });
    rows.push({
      label: 'SEE (equal trade)',
      got: seeValue,
      need: isExchange ? 'exch OK' : '< −100',
      pass: isExchange || seeValue < -100,
    });
  }

  rows.push({
    label: 'Already lost DQ',
    got: disqualifiers.includes('piece_already_lost_before_move') ? 'true' : 'false',
    need: 'false',
    pass: !disqualifiers.includes('piece_already_lost_before_move'),
  });

  rows.push(
    {
      label: 'Forced',
      got: s1.is_forced ? 'true' : 'false',
      need: 'false',
      pass: !s1.is_forced,
    },
    {
      label: 'n_legal',
      got: s1.n_legal ?? '—',
      need: '> 1',
      pass: (s1.n_legal ?? 0) > 1,
    },
    {
      label: 'Mat loss',
      got: s1.material_loss_cp ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Uncertainty',
      got: s1.sacrifice_uncertainty ?? 0,
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Dynamic score',
      got: dynamicScore ?? '—',
      need: '≥ 6',
      pass: dynamicScore != null ? dynamicScore >= 6 : null,
    },
    {
      label: 'Tactical bypass',
      got: tacticalBypass ? 'true' : 'false',
      need: 'true*',
      pass: tacticalBypass,
    },
    {
      label: '→ Stage 2',
      got: s1.proceed_to_stage2 ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s1.proceed_to_stage2),
      highlight: true,
    }
  );

  return rows;
}

function buildStage2Rows(s1, s2) {
  if (!s1?.proceed_to_stage2) return [];
  if (!s2) return [];

  const eng = s2.features?.engine ?? s2.features ?? {};
  const epPre = eng.ep_pre_position ?? s2.features?.ep_pre_position ?? null;
  const cpl = s2.cpl_shallow ?? eng.cpl_shallow ?? null;
  const epDelta = s2.ep_delta_shallow ?? eng.ep_delta_shallow ?? null;
  const earlyFail = s2.gate_fail_reason === 'piece_already_lost_engine_confirmed';

  const rows = [];

  if (earlyFail) {
    rows.push({
      label: 'Engine preserve',
      got: 'lost',
      need: 'survive',
      pass: false,
    });
  } else {
    rows.push(
      {
        label: 'CPL',
        got: cpl ?? '—',
        need: '≤ 300',
        pass: cpl != null ? cpl <= 300 : null,
      },
      {
        label: 'EP pre',
        got: epPre ?? '—',
        need: '—',
        pass: null,
        na: true,
      },
      {
        label: 'EP delta',
        got: epDelta ?? '—',
        need: '≥ −0.15',
        pass: epDelta != null ? epDelta >= -0.15 : null,
      },
      {
        label: 'Engine forced',
        got: s2.is_forced_engine ? 'true' : 'false',
        need: '—',
        pass: null,
        na: true,
      },
      {
        label: 'Near best',
        got: s2.is_best_or_near_best ? 'true' : 'false',
        need: '—',
        pass: null,
        na: true,
      },
      {
        label: 'Rank',
        got: s2.our_rank_in_top5 ?? '—',
        need: '—',
        pass: null,
        na: true,
      },
      {
        label: 'Resp width',
        got: s2.response_width ?? '—',
        need: '—',
        pass: null,
        na: true,
      }
    );
  }

  rows.push({
    label: '→ Stage 3',
    got: s2.proceed_to_stage3 ? 'true' : 'false',
    need: 'true',
    pass: Boolean(s2.proceed_to_stage3),
    highlight: true,
  });

  return rows;
}

function buildStage3Rows(s2, s1, s3) {
  if (!s1?.proceed_to_stage2 || !s2?.proceed_to_stage3) return [];
  if (!s3) return [];

  const eng = s3.features?.engine ?? {};
  const deepMover = eng.deep_eval_mover_cp ?? null;
  const cplDeep = eng.cpl_deep ?? null;

  return [
    {
      label: 'Deep eval',
      got: deepMover ?? s3.deep_eval_cp ?? '—',
      need: '≥ −30',
      pass: Boolean(s3.is_sound),
    },
    {
      label: 'CPL deep',
      got: cplDeep ?? '—',
      need: '≤ 50',
      pass: eng.is_near_best_deep ?? null,
    },
    {
      label: 'Sound',
      got: s3.is_sound ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s3.is_sound),
    },
    {
      label: 'NOB score',
      got: s3.non_obvious_score ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Rank d8',
      got: s3.rank_at_depth8 ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Rank d18',
      got: s3.rank_at_depth22 ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Rank jump',
      got: s3.rank_jump ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Rising curve',
      got: s3.is_rising_curve ? 'true' : 'false',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Depth gain',
      got: s3.depth_gain ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: 'Defense diff',
      got: s3.defense_difficulty ?? '—',
      need: '—',
      pass: null,
      na: true,
    },
    {
      label: '→ Stage 4',
      got: s3.proceed_to_stage4 ? 'true' : 'false',
      need: 'true',
      pass: Boolean(s3.proceed_to_stage4),
      highlight: true,
    },
  ];
}

function StageSection({ title, gatePass, gateLabel, children }) {
  return (
    <section className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-700">{title}</span>
        {gatePass != null && (
          <span
            className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
              gatePass ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {gateLabel}
          </span>
        )}
      </div>
      <div className="px-1.5 py-1.5">{children}</div>
    </section>
  );
}

export default function TestMoveStageExplanation({
  navIndex,
  moveLabel,
  s0Move,
  s1Move,
  s2Move,
  s3Move,
  stage0Loading,
  stage1Loading,
  stage2Loading,
  stage3Loading,
}) {
  const plyIndex = navIndex > 0 ? navIndex - 1 : null;

  const stage0Rows = useMemo(() => buildStage0Rows(s0Move), [s0Move]);
  const stage1Rows = useMemo(() => buildStage1Rows(s0Move, s1Move), [s0Move, s1Move]);
  const stage2Rows = useMemo(() => buildStage2Rows(s1Move, s2Move), [s1Move, s2Move]);
  const stage3Rows = useMemo(
    () => buildStage3Rows(s2Move, s1Move, s3Move),
    [s2Move, s1Move, s3Move]
  );

  if (plyIndex == null || !moveLabel) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-900 text-white">
          <div className="text-[10px] font-bold uppercase tracking-widest">Stage scores</div>
        </div>
        <div className="flex-1 flex items-center justify-center px-4 text-center text-xs text-slate-400">
          Click a move to see scores vs thresholds.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-900 text-white shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-widest">Stage scores</div>
        <div className="text-sm font-mono font-semibold mt-0.5 truncate">{moveLabel}</div>
        <div className="text-[10px] text-slate-300 mt-0.5">Ply {plyIndex}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-2 custom-scrollbar">
        <StageSection
          title="Stage 0"
          gatePass={stage0Loading ? null : Boolean(s0Move?.proceed_to_stage1)}
          gateLabel={stage0Loading ? '…' : s0Move?.proceed_to_stage1 ? '→ S1' : 'Stop'}
        >
          {stage0Loading ? (
            <p className="text-[10px] text-slate-400 px-1">Running…</p>
          ) : stage0Rows.length ? (
            <ScoreTable rows={stage0Rows} />
          ) : (
            <p className="text-[10px] text-slate-400 px-1">No data</p>
          )}
        </StageSection>

        <StageSection
          title="Stage 1"
          gatePass={
            stage1Loading || !s0Move?.proceed_to_stage1
              ? null
              : Boolean(s1Move?.proceed_to_stage2)
          }
          gateLabel={
            stage1Loading
              ? '…'
              : !s0Move?.proceed_to_stage1
                ? 'Skip'
                : s1Move?.proceed_to_stage2
                  ? '→ S2'
                  : 'Stop'
          }
        >
          {stage1Loading ? (
            <p className="text-[10px] text-slate-400 px-1">Running…</p>
          ) : !s0Move?.proceed_to_stage1 ? (
            <p className="text-[10px] text-slate-400 px-1">Not a Stage 0 candidate</p>
          ) : stage1Rows.length ? (
            <ScoreTable rows={stage1Rows} />
          ) : (
            <p className="text-[10px] text-slate-400 px-1">No data</p>
          )}
        </StageSection>

        <StageSection
          title="Stage 2"
          gatePass={
            stage2Loading || !s1Move?.proceed_to_stage2
              ? null
              : Boolean(s2Move?.proceed_to_stage3)
          }
          gateLabel={
            stage2Loading
              ? '…'
              : !s1Move?.proceed_to_stage2
                ? 'Skip'
                : s2Move?.proceed_to_stage3
                  ? '→ S3'
                  : 'Stop'
          }
        >
          {stage2Loading ? (
            <p className="text-[10px] text-slate-400 px-1">Running…</p>
          ) : !s1Move?.proceed_to_stage2 ? (
            <p className="text-[10px] text-slate-400 px-1">Did not pass Stage 1</p>
          ) : stage2Rows.length ? (
            <ScoreTable rows={stage2Rows} />
          ) : (
            <p className="text-[10px] text-slate-400 px-1">No data</p>
          )}
        </StageSection>

        <StageSection
          title="Stage 3"
          gatePass={
            stage3Loading || !s1Move?.proceed_to_stage2 || !s2Move?.proceed_to_stage3
              ? null
              : Boolean(s3Move?.proceed_to_stage4)
          }
          gateLabel={
            stage3Loading
              ? '…'
              : !s1Move?.proceed_to_stage2
                ? 'Skip'
                : !s2Move?.proceed_to_stage3
                  ? 'Skip'
                  : s3Move?.proceed_to_stage4
                    ? '→ S4'
                    : 'Stop'
          }
        >
          {stage3Loading ? (
            <p className="text-[10px] text-slate-400 px-1">Running…</p>
          ) : !s1Move?.proceed_to_stage2 || !s2Move?.proceed_to_stage3 ? (
            <p className="text-[10px] text-slate-400 px-1">Did not pass Stage 1→2 cascade</p>
          ) : stage3Rows.length ? (
            <ScoreTable rows={stage3Rows} />
          ) : (
            <p className="text-[10px] text-slate-400 px-1">No data</p>
          )}
        </StageSection>

        <StageSection title="Stage 4" gatePass={false} gateLabel="Not run">
          <p className="text-[10px] text-slate-400 px-1">Classification — not run on /test</p>
        </StageSection>
      </div>
    </div>
  );
}
