'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

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

  async function handleDelete(id: string) {
    if (!confirm('Delete this KB section? This cannot be undone.')) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/operator-kb/sections/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSections((prev) => prev.filter((s) => s.id !== id));
        router.refresh();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? `Delete failed (${res.status}).`);
      }
    } catch {
      alert('Network error — please try again.');
    } finally {
      setDeleting(null);
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
          {sections.map((section) => (
            <tr key={section.id} className="hover:bg-muted/20 transition-colors">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  disabled={deleting === section.id}
                  onClick={() => void handleDelete(section.id)}
                  aria-label={`Delete ${section.section_id}`}
                >
                  {deleting === section.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
