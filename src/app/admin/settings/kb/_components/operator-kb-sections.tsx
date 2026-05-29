'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Trash2, Loader2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

export interface OperatorKbSectionRow {
  id: string;
  section_id: string;
  title: string;
  content: string;
  source_file: string | null;
  updated_at: string;
}

interface OperatorKbSectionsProps {
  initialSections: OperatorKbSectionRow[];
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function OperatorKbSections({ initialSections }: OperatorKbSectionsProps) {
  const router = useRouter();
  const [sections, setSections] = useState<OperatorKbSectionRow[]>(initialSections);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Per-row error message so a failed delete doesn't blow away the table.
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  function setError(id: string, msg: string | null) {
    setErrorById((prev) => {
      const next = { ...prev };
      if (msg === null) delete next[id];
      else next[id] = msg;
      return next;
    });
  }

  async function performDelete(id: string) {
    setError(id, null);
    setDeleting(id);
    try {
      const res = await fetch(`/api/operator-kb/sections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSections((prev) => prev.filter((s) => s.id !== id));
        router.refresh();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(id, data.error ?? `Delete failed (${res.status}).`);
      }
    } catch {
      setError(id, 'Network error — please try again.');
    } finally {
      setDeleting(null);
      setConfirmingId(null);
    }
  }

  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        No operator KB sections yet. Upload a .md or .json file above.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Section ID</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
              Title
            </th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">
              Chars
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
              Updated
            </th>
            <th className="w-10 px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {sections.map((section) => {
            const rowError = errorById[section.id];
            return (
              <Fragment key={section.id}>
                <tr className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-primary">{section.section_id}</td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                    <span className="line-clamp-1">{section.title}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground hidden md:table-cell">
                    {section.content.length.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                    {relativeDate(section.updated_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <AlertDialog
                      open={confirmingId === section.id}
                      onOpenChange={(open) =>
                        setConfirmingId(open ? section.id : null)
                      }
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deleting === section.id}
                          aria-label={`Delete ${section.section_id}`}
                        >
                          {deleting === section.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </AlertDialogTrigger>

                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this KB section?</AlertDialogTitle>
                          <AlertDialogDescription>
                            <span className="font-mono text-xs">
                              {section.section_id}
                            </span>
                            {' — '}
                            this cannot be undone. The agent will stop citing
                            this content immediately.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting === section.id}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={(e) => {
                              e.preventDefault();
                              void performDelete(section.id);
                            }}
                            disabled={deleting === section.id}
                            className={cn(buttonVariants({ variant: 'destructive' }))}
                          >
                            {deleting === section.id ? (
                              <>
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                Deleting…
                              </>
                            ) : (
                              'Delete'
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </td>
                </tr>

                {rowError && (
                  <tr>
                    <td colSpan={5} className="px-4 pb-2.5">
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="break-words">{rowError}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
