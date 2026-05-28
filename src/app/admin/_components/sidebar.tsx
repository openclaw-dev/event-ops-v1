'use client';

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
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { OperatorSwitcher } from './operator-switcher';
import { SignOutButton } from './sign-out-button';

interface Event {
  id: string;
  name: string;
  status: string;
}

interface Operator {
  id: string;
  name: string;
}

interface SidebarProps {
  operators: Operator[];
  currentOperator: Operator;
  events: Event[];
}

const SETTINGS_SUB_NAV = [
  { label: 'Knowledge Base', href: '/admin/settings/kb', icon: BookOpen },
  { label: 'WhatsApp', href: '/admin/settings/whatsapp', icon: MessageCircle },
] as const;

const EVENT_SUB_NAV = [
  { label: 'Setup', segment: 'setup', icon: Settings, wip: false },
  { label: 'Knowledge Base', segment: 'kb', icon: FileBarChart2, wip: false },
  { label: 'Orders', segment: 'orders', icon: CalendarDays, wip: false },
  { label: 'Simulator', segment: 'simulator', icon: Bot, wip: true },
  { label: 'Conversations', segment: 'conversations', icon: MessageSquare, wip: true },
  { label: 'Escalations', segment: 'escalations', icon: AlertTriangle, wip: true },
  { label: 'Report', segment: 'report', icon: FileBarChart2, wip: true },
  { label: 'Sync', segment: 'sync', icon: RefreshCw, wip: false },
  { label: 'Promoters', segment: 'promoters', icon: Users, wip: false },
] as const;

function EventNavItem({ event }: { event: Event }) {
  const pathname = usePathname();
  const base = `/admin/events/${event.id}`;
  const isActive = pathname.startsWith(base);

  return (
    <div>
      <Link
        href={base}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors',
          isActive
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
        )}
      >
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 transition-transform', isActive && 'rotate-90')}
        />
        <span className="truncate">{event.name}</span>
        {event.status === 'live' && (
          <span className="ml-auto flex h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
        )}
      </Link>

      {isActive && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-2.5">
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
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
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
    </div>
  );
}

export function Sidebar({ operators, currentOperator, events }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r bg-background">
      {/* Operator switcher */}
      <div className="p-3">
        <OperatorSwitcher operators={operators} current={currentOperator} />
      </div>

      <Separator />

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {/* Events section */}
        <div className="mb-1 px-2 py-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Events
          </span>
        </div>

        {events.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No events yet.</p>
        ) : (
          <div className="space-y-0.5">
            {events.map((event) => (
              <EventNavItem key={event.id} event={event} />
            ))}
          </div>
        )}

        {/* New event */}
        <div className="mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            asChild
          >
            <Link href="/admin/events/new">
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </Button>
        </div>
      </nav>

      <Separator />

      {/* Footer */}
      <div className="space-y-0.5 p-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            'w-full justify-start gap-2 text-muted-foreground hover:text-foreground',
            pathname.startsWith('/admin/settings') && 'bg-accent text-accent-foreground',
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
          <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-2.5">
            {SETTINGS_SUB_NAV.map(({ label, href, icon: Icon }) => {
              const isSubActive = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                    isSubActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
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
