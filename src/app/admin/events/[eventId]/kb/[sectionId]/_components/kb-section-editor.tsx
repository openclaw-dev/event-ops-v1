'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

type KbLanguage = 'en' | 'ar' | 'ru' | 'all';

const LANGUAGE_OPTIONS: Array<{ value: KbLanguage; label: string }> = [
  { value: 'all', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
];

export interface KbSectionEditorProps {
  eventId: string;
  sectionId: string;
  sectionKey: string;
  initial: {
    question_en: string;
    answer_en: string;
    question_ar: string;
    answer_ar: string;
    category: string;
    language: KbLanguage;
    escalation_needed: boolean;
  };
}

export function KbSectionEditor({ eventId, sectionId, sectionKey, initial }: KbSectionEditorProps) {
  const router = useRouter();

  const [questionEn, setQuestionEn] = useState(initial.question_en);
  const [answerEn, setAnswerEn] = useState(initial.answer_en);
  const [questionAr, setQuestionAr] = useState(initial.question_ar);
  const [answerAr, setAnswerAr] = useState(initial.answer_ar);
  const [category, setCategory] = useState(initial.category);
  const [language, setLanguage] = useState<KbLanguage>(initial.language);
  const [escalationNeeded, setEscalationNeeded] = useState(initial.escalation_needed);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (answerEn.trim() === '') {
      setError('English answer is required.');
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/kb/${sectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_en: questionEn,
          answer_en: answerEn,
          question_ar: questionAr,
          answer_ar: answerAr,
          category,
          language,
          escalation_needed: escalationNeeded,
        }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(
          typeof data.error === 'string' ? data.error : `Save failed (${res.status}).`,
        );
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/kb/${sectionId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push(`/admin/events/${eventId}/kb`);
        router.refresh();
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Delete failed (${res.status}).`);
        setDeleting(false);
        setConfirmOpen(false);
      }
    } catch {
      setError('Network error — please try again.');
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  const busy = saving || deleting;

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Metadata row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="kb-category">Category</Label>
          <Input
            id="kb-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Refund Policy"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-language">Language</Label>
          <Select
            value={language}
            onValueChange={(v) => setLanguage(v as KbLanguage)}
            disabled={busy}
          >
            <SelectTrigger id="kb-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="kb-escalation" className="text-sm">
            Escalation needed
          </Label>
          <p className="text-xs text-muted-foreground">
            When on, this topic hands off to a human instead of being answered directly.
          </p>
        </div>
        <Switch
          id="kb-escalation"
          checked={escalationNeeded}
          onCheckedChange={setEscalationNeeded}
          disabled={busy}
        />
      </div>

      {/* English */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          English
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="kb-question-en">Question</Label>
          <Input
            id="kb-question-en"
            value={questionEn}
            onChange={(e) => setQuestionEn(e.target.value)}
            placeholder="What time do doors open?"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-answer-en">
            Answer <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="kb-answer-en"
            value={answerEn}
            onChange={(e) => setAnswerEn(e.target.value)}
            rows={5}
            required
            disabled={busy}
          />
        </div>
      </section>

      {/* Arabic */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Arabic / العربية
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="kb-question-ar">Question</Label>
          <Input
            id="kb-question-ar"
            value={questionAr}
            onChange={(e) => setQuestionAr(e.target.value)}
            dir="rtl"
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-answer-ar">Answer</Label>
          <Textarea
            id="kb-answer-ar"
            value={answerAr}
            onChange={(e) => setAnswerAr(e.target.value)}
            rows={5}
            dir="rtl"
            disabled={busy}
          />
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {saved && !error && (
        <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Changes saved. The agent uses the updated content immediately.
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 border-t pt-4">
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              disabled={busy}
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Delete section
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this KB section?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-mono text-xs">{sectionKey}</span>
                {' — '}this cannot be undone. The agent will stop citing this content
                immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete();
                }}
                disabled={deleting}
                className={cn(buttonVariants({ variant: 'destructive' }))}
              >
                {deleting ? (
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

        <Button type="submit" size="sm" className="gap-1.5" disabled={busy}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save changes
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
