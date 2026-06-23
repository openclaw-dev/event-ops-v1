'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarDays,
  MessageSquare,
  AlertTriangle,
  FileBarChart2,
  Bot,
  Settings,
  Plus,
  ChevronRight,
  RefreshCw,
  Users,
  BookOpen,
  MessageCircle,
  BarChart2,
  TrendingUp,
  Users2,
  ScanLine,
  MoreHorizontal,
  Trash2,
  PanelLeftClose,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { OperatorSwitcher } from './operator-switcher';
import { SignOutButton } from './sign-out-button';
import { deleteEvent } from '@/app/admin/events/[eventId]/setup/actions';

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

interface SidebarProps {
  operators: Operator[];
  currentOperator: Operator;
  events: Event[];
  collapsed: boolean;
  onToggle: () => void;
}

const SETTINGS_SUB_NAV = [
  { label: 'Knowledge Base', href: '/admin/settings/kb', icon: BookOpen },
  { label: 'WhatsApp', href: '/admin/settings/whatsapp', icon: MessageCircle },
  { label: 'Usage & Billing', href: '/admin/settings/usage', icon: BarChart2 },
] as const;

const EVENT_SUB_NAV = [
  { label: 'Setup', segment: 'setup', icon: Settings, wip: false },
  { label: 'Knowledge Base', segment: 'kb', icon: FileBarChart2, wip: false },
  { label: 'Orders', segment: 'orders', icon: CalendarDays, wip: false },
  { label: 'Simulator', segment: 'simulator', icon: Bot, wip: false },
  { label: 'Conversations', segment: 'conversations', icon: MessageSquare, wip: false },
  { label: 'Escalations', segment: 'escalations', icon: AlertTriangle, wip: false },
  { label: 'Report', segment: 'report', icon: FileBarChart2, wip: false },
  { label: 'Sync', segment: 'sync', icon: RefreshCw, wip: false },
  { label: 'Promoters', segment: 'promoters', icon: Users, wip: false },
  { label: 'Recovery', segment: 'recovery', icon: TrendingUp, wip: false },
  { label: 'Gate', segment: 'gate', icon: ScanLine, wip: false },
] as const;

function EventStatusDot({ status, startDate }: { status: string; startDate: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const isPast = startDate < today;

  if (status === 'live') {
    return <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />;
  }
  if (isPast || status === 'closed' || status === 'archived') {
    return <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />;
  }
  return <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />;
}

function EventNavItem({
  event,
  isExpanded,
  onToggle,
}: {
  event: Event;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const base = `/admin/events/${event.id}`;
  const isActive = pathname.startsWith(base);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleteOpen(true);
  }

  function handleDeleteOpenChange(open: boolean) {
    setDeleteOpen(open);
    if (!open) {
      setConfirmName('');
      setDeleteError(null);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteEvent(event.id);
    if (result?.error) {
      setDeleteError(result.error);
      setDeleting(false);
    }
  }

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-accent font-medium text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded p-0.5 hover:bg-accent"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight
            className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')}
          />
        </button>

        <Link href={base} className="min-w-0 flex-1 truncate">
          {event.name}
        </Link>

        {event.is_demo ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Demo
          </span>
        ) : (
          <EventStatusDot status={event.status} startDate={event.start_date} />
        )}

        <button
          type="button"
          onClick={openDelete}
          className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete event"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
      </div>

      {isExpanded && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2.5">
          {EVENT_SUB_NAV.map(({ label, segment, icon: Icon, wip }) => {
            const href = `${base}/${segment}`;
            const isSubActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={segment}
                href={href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                  isSubActive
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-3 w-3 shrink-0" />
                <span>{label}</span>
                {wip && (
                  <Badge variant="outline" className="ml-auto h-4 px-1 py-0 text-[10px] leading-none">
                    WIP
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete event
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{event.name}</strong> and all associated data —
              conversations, orders, KB, gate scans, escalations, and payment recovery records.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label htmlFor={`confirm-delete-${event.id}`} className="text-sm">
              Type <strong>{event.name}</strong> to confirm
            </Label>
            <Input
              id={`confirm-delete-${event.id}`}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="mt-1.5"
              placeholder={event.name}
              autoComplete="off"
            />
            {deleteError && <p className="mt-1.5 text-xs text-destructive">{deleteError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmName !== event.name || deleting}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete event'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Sidebar({ operators, currentOperator, events, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  const activeEventId =
    events.find((e) => pathname.startsWith(`/admin/events/${e.id}`))?.id ?? null;

  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(
    () => new Set(activeEventId ? [activeEventId] : []),
  );

  // Auto-expand when navigating into an event that isn't already expanded.
  useEffect(() => {
    if (activeEventId) {
      setExpandedEvents((prev) => {
        if (prev.has(activeEventId)) return prev;
        const next = new Set(prev);
        next.add(activeEventId);
        return next;
      });
    }
  }, [activeEventId]);

  function toggleEvent(id: string) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside
      suppressHydrationWarning
      className={cn(
        'hidden md:flex h-screen shrink-0 flex-col border-r border-border bg-card overflow-hidden',
        'motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out',
        collapsed ? 'w-0 border-r-0' : 'w-64',
      )}
    >
      {/* Operator switcher + collapse toggle */}
      <div className="flex items-center gap-1 p-3">
        <div className="min-w-0 flex-1">
          <OperatorSwitcher operators={operators} current={currentOperator} />
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse sidebar"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="h-px bg-border" />

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {/* Events section */}
        <div className="mb-1 px-2 py-1">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Events
          </span>
        </div>

        {events.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No events yet.</p>
        ) : (
          <div className="space-y-0.5">
            {events.map((event) => (
              <EventNavItem
                key={event.id}
                event={event}
                isExpanded={expandedEvents.has(event.id)}
                onToggle={() => toggleEvent(event.id)}
              />
            ))}
          </div>
        )}

        {/* New event */}
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            asChild
          >
            <Link href="/admin/events/new">
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </Button>
        </div>

        {/* CRM section */}
        <div className="mt-4 mb-1 px-2 py-1">
          <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Growth
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground',
            pathname.startsWith('/admin/crm') && 'bg-accent text-foreground',
          )}
          asChild
        >
          <Link href="/admin/crm">
            <Users2 className="h-4 w-4" />
            CRM
          </Link>
        </Button>
      </nav>

      <div className="h-px bg-border" />

      {/* Footer */}
      <div className="space-y-0.5 p-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-foreground',
            pathname.startsWith('/admin/settings') && 'bg-accent text-foreground',
          )}
          asChild
        >
          <Link href="/admin/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </Button>

        {/* Settings sub-nav — shown when any /admin/settings route is active */}
        {pathname.startsWith('/admin/settings') && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2.5">
            {SETTINGS_SUB_NAV.map(({ label, href, icon: Icon }) => {
              const isSubActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                    isSubActive
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <SignOutButton />
      </div>
    </aside>
  );
}
