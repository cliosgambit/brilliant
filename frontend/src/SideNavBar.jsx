import React from 'react';
import { NavLink } from 'react-router-dom';

const SideNavBar = ({ mobileOpen, onMobileClose, collapsed, onToggleCollapsed }) => {
  const closeOnNavigate = () => {
    onMobileClose?.();
  };

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors touch-manipulation ${
      isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-200'
    } ${collapsed ? 'lg:justify-center lg:px-2' : ''}`;

  return (
    <aside
      className={`
        fixed z-50 top-0 left-0 h-full max-h-[100dvh] bg-slate-900 text-white flex flex-col p-3 shadow-2xl
        transition-transform duration-200 ease-out w-[min(17.5rem,88vw)]
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:shadow-none lg:max-h-none lg:shrink-0
        ${collapsed ? 'lg:w-[4.5rem] lg:min-w-[4.5rem]' : 'lg:w-64 lg:min-w-[16rem]'}
      `}
      aria-label="Main navigation"
    >
      <div className="flex items-center gap-2 mb-6 shrink-0 min-h-[2.5rem]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-900/30 shrink-0">
            <i className="fas fa-chess-knight text-xl" aria-hidden />
          </div>
          {!collapsed && (
            <p className="hidden lg:block text-[10px] font-black uppercase text-slate-400 tracking-widest leading-tight truncate">
              Grandmaster View
            </p>
          )}
        </div>
        <button
          type="button"
          className="lg:hidden p-2.5 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white touch-manipulation"
          aria-label="Close menu"
          onClick={onMobileClose}
        >
          <i className="fas fa-times text-lg" aria-hidden />
        </button>
        <button
          type="button"
          className="hidden lg:flex p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white touch-manipulation"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          <i className={`fas fa-angles-left text-sm transition-transform ${collapsed ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto custom-scrollbar pb-safe">
        <NavLink to="/analyze" className={linkClass} onClick={closeOnNavigate} title="Analyze">
          <i className="fas fa-chart-pie w-5 text-center shrink-0" aria-hidden />
          <span className={collapsed ? 'lg:hidden' : ''}>Analyze</span>
        </NavLink>
        <NavLink to="/lichess_pgns" className={linkClass} onClick={closeOnNavigate} title="lichess_pgns">
          <i className="fas fa-database w-5 text-center shrink-0" aria-hidden />
          <span className={collapsed ? 'lg:hidden' : ''}>lichess_pgns</span>
        </NavLink>
        <NavLink to="/custom_game" className={linkClass} onClick={closeOnNavigate} title="Custom Game">
          <i className="fas fa-chess-board w-5 text-center shrink-0" aria-hidden />
          <span className={collapsed ? 'lg:hidden' : ''}>Custom Game</span>
        </NavLink>
        <NavLink to="/test" className={linkClass} onClick={closeOnNavigate} title="Test">
          <i className="fas fa-flask w-5 text-center shrink-0" aria-hidden />
          <span className={collapsed ? 'lg:hidden' : ''}>Test</span>
        </NavLink>
      </nav>
    </aside>
  );
};

export default SideNavBar;
