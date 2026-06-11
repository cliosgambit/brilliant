import React from 'react';

/** Same glyphs/colors as RightSidebar best-lines row. */
export default function MoveClassIcon({ moveClass, title, className = '' }) {
  if (!moveClass) return null;
  const label = title ?? moveClass;
  return (
    <span
      className={`inline-flex justify-center items-center shrink-0 w-4 ${className}`.trim()}
      title={label}
      aria-label={label}
    >
      {moveClass === 'brilliant' ? <span className="text-cyan-400 font-black text-[10px] leading-none" title="Brilliant">!!</span> : null}
      {moveClass === 'great' ? <span className="text-blue-500 font-black text-[10px] leading-none" title="Great Move">!</span> : null}
      {moveClass === 'best' ? <i className="fas fa-star text-emerald-500" aria-hidden="true" /> : null}
      {moveClass === 'excellent' ? <i className="fas fa-thumbs-up text-emerald-500" aria-hidden="true" /> : null}
      {moveClass === 'good' ? <i className="fas fa-check-circle text-emerald-600" aria-hidden="true" /> : null}
      {moveClass === 'inaccuracy' ? <span className="text-yellow-500 font-black text-[10px] leading-none" title="Inaccuracy">?!</span> : null}
      {moveClass === 'mistake' ? <span className="text-orange-500 font-black text-[10px] leading-none" title="Mistake">?</span> : null}
      {moveClass === 'blunder' ? <span className="text-red-600 font-black text-[10px] leading-none" title="Blunder">??</span> : null}
      {moveClass === 'missed' ? <i className="fas fa-minus-circle text-red-500" aria-hidden="true" /> : null}
      {moveClass === 'book' ? <i className="fas fa-book text-stone-500" aria-hidden="true" /> : null}
      {moveClass === 'forced' ? <i className="fas fa-lock text-slate-500" aria-hidden="true" /> : null}
    </span>
  );
}
