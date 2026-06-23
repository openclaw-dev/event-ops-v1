'use client';

import { useState, useEffect } from 'react';
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
  const [collapsed, setCollapsed] = useState(false);

  // Read persisted state after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') setCollapsed(true);
    } catch {}
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
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
      <main className="relative flex flex-1 flex-col overflow-y-auto">
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
