import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../config/api';
import BrillianceAnalyticsBar from '../components/BrillianceAnalyticsBar';

const PAGE_SIZE = 50;

function statusClass(status) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-800';
  if (status === 'failed') return 'bg-red-100 text-red-800';
  if (status === 'processing') return 'bg-indigo-100 text-indigo-800';
  return 'bg-slate-100 text-slate-700';
}

export default function LichessPgnsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('files');
  const [stats, setStats] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [games, setGames] = useState([]);
  const [gamesTotal, setGamesTotal] = useState(0);
  const [gamesOffset, setGamesOffset] = useState(0);
  const [fileFilter, setFileFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [brilliants, setBrilliants] = useState([]);
  const [brilliantsTotal, setBrilliantsTotal] = useState(0);
  const [deletingId, setDeletingId] = useState(null);

  const uploadIdParam =
    fileFilter && fileFilter !== 'all' ? parseInt(fileFilter, 10) : null;
  const fileFilterLabel =
    fileFilter !== 'all'
      ? uploads.find((u) => String(u.id) === fileFilter)?.original_filename
      : null;

  const loadAnalytics = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (uploadIdParam != null && Number.isFinite(uploadIdParam)) {
        params.set('upload_id', String(uploadIdParam));
      }
      const q = params.toString();
      const res = await fetch(
        `${API_BASE}/api/lichess-pgns/brilliance/analytics${q ? `?${q}` : ''}`
      );
      if (res.ok) setAnalytics(await res.json());
    } catch (e) {
      console.error(e);
    }
  }, [uploadIdParam]);

  const loadBrilliants = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: '0' });
      if (uploadIdParam != null && Number.isFinite(uploadIdParam)) {
        params.set('upload_id', String(uploadIdParam));
      }
      const res = await fetch(`${API_BASE}/api/lichess-pgns/brilliance/moves?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setBrilliants(data.moves || []);
      setBrilliantsTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    }
  }, [uploadIdParam]);

  const refresh = useCallback(async () => {
    try {
      const [statsRes, uploadsRes] = await Promise.all([
        fetch(`${API_BASE}/api/lichess-pgns/stats`),
        fetch(`${API_BASE}/api/lichess-pgns/uploads?limit=100`),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (uploadsRes.ok) {
        const data = await uploadsRes.json();
        setUploads(data.uploads || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGames = useCallback(async (offset = 0, filter = fileFilter) => {
    setGamesLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filter && filter !== 'all') {
        params.set('upload_id', String(filter));
      }
      const res = await fetch(`${API_BASE}/api/lichess-pgns/games?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setGames(data.games || []);
      setGamesTotal(data.total ?? 0);
      setGamesOffset(offset);
    } catch (e) {
      console.error(e);
    } finally {
      setGamesLoading(false);
    }
  }, [fileFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    loadAnalytics();
    loadBrilliants();
  }, [loadAnalytics, loadBrilliants]);

  useEffect(() => {
    const hasProcessing = uploads.some((u) => u.status === 'processing');
    if (!hasProcessing) return undefined;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [uploads, refresh]);

  useEffect(() => {
    if (tab === 'games') {
      loadGames(0, fileFilter);
    }
  }, [tab, fileFilter, loadGames]);

  const onFileChange = (e) => {
    setFile(e.target.files?.[0] || null);
    setError(null);
  };

  const handleUploadAndProcess = async () => {
    if (!file) {
      setError('Choose a .pgn file first');
      return;
    }
    const from = Math.max(1, parseInt(String(rangeFrom), 10) || 1);
    const to = Math.max(from, parseInt(String(rangeTo), 10) || from);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const upRes = await fetch(`${API_BASE}/api/lichess-pgns/upload`, {
        method: 'POST',
        body: form,
      });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error || 'Upload failed');

      if (upData.games_in_file != null && to > upData.games_in_file) {
        throw new Error(`Range end cannot exceed ${upData.games_in_file} games in file`);
      }

      const uploadId = upData.id;
      const procRes = await fetch(`${API_BASE}/api/lichess-pgns/uploads/${uploadId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ range_from: from, range_to: to }),
      });
      const procData = await procRes.json();
      if (!procRes.ok) throw new Error(procData.error || 'Process failed');

      setModalOpen(false);
      setFile(null);
      setFileFilter(String(uploadId));
      setTab('games');
      setGamesOffset(0);
      await refresh();
      await loadGames(0, String(uploadId));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFilterChange = (value) => {
    setFileFilter(value);
    setGamesOffset(0);
  };

  const openGame = (gameId) => {
    navigate(`/lichess_pgns/${gameId}`);
  };

  const deleteUpload = async (upload) => {
    if (!upload?.id) return;
    if (upload.status === 'processing') {
      setError('Wait until import finishes before deleting this file.');
      return;
    }

    const gamesLabel = upload.games_saved ?? 0;
    const ok = window.confirm(
      `Delete "${upload.original_filename}"?\n\nThis removes the PGN file and all ${gamesLabel} imported game(s) plus brilliance analysis.`
    );
    if (!ok) return;

    setDeletingId(upload.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/lichess-pgns/uploads/${upload.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');

      const nextFilter = fileFilter === String(upload.id) ? 'all' : fileFilter;
      if (fileFilter === String(upload.id)) {
        setFileFilter('all');
        setGamesOffset(0);
      }

      await refresh();
      await loadAnalytics();
      await loadBrilliants();
      if (tab === 'games') {
        await loadGames(0, nextFilter);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="w-full flex flex-col bg-slate-50 pb-8">
      <header className="shrink-0 px-4 sm:px-6 py-4 border-b border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">lichess_pgns</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Upload PGN files and browse imported games.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setModalOpen(true);
            setError(null);
          }}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 shadow-sm"
        >
          <i className="fas fa-upload mr-2" aria-hidden />
          Import PGN
        </button>
      </header>

      {stats && (
        <div className="shrink-0 px-4 sm:px-6 pt-4 flex flex-wrap gap-3">
          <Stat label="Files" value={stats.uploads_total} />
          <Stat label="Games" value={stats.games_saved} />
          <Stat label="Moves" value={stats.moves_saved} />
        </div>
      )}

      <BrillianceAnalyticsBar analytics={analytics} fileFilterLabel={fileFilterLabel} />

      {error && (
        <div className="shrink-0 px-4 sm:px-6 pt-2">
          <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        </div>
      )}

      {brilliantsTotal > 0 && (
        <div className="shrink-0 px-4 sm:px-6 pt-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <div className="flex justify-between items-center gap-2 mb-2">
              <h3 className="text-xs font-black uppercase text-amber-900">
                Brilliant &amp; high-value moves ({brilliantsTotal})
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {brilliants.map((m) => (
                <button
                  key={`${m.game_id}-${m.ply_index}`}
                  type="button"
                  onClick={() => navigate(`/lichess_pgns/${m.game_id}`)}
                  className="text-left px-2 py-1 rounded-lg bg-white border border-amber-200 hover:border-amber-400 text-[10px] shrink-0"
                >
                  <span className="font-bold text-amber-800">
                    {m.is_brilliant ? '★ ' : ''}
                    {m.san_move}
                  </span>
                  <span className="text-slate-500 ml-1">
                    {m.classification} · {m.brilliance_score}
                  </span>
                  <span className="block text-slate-400 truncate max-w-[10rem]">
                    {m.original_filename} #{m.game_index + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 px-4 sm:px-6 pt-4">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
            Files
          </TabButton>
          <TabButton active={tab === 'games'} onClick={() => setTab('games')}>
            All games
          </TabButton>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {tab === 'files' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-800">
              Uploaded files
            </div>
            {loading ? (
              <p className="p-4 text-sm text-slate-500">Loading…</p>
            ) : uploads.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                No files yet. Click <strong>Import PGN</strong> to upload.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-2">ID</th>
                      <th className="px-4 py-2">File</th>
                      <th className="px-4 py-2">Range</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Games</th>
                      <th className="px-4 py-2">Moves</th>
                      <th className="px-4 py-2">Uploaded</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u) => (
                      <tr
                        key={u.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setFileFilter(String(u.id));
                          setTab('games');
                          setGamesOffset(0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setFileFilter(String(u.id));
                            setTab('games');
                            setGamesOffset(0);
                          }
                        }}
                        className="border-t border-slate-100 hover:bg-slate-50/80 cursor-pointer focus:outline-none focus:bg-slate-50/80"
                      >
                        <td className="px-4 py-2 font-mono text-xs">{u.id}</td>
                        <td className="px-4 py-2 max-w-[14rem] truncate" title={u.original_filename}>
                          {u.original_filename}
                        </td>
                        <td className="px-4 py-2 tabular-nums text-xs whitespace-nowrap">
                          {u.range_from != null ? `${u.range_from}–${u.range_to}` : '—'}
                          {u.games_in_file != null && (
                            <span className="text-slate-400"> / {u.games_in_file}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${statusClass(u.status)}`}
                          >
                            {u.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {u.games_saved ?? 0}
                          {(u.games_failed ?? 0) > 0 && (
                            <span className="text-red-600 text-xs ml-1">({u.games_failed} failed)</span>
                          )}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{u.moves_saved ?? 0}</td>
                        <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFileFilter(String(u.id));
                              setTab('games');
                              setGamesOffset(0);
                            }}
                            className="text-indigo-600 font-bold text-xs hover:underline mr-3"
                          >
                            View games
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === u.id || u.status === 'processing'}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteUpload(u);
                            }}
                            className="text-red-600 font-bold text-xs hover:underline disabled:opacity-40"
                            title={
                              u.status === 'processing'
                                ? 'Wait until import finishes'
                                : 'Delete PGN and all imported games'
                            }
                          >
                            {deletingId === u.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'games' && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <span className="font-bold text-sm text-slate-800">All games</span>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  File
                </label>
                <select
                  value={fileFilter}
                  onChange={(e) => onFilterChange(e.target.value)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white min-w-[12rem] max-w-full"
                >
                  <option value="all">All files</option>
                  {uploads.map((u) => (
                    <option key={u.id} value={String(u.id)}>
                      #{u.id} — {u.original_filename}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-500 tabular-nums">{gamesTotal} total</span>
              </div>
            </div>

            {gamesLoading ? (
              <p className="p-4 text-sm text-slate-500">Loading games…</p>
            ) : games.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                No games found{fileFilter !== 'all' ? ' for this file' : ''}. Import a PGN or change the
                filter.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-4 py-2">Game</th>
                        <th className="px-4 py-2">File</th>
                        <th className="px-4 py-2">Lichess ID</th>
                        <th className="px-4 py-2">Moves</th>
                        <th className="px-4 py-2">Pipeline</th>
                        <th className="px-4 py-2">★</th>
                      </tr>
                    </thead>
                    <tbody>
                      {games.map((g) => (
                        <tr
                          key={g.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openGame(g.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openGame(g.id);
                            }
                          }}
                          className="border-t border-slate-100 hover:bg-indigo-50/80 cursor-pointer focus:outline-none focus:bg-indigo-50/80"
                        >
                          <td className="px-4 py-2 tabular-nums font-bold text-indigo-600">
                            #{g.game_index + 1}
                          </td>
                          <td
                            className="px-4 py-2 max-w-[12rem] truncate text-xs text-slate-600"
                            title={g.original_filename}
                          >
                            <button
                              type="button"
                              className="hover:text-indigo-600 hover:underline text-left truncate max-w-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                onFilterChange(String(g.upload_id));
                              }}
                            >
                              {g.original_filename || `Upload #${g.upload_id}`}
                            </button>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-indigo-600">
                            {g.lichess_game_id || '—'}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-slate-800">{g.move_count}</td>
                          <td className="px-4 py-2">
                            <PipelineBadge status={g.stage4_status} />
                          </td>
                          <td className="px-4 py-2 tabular-nums font-bold text-amber-700">
                            {g.stage4_brilliant_count > 0 ? g.stage4_brilliant_count : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-3 border-t border-slate-100 flex gap-2 justify-end">
                  <button
                    type="button"
                    disabled={gamesOffset <= 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 disabled:opacity-40"
                    onClick={() => loadGames(Math.max(0, gamesOffset - PAGE_SIZE), fileFilter)}
                  >
                    Prev
                  </button>
                  <span className="text-xs text-slate-500 self-center tabular-nums">
                    {gamesOffset + 1}–{Math.min(gamesOffset + PAGE_SIZE, gamesTotal)} of {gamesTotal}
                  </span>
                  <button
                    type="button"
                    disabled={gamesOffset + PAGE_SIZE >= gamesTotal}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 disabled:opacity-40"
                    onClick={() => loadGames(gamesOffset + PAGE_SIZE, fileFilter)}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </section>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-pgn-title"
          onClick={() => !busy && setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="import-pgn-title" className="text-lg font-black text-slate-900">
              Import PGN file
            </h2>

            <label className="block">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">PGN file</span>
              <input
                type="file"
                accept=".pgn,text/plain"
                className="mt-1 block w-full text-sm"
                onChange={onFileChange}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-bold text-slate-600">From game #</span>
                <input
                  type="number"
                  min={1}
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-slate-600">To game #</span>
                <input
                  type="number"
                  min={1}
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <button
                type="button"
                disabled={busy}
                className="px-3 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !file}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50"
                onClick={handleUploadAndProcess}
              >
                {busy ? 'Working…' : 'Upload & import range'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 px-4 py-3 min-w-[7rem]">
      <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{label}</p>
      <p className="text-2xl font-black text-slate-900 tabular-nums">{(value ?? 0).toLocaleString()}</p>
    </div>
  );
}

function PipelineBadge({ status }) {
  if (status === 'completed') {
    return (
      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
        done
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
        running
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-800">
        failed
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      pending
    </span>
  );
}
