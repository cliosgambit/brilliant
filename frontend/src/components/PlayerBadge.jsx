import React from 'react';

const PlayerBadge = ({ name, rating, color, clock }) => {
  if (!name) return <div className="h-10" />; // Placeholder
  return (
    <div className="flex items-center justify-between w-full px-1 py-1">
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${color === 'w' ? 'bg-white border border-slate-300' : 'bg-slate-900'}`} />
          <span className="font-bold text-slate-800 truncate leading-tight">{name}</span>
        </div>
        <span className="text-[10px] text-slate-400 font-medium tabular-nums leading-tight pl-3.5">
          {rating || "Rating: —"}
        </span>
      </div>
      {clock && (
        <div className="flex items-center gap-1.5 bg-slate-800 px-2.5 py-1 rounded-md shadow-sm border border-slate-700">
          <i className="far fa-clock text-[10px] text-slate-400" />
          <span className="font-mono text-[12px] font-bold text-white tabular-nums leading-none">
            {clock}
          </span>
        </div>
      )}
    </div>
  );
};

export default PlayerBadge;
