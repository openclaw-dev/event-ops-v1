'use client';

import { useState } from 'react';
import { BookPlus, X, CheckCircle2, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface AddToKbModalProps {
  /** The event to add the KB section to. */
  eventId: string;
  /** Pre-filled section title (editable by the operator). */
  defaultTitle: string;
  /** Label shown on the trigger button. Defaults to "Add to KB". */
  triggerLabel?: string;
  /** Extra className applied to the trigger button. */
  triggerClassName?: string;
}

/**
 * "Add to KB" button + inline modal.
 *
 * Clicking the button opens a centred overlay with:
 *   - Section title field (pre-filled with defaultTitle, editable)
 *   - Content textarea for the operator to type the answer
 *
 * On submit, creates a minimal markdown file (`## title\n\ncontent`)
 * and POSTs it to the existing /api/kb/upload endpoint.
 */
export function AddToKbModal({
  eventId,
  defaultTitle,
  triggerLabel = 'Add to KB',
  triggerClassName,
}: AddToKbModalProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleOpen() {
    // Reset to fresh state each time the modal opens.
    setTitle(defaultTitle);
    setContent('');
    setError(null);
    setSuccess(false);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      setError('Both section title and content are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    // Build a minimal markdown file that parseMarkdown can handle:
    //   ## Section Title
    //
    //   The answer text…
    const markdown = `## ${trimmedTitle}\n\n${trimmedContent}\n`;
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const file = new File([blob], 'quick-add.md', { type: 'text/markdown' });

    const form = new FormData();
    form.append('file', file);
    form.append('event_id', eventId);

    try {
      const res = await fetch('/api/kb/upload', { method: 'POST', body: form });
      const data = (await res.json()) as { sections_parsed?: number; error?: string };

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status}).`);
      } else {
        setSuccess(true);
        // Auto-close after a brief success flash.
        setTimeout(() => setOpen(false), 1500);
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      <Button
        size="sm"
        variant="outline"
        className={triggerClassName}
        onClick={handleOpen}
      >
        <BookPlus className="mr-1 h-3 w-3" />
        {triggerLabel}
      </Button>

      {/* ── Overlay + modal ──────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          // Click outside to close
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">Add to Knowledge Base</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Creates a new KB section for this event.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Success state */}
            {success ? (
              <div className="flex items-center gap-2 py-6 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                Section added to the Knowledge Base.
              </div>
            ) : (
              /* Form */
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="kb-modal-title">Section title</Label>
                  <Input
                    id="kb-modal-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. What is the refund policy for VIP tickets?"
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="kb-modal-content">Answer / content</Label>
                  <Textarea
                    id="kb-modal-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Type the correct answer here…"
                    className="min-h-[120px] resize-y"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-1.5 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={submitting}>
                    {submitting ? 'Saving…' : 'Save to KB'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
