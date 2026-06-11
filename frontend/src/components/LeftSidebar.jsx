import React, { useMemo, useState, useEffect, useRef } from 'react';
import MoveClassIcon from './MoveClassIcon';

function moveClassLabel(c) {
  if (!c) return null;
  if (c === 'book') return 'Book';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function moveClassTextClass(c) {
  switch (c) {
    case 'best':
    case 'excellent':
    case 'good':
      return 'text-emerald-800';
    case 'inaccuracy':
      return 'text-yellow-800';
    case 'mistake':
      return 'text-red-600';
    case 'blunder':
      return 'text-red-900';
    case 'book':
      return 'text-indigo-700';
    default:
      return '';
  }
}

const LeftSidebar = ({
  history,
  navIndex,
  setNavIndex,
  timeline,
  loadPGN,
  layout = 'sidebar',
  moveClassifications = [],
  boardWidth = 560,
  hideImport = false,
  hideOverview = false,
  columnHeight,
}) => {
  const pageStack = layout === 'pageStack';
  const asideHeight = columnHeight ?? boardWidth + 112;
  const [pgnInput, setPgnInput] = useState('');
  const [showPgnInput, setShowPgnInput] = useState(false);
  const scrollContainerRef = useRef(null);
  
  const isInitialPosition = navIndex === 0;

  const getClass8ColorClasses = (cls) => {
    const c = (cls || '').toLowerCase();
    switch (c) {
      case 'forced': return { badge: 'bg-slate-500/10 text-slate-400', bar: 'bg-slate-500' };
      case 'book': return { badge: 'bg-indigo-500/10 text-indigo-400', bar: 'bg-indigo-500' };
      case 'best': return { 
        badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20', 
        bar: 'flowing-glow shadow-[0_0_8px_rgba(16,185,129,0.4)]',
        isBest: true 
      };
      case 'excellent': return { badge: 'bg-emerald-500/20 text-emerald-500', bar: 'bg-emerald-500' };
      case 'good': return { badge: 'bg-emerald-400/20 text-emerald-400', bar: 'bg-emerald-400' };
      case 'inaccuracy': return { badge: 'bg-amber-500/10 text-amber-400', bar: 'bg-amber-500' };
      case 'mistake': return { badge: 'bg-rose-500/10 text-rose-400', bar: 'bg-rose-500' };
      case 'blunder': return { badge: 'bg-rose-900/20 text-rose-600', bar: 'bg-rose-900' };
      default: return { badge: 'bg-slate-500/10 text-slate-400', bar: 'bg-slate-500' };
    }
  };

  // useEffect(() => {
  //   if (activeMoveRef.current && scrollContainerRef.current) {
  //     activeMoveRef.current.scrollIntoView({
  //       behavior: 'smooth',
  //       block: 'nearest',
  //     });
  //   }
  // }, [navIndex]);

  const movePairs = useMemo(() => {
    const res = [];
    for (let i = 0; i < history.length; i += 2) {
      res.push({
        num: Math.floor(i / 2) + 1,
        w: history[i]?.san,
        b: history[i + 1]?.san,
        wClock: history[i]?.clock,
        bClock: history[i + 1]?.clock,
        wClass: moveClassifications[i] ?? null,
        bClass: moveClassifications[i + 1] ?? null,
      });
    }
    return res;
  }, [history, moveClassifications]);

  const handleLoadPgn = async () => {
    const result = loadPGN(pgnInput);
    const ok = result instanceof Promise ? await result : result;
    if (ok) {
      setPgnInput('');
      setShowPgnInput(false);
    } else {
      alert('Invalid or empty PGN. Please check the format and try again.');
    }
  };

  const overviewStats = useMemo(() => {
    const stats = {
      w: { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed: 0 },
      b: { brilliant: 0, great: 0, best: 0, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, blunder: 0, missed: 0 }
    };

    moveClassifications.forEach((cls, i) => {
      if (!cls) return;
      const color = i % 2 === 0 ? 'w' : 'b';
      const c = cls.toLowerCase();
      if (stats[color].hasOwnProperty(c)) {
        stats[color][c]++;
      }
    });

    return stats;
  }, [moveClassifications]);

  const STAT_ROWS = [
    { key: 'best', label: 'Best Move' },
    { key: 'excellent', label: 'Excellent' },
    { key: 'good', label: 'Good' },
    { key: 'book', label: 'Book' },
    { key: 'inaccuracy', label: 'Inaccuracy' },
    { key: 'mistake', label: 'Mistake' },
    { key: 'blunder', label: 'Blunder' },
  ];

  return (
    <>
      <style>{`
        @keyframes flowGlow {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .flowing-glow {
          background: linear-gradient(90deg, 
            #10b981 0%, 
            #34d399 25%, 
            #10b981 50%, 
            #34d399 75%, 
            #10b981 100%
          );
          background-size: 200% 100%;
          animation: flowGlow 3s linear infinite;
        }
      `}</style>
      <aside
        className={
          pageStack
            ? 'w-full flex flex-col gap-4 shrink-0 lg:w-64'
            : `w-full lg:w-64 flex flex-col gap-4 shrink-0 h-full min-h-0 lg:max-h-none overflow-visible ${hideOverview ? 'flex-1' : ''}`
        }
        style={!pageStack ? { height: `${asideHeight}px` } : {}}
      >
      {/* Move History Box (50% of board height + 72px) */}
      <div
        className="bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm shrink-0"
        style={{
          height: hideOverview
            ? `${Math.max(200, boardWidth + 40)}px`
            : `${(boardWidth / 2) + 72}px`,
          flex: hideOverview ? '1 1 auto' : undefined,
          minHeight: hideOverview ? 0 : undefined,
        }}
      >
        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 shrink-0">
          <h2 className="font-bold text-[10px] uppercase tracking-widest text-white">Move History</h2>
          {!hideImport && (
            <button
              type="button"
              className="text-white/70 hover:text-white transition-colors"
              onClick={() => setShowPgnInput(!showPgnInput)}
              title="Import PGN"
            >
              <i className="fas fa-file-import text-xs" aria-hidden />
            </button>
          )}
        </div>

        {!hideImport && showPgnInput && (
          <div className="p-3 bg-slate-50 border-b border-white flex flex-col gap-2 shrink-0">
            <textarea
              className="w-full h-24 p-2 text-[10px] font-mono border border-slate-200 rounded-lg focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
              placeholder="Paste PGN here..."
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
            />
            <div className="flex gap-2">
              <button 
                className="flex-1 bg-indigo-600 text-white py-1.5 rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition shadow-sm"
                onClick={handleLoadPgn}
              >
                Load Game
              </button>
              <button 
                className="px-3 bg-white border border-slate-200 text-slate-400 py-1.5 rounded-lg text-[10px] font-bold hover:bg-slate-50 transition"
                onClick={() => setShowPgnInput(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar"
        >
          {movePairs.map((pair, i) => (
            <div key={i} className="grid grid-cols-[25px_1fr_1fr] gap-2 items-center text-sm">
              <span className="text-[10px] text-slate-300 font-bold">{pair.num}.</span>
              <div
                className={`move-pill flex flex-col items-start gap-0.5 min-w-0 ${navIndex === i * 2 + 1 ? 'active' : 'hover:bg-slate-50'}`}
                onClick={() => setNavIndex(i * 2 + 1)}
              >
                <div className="flex items-center gap-1 w-full">
                  <MoveClassIcon moveClass={pair.wClass} title={moveClassLabel(pair.wClass) || undefined} />
                  <span className={`truncate min-w-0 ${moveClassTextClass(pair.wClass)}`}>{pair.w}</span>
                </div>
                {pair.wClock && <span className="text-[9px] text-slate-400 font-mono ml-4 opacity-70">{pair.wClock}</span>}
              </div>
              {pair.b ? (
                <div
                  className={`move-pill flex flex-col items-start gap-0.5 min-w-0 ${navIndex === i * 2 + 2 ? 'active' : 'hover:bg-slate-50'}`}
                  onClick={() => setNavIndex(i * 2 + 2)}
                >
                  <div className="flex items-center gap-1 w-full">
                    <MoveClassIcon moveClass={pair.bClass} title={moveClassLabel(pair.bClass) || undefined} />
                    <span className={`truncate min-w-0 ${moveClassTextClass(pair.bClass)}`}>{pair.b}</span>
                  </div>
                  {pair.bClock && <span className="text-[9px] text-slate-400 font-mono ml-4 opacity-70">{pair.bClock}</span>}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        
        <div className="p-2 border-t border-white grid grid-cols-4 gap-1 shrink-0 bg-slate-50/30">
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" onClick={() => setNavIndex(0)} title="Start"><i className="fas fa-fast-backward text-xs"></i></button>
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" onClick={() => setNavIndex(Math.max(0, navIndex - 1))} title="Previous"><i className="fas fa-chevron-left text-xs"></i></button>
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" onClick={() => setNavIndex(Math.min(timeline.length - 1, navIndex + 1))} title="Next"><i className="fas fa-chevron-right text-xs"></i></button>
          <button className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" onClick={() => setNavIndex(timeline.length - 1)} title="End"><i className="fas fa-fast-forward text-xs"></i></button>
        </div>
      </div>

      {!hideOverview && (
        <div
          className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col shadow-sm shrink-0 overflow-hidden"
          style={{ height: `${(boardWidth / 2) + 24}px` }}
        >
          <div className="flex-1 overflow-hidden px-6 py-6">
            <div className="space-y-4">
              {STAT_ROWS.map((row) => (
                <div key={row.key} className="grid grid-cols-[20px_1fr_20px] gap-4 items-center group">
                  <span className={`text-[12px] font-bold text-left transition-colors ${overviewStats.w[row.key] > 0 ? 'text-slate-100' : 'text-slate-700'}`}>
                    {overviewStats.w[row.key]}
                  </span>

                  <div className="flex items-center gap-3 justify-start min-w-0">
                    <div className="w-6 flex justify-center shrink-0">
                      <MoveClassIcon moveClass={row.key} />
                    </div>
                    <span className={`text-[11px] font-bold transition-colors truncate ${overviewStats.w[row.key] > 0 || overviewStats.b[row.key] > 0 ? 'text-slate-400' : 'text-slate-600'}`}>
                      {row.label}
                    </span>
                  </div>

                  <span className={`text-[12px] font-bold text-right transition-colors ${overviewStats.b[row.key] > 0 ? 'text-slate-100' : 'text-slate-700'}`}>
                    {overviewStats.b[row.key]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="px-6 py-3 bg-slate-800/20 border-t border-slate-800/50 flex justify-between items-center shrink-0">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">White</span>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Black</span>
          </div>
        </div>
      )}
    </aside>
    </>
  );
};

export default LeftSidebar;
