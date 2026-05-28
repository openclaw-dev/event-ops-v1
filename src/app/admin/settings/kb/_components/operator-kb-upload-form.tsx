'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, AlertCircle, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface UploadResult {
  sections_parsed: number;
  errors: string[];
}

interface OperatorKbUploadFormProps {
  operatorId: string;
}

export function OperatorKbUploadForm({ operatorId }: OperatorKbUploadFormProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setResult(null);
    setError(null);

    const form = new FormData();
    form.append('file', file);
    form.append('operator_id', operatorId);

    try {
      const res = await fetch('/api/operator-kb/upload', { method: 'POST', body: form });
      const data = (await res.json()) as UploadResult & { error?: string };

      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status}).`);
      } else {
        setResult(data);
        router.refresh();
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'md' && ext !== 'markdown' && ext !== 'json') {
      setError('Only .md and .json files are supported.');
      return;
    }
    void upload(file);
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload operator KB document"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploading && 'pointer-events-none opacity-60',
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">
          {uploading ? 'Uploading…' : 'Drop .md or .json here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Max 5 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.json"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Success */}
      {result && (
        <div className="space-y-1.5 rounded-md border bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {result.sections_parsed} section{result.sections_parsed !== 1 ? 's' : ''} parsed
          </div>
          {result.errors.length > 0 && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-amber-600">
                {result.errors.length} warning{result.errors.length !== 1 ? 's' : ''}:
              </p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errors.length > 5 && (
                  <li>…and {result.errors.length - 5} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
