import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../config/api';
import StageZeroPanel from './StageZeroPanel';
import StageOnePanel from './StageOnePanel';
import StageTwoPanel from './StageTwoPanel';
import StageThreePanel from './StageThreePanel';
import StageFourPanel from './StageFourPanel';

const TABS = [
  { id: 'stage0', label: 'Stage 0', sub: 'All moves · board-only' },
  { id: 'stage1', label: 'Stage 1', sub: 'Sacrifice candidates only' },
  { id: 'stage2', label: 'Stage 2', sub: 'Stage 1 passers · d12' },
  { id: 'stage3', label: 'Stage 3', sub: 'Stockfish d5–18 · deep curve' },
  { id: 'stage4', label: 'Stage 4', sub: 'Human model · archetype' },
];

export default function BrillianceStagesPanel({ gameId, navIndex, setNavIndex, onEngineEvalChange }) {
  const [activeTab, setActiveTab] = useState('stage0');
  const [stage0, setStage0] = useState(null);
  const [stage1, setStage1] = useState(null);
  const [stage2, setStage2] = useState(null);
  const [stage3, setStage3] = useState(null);
  const [stage4, setStage4] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rerunningAll, setRerunningAll] = useState(false);
  const [error, setError] = useState(null);

  const notifyEval = useCallback(
    (payload) => {
      onEngineEvalChange?.(payload);
    },
    [onEngineEvalChange]
  );

  const fetchStageSnapshot = useCallback(async (stageNum) => {
    const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage${stageNum}`);
    if (!res.ok) return null;
    return res.json();
  }, [gameId]);

  const applyPipelineResult = useCallback(
    (json) => {
      setStage0(json.stage0 ?? null);
      setStage1(json.stage1 ?? null);
      setStage2(json.stage2 ?? null);
      setStage3(json.stage3 ?? null);
      setStage4(json.stage4 ?? null);
      notifyEval({
        stage2: json.stage2 ?? null,
        stage3: json.stage3 ?? null,
        stage4: json.stage4 ?? null,
        loading: false,
      });
    },
    [notifyEval]
  );

  const refreshAllStages = useCallback(async () => {
    const [s0, s1, s2, s3, s4] = await Promise.all([
      fetchStageSnapshot(0),
      fetchStageSnapshot(1),
      fetchStageSnapshot(2),
      fetchStageSnapshot(3),
      fetchStageSnapshot(4),
    ]);
    applyPipelineResult({ stage0: s0, stage1: s1, stage2: s2, stage3: s3, stage4: s4 });
  }, [fetchStageSnapshot, applyPipelineResult]);

  const isPipelineConsistent = useCallback((s0, s1, s2, s3, s4) => {
    if (!s0 || s0.status !== 'completed' || (s0.features_saved ?? 0) === 0) return false;
    const s1n = s1?.candidate_count ?? s1?.moves?.length ?? 0;
    const s2n = s2?.analyzed_count ?? s2?.moves?.length ?? 0;
    const s3n = s3?.analyzed_count ?? s3?.moves?.length ?? 0;
    const s4n = s4?.analyzed_count ?? s4?.moves?.length ?? 0;
    if (s1n === 0 && (s2n > 0 || s3n > 0 || s4n > 0)) return false;
    if (s2n === 0 && (s3n > 0 || s4n > 0)) return false;
    if (s3n === 0 && s4n > 0) return false;
    return s4?.status === 'completed';
  }, []);

  const loadPipeline = useCallback(
    async (force = false) => {
      setError(null);
      setLoading(true);
      if (force) {
        setRerunningAll(true);
        setStage0(null);
        setStage1(null);
        setStage2(null);
        setStage3(null);
        setStage4(null);
      }
      notifyEval({ loading: true });
      try {
        if (!force) {
          const [cached0, cached1, cached2, cached3, cached4] = await Promise.all([
            fetchStageSnapshot(0),
            fetchStageSnapshot(1),
            fetchStageSnapshot(2),
            fetchStageSnapshot(3),
            fetchStageSnapshot(4),
          ]);

          if (isPipelineConsistent(cached0, cached1, cached2, cached3, cached4)) {
            applyPipelineResult({
              stage0: cached0,
              stage1: cached1,
              stage2: cached2,
              stage3: cached3,
              stage4: cached4,
            });
            return;
          }
        }

        const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/brilliance/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Brilliance pipeline failed');

        await refreshAllStages();
      } catch (e) {
        setError(e.message || String(e));
        notifyEval({ stage2: null, stage3: null, stage4: null, loading: false });
      } finally {
        setLoading(false);
        setRerunningAll(false);
      }
    },
    [gameId, notifyEval, fetchStageSnapshot, applyPipelineResult, refreshAllStages, isPipelineConsistent]
  );

  const handleRerunAllStages = useCallback(() => {
    loadPipeline(true);
  }, [loadPipeline]);

  useEffect(() => {
    setStage0(null);
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setStage4(null);
    setActiveTab('stage0');
    notifyEval({ stage2: null, stage3: null, stage4: null, loading: true });
    loadPipeline(false);
  }, [gameId, loadPipeline, notifyEval]);

  const tabCount = (tabId) => {
    if (loading && !stage0 && !stage1 && !stage2 && !stage3 && !stage4) return null;
    if (tabId === 'stage0') {
      return stage0?.move_count ?? stage0?.moves?.length ?? stage0?.features_saved ?? 0;
    }
    if (tabId === 'stage1') {
      return stage1?.candidate_count ?? stage1?.moves?.length ?? 0;
    }
    if (tabId === 'stage2') {
      return stage2?.analyzed_count ?? stage2?.moves?.length ?? 0;
    }
    if (tabId === 'stage3') {
      return stage3?.analyzed_count ?? stage3?.moves?.length ?? 0;
    }
    if (tabId === 'stage4') {
      return stage4?.analyzed_count ?? stage4?.moves?.length ?? 0;
    }
    return null;
  };

  const tabCountLabel = (tabId) => {
    const n = tabCount(tabId);
    if (n == null) return null;
    if (tabId === 'stage0') return `${n} moves`;
    if (tabId === 'stage1') return `${n} candidates`;
    return `${n} analyzed`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-900 text-white flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">Brilliance Engine — Cascade Analytics</h2>
          <p className="text-[11px] text-slate-300 mt-0.5">
            Auto-runs Stages 0→4 on load · Stockfish at 2–3 · human perception + final classification at Stage 4
          </p>
        </div>
        <button
          type="button"
          onClick={handleRerunAllStages}
          disabled={loading || rerunningAll}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          title="Recompute Stages 0–4 from scratch (ignores cached results)"
        >
          <i
            className={`fas fa-sync-alt text-[10px] ${rerunningAll ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {rerunningAll ? 'Rerunning all stages…' : 'Rerun all stages'}
        </button>
      </div>

      <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 px-4 py-3 text-left border-b-2 transition-colors min-w-[120px] ${
                isActive
                  ? 'border-indigo-600 bg-white text-indigo-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-white/60'
              }`}
            >
              <div className="text-xs font-bold">{tab.label}</div>
              <div className="text-[10px] opacity-70">{tab.sub}</div>
              {tabCountLabel(tab.id) != null && (
                <div className="text-[10px] font-mono mt-0.5 text-amber-700">{tabCountLabel(tab.id)}</div>
              )}
            </button>
          );
        })}
      </div>

      {error && !loading && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700 flex justify-between gap-2">
          <span>{error}</span>
          <button type="button" onClick={handleRerunAllStages} className="font-semibold underline shrink-0">
            Retry all
          </button>
        </div>
      )}

      {rerunningAll && (
        <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 text-xs text-indigo-800">
          Recomputing Stages 0→4 with force refresh — this may take a minute while Stockfish runs on candidates…
        </div>
      )}

      {activeTab === 'stage0' && (
        <StageZeroPanel
          data={stage0}
          loading={loading && !stage0?.moves?.length}
          error={error && !stage0 ? error : null}
          onRerun={async () => {
            setLoading(true);
            try {
              const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage0/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || 'Stage 0 failed');
              setStage0(json);
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
          navIndex={navIndex}
          setNavIndex={setNavIndex}
        />
      )}

      {activeTab === 'stage1' && (
        <StageOnePanel
          data={stage1}
          loading={loading && !stage1?.moves?.length}
          error={error && !stage1 ? error : null}
          onRerun={async () => {
            try {
              const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage1/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || 'Stage 1 failed');
              setStage1(json);
            } catch (e) {
              setError(e.message);
            }
          }}
          navIndex={navIndex}
          setNavIndex={setNavIndex}
        />
      )}

      {activeTab === 'stage2' && (
        <StageTwoPanel
          data={stage2}
          loading={loading && !stage2?.moves?.length}
          error={error && !stage2 ? error : null}
          onRerun={async () => {
            setLoading(true);
            try {
              const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage2/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || 'Stage 2 failed');
              setStage2(json);
              notifyEval({ stage2: json, stage3, stage4, loading: false });
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
          navIndex={navIndex}
          setNavIndex={setNavIndex}
        />
      )}

      {activeTab === 'stage3' && (
        <StageThreePanel
          data={stage3}
          loading={loading && !stage3?.moves?.length}
          error={error && !stage3 ? error : null}
          onRerun={async () => {
            setLoading(true);
            notifyEval({ loading: true });
            try {
              const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage3/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || 'Stage 3 failed');
              setStage3(json);
              notifyEval({ stage2, stage3: json, stage4, loading: false });
            } catch (e) {
              setError(e.message);
              notifyEval({ stage2, stage3: null, stage4: null, loading: false });
            } finally {
              setLoading(false);
            }
          }}
          navIndex={navIndex}
          setNavIndex={setNavIndex}
        />
      )}

      {activeTab === 'stage4' && (
        <StageFourPanel
          data={stage4}
          loading={loading && !stage4?.moves?.length}
          error={error && !stage4 ? error : null}
          onRerun={async () => {
            setLoading(true);
            try {
              const res = await fetch(`${API_BASE}/api/lichess-pgns/games/${gameId}/stage4/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ force: true }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json.error || 'Stage 4 failed');
              setStage4(json);
              notifyEval({ stage2, stage3, stage4: json, loading: false });
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
          navIndex={navIndex}
          setNavIndex={setNavIndex}
        />
      )}
    </div>
  );
}
