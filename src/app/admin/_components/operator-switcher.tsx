'use client';

import { ChevronsUpDown, Building2 } from 'lucide-react';
import { switchOperator } from '../actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

interface Operator {
  id: string;
  name: string;
}

interface OperatorSwitcherProps {
  operators: Operator[];
  current: Operator;
}

export function OperatorSwitcher({ operators, current }: OperatorSwitcherProps) {
  // Single operator — no dropdown, just show the name.
  if (operators.length <= 1) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-white/10 text-slate-300">
            <Building2 className="h-3.5 w-3.5" />
          </div>
          <span className="truncate text-sm font-medium text-slate-200">{current.name}</span>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-medium text-slate-200 hover:bg-white/10 hover:text-slate-100"
        >
          <div className="flex items-center gap-2 truncate">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-white/10 text-slate-300">
              <Building2 className="h-3.5 w-3.5" />
            </div>
            <span className="truncate text-sm">{current.name}</span>
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-slate-400">
          Switch operator
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {operators.map((op) => (
          <DropdownMenuItem
            key={op.id}
            onSelect={() => switchOperator(op.id)}
            className="gap-2"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary/10">
              <Building2 className="h-3 w-3" />
            </div>
            <span className="truncate">{op.name}</span>
            {op.id === current.id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
