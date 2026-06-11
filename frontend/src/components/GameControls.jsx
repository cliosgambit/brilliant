import React from 'react';

const GameControls = ({ turn, whiteAI, setWhiteAI, blackAI, setBlackAI, orientation, setOrientation, showAI = true, className = '' }) => {
  return (
    <div
      className={`hidden lg:flex items-center justify-center gap-4 mb-4 sm:mb-6 shrink-0 w-full ${className}`.trim()}
    >
      <div className="flex items-center gap-4 bg-white/80 backdrop-blur-sm p-1.5 px-2 rounded-2xl border border-slate-200 shadow-sm">
        {showAI && (
          <div className="flex items-center gap-3 bg-slate-50 p-1.5 px-3 rounded-xl border border-slate-100">
            <span className="bg-slate-900 text-white px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider">AI</span>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer hover:text-indigo-600 transition-colors">
              <input 
                type="checkbox" 
                checked={whiteAI} 
                onChange={e => setWhiteAI(e.target.checked)} 
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer" 
              /> 
              White
            </label>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 cursor-pointer hover:text-indigo-600 transition-colors">
              <input 
                type="checkbox" 
                checked={blackAI} 
                onChange={e => setBlackAI(e.target.checked)} 
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer" 
              /> 
              Black
            </label>
          </div>
        )}

        <div className="h-8 w-px bg-slate-200 mx-1" />

        <div className="flex items-center gap-3">
          <button 
            className="group flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 shadow-md shadow-slate-200 hover:shadow-indigo-100 transition-all active:scale-95" 
            onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
          >
            <i className={`fas fa-sync-alt transition-transform duration-500 group-hover:rotate-180`} />
            Flip Board
          </button>
          
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-black text-slate-400 tracking-tighter leading-none mb-0.5">Perspective</span>
            <span className="text-[11px] font-bold text-slate-700 whitespace-nowrap">
              {orientation === 'white' ? 'White at bottom' : 'Black at bottom'}
            </span>
          </div>
        </div>

        <div className="h-8 w-px bg-slate-200 mx-1" />

        <div className="flex items-center gap-3 bg-indigo-50/50 p-1.5 px-4 rounded-xl border border-indigo-100/50">
          <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Turn</span>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${turn === 'w' ? 'bg-white border border-slate-300 shadow-sm' : 'bg-slate-900 shadow-sm'}`} />
            <span className="text-xs font-black text-slate-900 uppercase tracking-tight">
              {turn === 'w' ? 'White' : 'Black'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameControls;
