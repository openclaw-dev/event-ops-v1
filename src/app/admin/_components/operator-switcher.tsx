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
  // Single operator — static display, no menu.
  if (operators.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground">{current.name}</span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between gap-1 rounded-md px-2 py-1.5 text-foreground transition-colors hover:bg-accent"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{current.name}</span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
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
