import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import SideNavBar from './SideNavBar';

const Layout = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('chess-side-nav-collapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('chess-side-nav-collapsed', navCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [navCollapsed]);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-white overflow-hidden">
      <div
        role="presentation"
        className={`fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          mobileNavOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setMobileNavOpen(false)}
      />
      <SideNavBar
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        collapsed={navCollapsed}
        onToggleCollapsed={() => setNavCollapsed((c) => !c)}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="shrink-0 flex items-center gap-3 h-12 px-3 sm:px-4 border-b border-slate-200 bg-white shadow-sm z-30 lg:hidden safe-top">
          <button
            type="button"
            className="p-2.5 -ml-1 rounded-xl text-slate-700 hover:bg-slate-100 active:bg-slate-200 touch-manipulation"
            aria-label="Open menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <i className="fas fa-bars text-lg" aria-hidden />
          </button>
          <span className="text-sm font-bold text-slate-800 truncate">Grandmaster View</span>
        </header>
        <main
          data-app-scroll-root
          className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden min-h-0 overscroll-y-contain"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
