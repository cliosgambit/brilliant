import React, { useMemo } from 'react';

const EvaluationGraph = ({ analysis, timeline, navIndex }) => {
  const getPercent = (data, t) => {
    if (!data || !data.score) return 50;
    const s = data.score;
    let v = s.type === 'cp' ? (s.value / 100) : s.value;
    if (t === 'b') v = -v;
    if (s.type === 'mate') {
      if (v > 0) return 100;
      else if (v < 0) return 0;
      else {
        // v is 0, which means Mate in 0. The side to move (t) has lost.
        // If it's Black's turn to move (t === 'b') and they are mated, White won (100%).
        // If it's White's turn to move (t === 'w') and they are mated, Black won (0%).
        return t === 'b' ? 100 : 0;
      }
    }
    if (v >= 8) return 100;
    else if (v >= 4) return 90 + ((v - 4) / 4) * 10;
    else if (v >= 0) return 50 + (v / 4) * 40;
    else if (v >= -4) return 10 + ((v + 4) / 4) * 40;
    else if (v >= -8) return 0 + ((v + 8) / 4) * 10;
    return 0;
  };

  const points = useMemo(() => {
    const pts = [];
    // Use timeline length to ensure we check every possible move index
    for (let i = 0; i < timeline.length; i++) {
      const data = analysis[i];
      if (!data || !data.score) {
        // Don't break, just skip this point or mark as unanalyzed
        continue; 
      }

      const t = timeline[i]?.turn;
      const p = getPercent(data, t);
      
      const s = data.score;
      let v = s.type === 'cp' ? (s.value / 100) : s.value;
      if (t === 'b') v = -v; // Convert to White's perspective

      const scoreText = s.type === 'mate' ? `M${Math.abs(v)}` : (v >= 0 ? '+' : '') + v.toFixed(2);

      pts.push({ p, scoreText, originalIndex: i });
    }
    return pts;
  }, [analysis, timeline]);

  if (points.length < 1) {
    return (
      <div className="h-24 flex items-center justify-center text-[10px] font-bold text-slate-300 uppercase tracking-widest border-2 border-dashed border-slate-200 rounded-xl">
        Waiting for analysis...
      </div>
    );
  }

  const width = 280;
  const height = 80;
  const drawWidth = width;
  const drawHeight = height;

  const dLine = points.map((pt, i) => {
    const x = points.length > 1 ? (i * drawWidth) / (points.length - 1) : drawWidth / 2;
    const y = drawHeight - (pt.p / 100) * drawHeight;
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');

  // Ensure marker is positioned relative to the moves currently shown in the graph.
  const currentPtIndex = points.findIndex(pt => pt.originalIndex === navIndex);
  const markerX = currentPtIndex !== -1 
    ? (points.length > 1 ? (currentPtIndex * drawWidth) / (points.length - 1) : drawWidth / 2)
    : (navIndex >= points.length ? drawWidth : (points.length > 1 ? (navIndex * drawWidth) / (points.length - 1) : drawWidth / 2));
  
  const currentPt = currentPtIndex !== -1 ? points[currentPtIndex] : { scoreText: '...', p: 50 };
  const markerY = drawHeight - (currentPt.p / 100) * drawHeight;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-[9px] font-black uppercase text-slate-400 tracking-tighter">
        <span className="flex items-center gap-1.5"><i className="fas fa-chart-line text-indigo-400"></i> Evaluation History</span>
        <span>{points.length} Analyzed</span>
      </div>
      <div className="relative bg-[#1a1917] rounded-lg overflow-hidden border border-slate-800 shadow-2xl group">
        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          className="w-full h-20 overflow-visible"
          preserveAspectRatio="none"
        >
          {/* Base midline */}
          <line x1="0" y1={height/2} x2={width} y2={height/2} stroke="#333" strokeWidth="1" strokeDasharray="4 2" />

          {/* Fill Area */}
          {points.length > 1 && (
            <path 
              d={`${dLine} L ${width} ${height} L 0 ${height} Z`} 
              fill="url(#graphGradient)" 
              opacity="0.3"
            />
          )}
          
          {/* Main Line */}
          <path 
            d={dLine} 
            fill="none" 
            stroke="#6366f1" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
          />

          {/* Marker Line */}
          <line x1={markerX} y1="0" x2={markerX} y2={height} stroke="#ffffff" strokeWidth="1" opacity="0.5" strokeDasharray="2 2" />
          
          {/* Tooltip/Score Popover */}
          <g transform={`translate(${Math.min(width - 45, Math.max(5, markerX - 20))}, ${Math.max(10, markerY - 30)})`}>
            <rect width="40" height="18" rx="4" fill="#6366f1" />
            <text x="20" y="12" textAnchor="middle" fontSize="8" fontWeight="bold" fill="white">{currentPt.scoreText}</text>
            <path d="M 16 18 L 20 22 L 24 18" fill="#6366f1" />
          </g>

          <defs>
            <linearGradient id="graphGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
};

export default EvaluationGraph;
