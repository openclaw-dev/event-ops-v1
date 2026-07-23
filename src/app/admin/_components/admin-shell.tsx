'use client';

import { useState, useEffect, useRef } from 'react';
import { PanelLeft } from 'lucide-react';
import { Sidebar } from './sidebar';

interface Event {
  id: string;
  name: string;
  status: string;
  start_date: string;
  is_demo: boolean;
}

interface Operator {
  id: string;
  name: string;
}

interface AdminShellProps {
  operators: Operator[];
  currentOperator: Operator;
  events: Event[];
  children: React.ReactNode;
}

const STORAGE_KEY = 'sidebar-collapsed';

export function AdminShell({ operators, currentOperator, events, children }: AdminShellProps) {
  // Always start false — matches server render, no hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);
  // Track whether the mount-read has completed so the write effect doesn't
  // clobber localStorage before we've read it.
  const didMountRead = useRef(false);

  // 1. Read localStorage once after hydration.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (localStorage.getItem(STORAGE_KEY) === 'true') setCollapsed(true);
      } catch {}
    }
    didMountRead.current = true;
  }, []);

  // 2. Persist collapsed state whenever it changes, but only after the
  //    initial read has completed to avoid overwriting a stored 'true'.
  useEffect(() => {
    if (!didMountRead.current) return;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, String(collapsed));
      } catch {}
    }
  }, [collapsed]);

  function toggle() {
    setCollapsed((prev) => !prev);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        operators={operators}
        currentOperator={currentOperator}
        events={events}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <main
        className={`relative flex flex-1 flex-col overflow-y-auto${
          collapsed ? ' pl-4' : ''
        }`}
      >
        {collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Expand sidebar"
            className="fixed left-3 top-3 z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        {children}
      </main>
    </div>
  );
}
