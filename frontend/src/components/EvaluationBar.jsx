import React from 'react';

const EvaluationBar = ({ percent, display, orientation, layout = 'vertical', barHeight, barWidth }) => {
  const { text, side } = display || { text: '0.0', side: 'w' };
  const isFlipped = orientation === 'black';

  const whitePercent = percent;
  const blackPercent = 100 - percent;
  const hasWhiteAdvantage = side === 'w';

  if (layout === 'horizontal') {
    return (
      <div className="w-full max-w-[min(100%,420px)] mx-auto h-8 rounded-md border-2 border-slate-700 overflow-hidden flex relative shrink-0">
        <div
          className="h-full bg-white flex items-center justify-start pl-1 shrink-0"
          style={{ width: `${whitePercent}%` }}
        />
        <div className="h-full bg-black min-w-0 flex-1" />
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
          aria-hidden
        >
          {text}
        </span>
      </div>
    );
  }

  const whiteLabelPosition = isFlipped ? { top: '4px' } : { bottom: '4px' };
  const blackLabelPosition = isFlipped ? { bottom: '4px' } : { top: '4px' };

  const sized = barHeight != null && Number.isFinite(barHeight);
  const w = sized
    ? (barWidth != null && Number.isFinite(barWidth)
      ? barWidth
      : Math.min(32, Math.max(22, Math.round(barHeight / 14))))
    : undefined;

  return (
    <div
      className={`eval-bar-bg ${sized ? 'eval-bar-sized' : ''}`}
      style={{
        flexDirection: isFlipped ? 'column' : 'column-reverse',
        ...(sized
          ? {
              height: barHeight,
              width: w,
              minHeight: barHeight,
              maxHeight: barHeight,
              minWidth: w,
              maxWidth: w,
            }
          : { alignSelf: 'stretch' }),
      }}
    >
      <div className="eval-white-fill" style={{ height: `${whitePercent}%` }}>
        {hasWhiteAdvantage && (
          <span className="eval-label-white" style={whiteLabelPosition}>
            {text}
          </span>
        )}
      </div>
      <div className="eval-black-fill" style={{ height: `${blackPercent}%` }}>
        {!hasWhiteAdvantage && (
          <span className="eval-label-black" style={blackLabelPosition}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
};

export default EvaluationBar;
