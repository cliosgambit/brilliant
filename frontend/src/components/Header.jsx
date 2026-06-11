import React from 'react';

const Header = ({ onCopyCSV, showCopyCSV = false, onExportExcel, analysisProgress, className = '' }) => {
  return (
    <header
      className={`max-w-[1600px] mx-auto w-full mb-0 sm:mb-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start shrink-0 px-0 pb-3 sm:pb-0 border-b border-slate-100 sm:border-0 bg-white ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 sm:w-10 sm:h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 shrink-0">
          <i className="fas fa-chess-knight text-lg sm:text-xl" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest truncate">
            Grandmaster View
          </p>
          {analysisProgress !== undefined && (
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <div className="w-16 sm:w-20 h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    analysisProgress === 100 ? 'bg-emerald-500' : 'bg-indigo-500 animate-pulse'
                  }`}
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <span className="text-[9px] font-bold text-slate-500 whitespace-nowrap">
                {analysisProgress}% Analyzed
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          className="bg-white border border-slate-200 px-3 py-2 sm:px-4 rounded-xl text-[11px] sm:text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 touch-manipulation"
        >
          PGN Database
        </button>
        {showCopyCSV && onCopyCSV && (
          <button
            type="button"
            onClick={onCopyCSV}
            className="bg-emerald-600 text-white px-3 py-2 sm:px-4 rounded-xl text-[11px] sm:text-xs font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition flex items-center gap-2 touch-manipulation"
          >
            <i className="fas fa-copy" aria-hidden />
            <span className="hidden sm:inline">Copy CSV</span>
            <span className="sm:hidden">CSV</span>
          </button>
        )}
        {onExportExcel && (
          <button
            type="button"
            onClick={onExportExcel}
            className="bg-indigo-600 text-white px-3 py-2 sm:px-4 rounded-xl text-[11px] sm:text-xs font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition touch-manipulation"
          >
            <span className="hidden sm:inline">Export Analysis</span>
            <span className="sm:hidden">Export</span>
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
