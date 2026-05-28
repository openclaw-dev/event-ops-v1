/**
 * Converters for non-markdown KB file formats.
 *
 * xlsxToMarkdown — parses an Excel workbook and produces structured markdown.
 * docxToMarkdown — converts a Word document to markdown via mammoth.
 *
 * Both functions check whether the extracted text is already structured
 * (contains ## headings + bullet points). If it is, Haiku is skipped and the
 * raw text is returned directly. Only unstructured content goes through the
 * Haiku normalisation pass.
 */

import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { claude } from '@/lib/agent/anthropic-client';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when text already has ## headings AND bullet points (- at line start). */
function isAlreadyStructured(text: string): boolean {
  return text.includes('##') && /^- /m.test(text);
}

/** True when text already has ## headings (used for docx check). */
function hasMarkdownHeadings(text: string): boolean {
  return text.includes('##');
}

// ---------------------------------------------------------------------------
// Haiku normalisation pass — only called when content is unstructured
// ---------------------------------------------------------------------------

async function normaliseWithHaiku(rawText: string): Promise<string> {
  const message = await claude.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    temperature: 0,
    system:
      'Convert the following event FAQ content into clean markdown sections.\n' +
      'Each section must have a ## heading and use bullet points.\n' +
      'Preserve all factual content exactly. Remove formatting artifacts.\n' +
      'Return only the markdown, no preamble, no explanation.',
    messages: [{ role: 'user', content: rawText }],
  });

  const block = message.content[0];
  if (!block || block.type !== 'text') {
    throw new Error('Unexpected response type from Haiku normalisation.');
  }
  return block.text.trim();
}

// ---------------------------------------------------------------------------
// Excel → markdown
// ---------------------------------------------------------------------------

/**
 * Converts an xlsx buffer to a markdown string.
 *
 * FAQ format detection per sheet: first row has exactly 2 non-empty cells
 * and at least one of them matches /question|^q$/i.
 * FAQ rows are rendered as:
 *   **Q:** <question>
 *   **A:** <answer>
 *
 * Non-FAQ sheets have their cells rendered as bullet points under the sheet
 * name as a ## heading.
 *
 * If the resulting raw text already contains ## headings and bullet points,
 * Haiku is skipped.
 */
export async function xlsxToMarkdown(buffer: Buffer): Promise<string> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length === 0) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const firstRow = (rows[0] as any[]).map((c) => String(c ?? '').trim());
    const nonEmptyCells = firstRow.filter((c) => c !== '');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataRows = (rows.slice(1) as any[][]).filter((r) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (r as any[]).some((c) => String(c).trim() !== ''),
    );

    // FAQ detection: exactly 2 non-empty header cells, one contains
    // "question" or is exactly "Q" (case-insensitive)
    const isFaq =
      nonEmptyCells.length === 2 &&
      nonEmptyCells.some((c) => /question|^q$/i.test(c));

    parts.push(`## ${sheetName}`);
    parts.push('');

    if (isFaq) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of dataRows as any[][]) {
        const q = String(row[0] ?? '').trim();
        const a = String(row[1] ?? '').trim();
        if (q) {
          parts.push(`**Q:** ${q}`);
          parts.push(`**A:** ${a}`);
          parts.push('');
        }
      }
    } else {
      // Render non-empty cells as bullet points
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of dataRows as any[][]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cells = (row as any[])
          .map((c) => String(c ?? '').trim())
          .filter((c) => c !== '');
        if (cells.length > 0) {
          parts.push(`- ${cells.join(' — ')}`);
        }
      }
      parts.push('');
    }
  }

  const raw = parts.join('\n').trim();

  // Already structured — skip Haiku
  if (isAlreadyStructured(raw)) {
    return raw;
  }

  return normaliseWithHaiku(raw);
}

// ---------------------------------------------------------------------------
// Word (.docx) → markdown
// ---------------------------------------------------------------------------

/**
 * Converts a .docx buffer to markdown using mammoth.convertToMarkdown.
 *
 * convertToMarkdown is present at runtime in mammoth v1.x but is absent from
 * the published TypeScript definitions, so an any cast is required.
 *
 * If the resulting markdown already contains ## headings, Haiku is skipped.
 */
export async function docxToMarkdown(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (mammoth as any).convertToMarkdown({ buffer }) as {
    value: string;
    messages: Array<{ type: string; message: string }>;
  };

  const warnings = (result.messages ?? [])
    .filter((m) => m.type === 'warning')
    .map((m) => m.message)
    .join('; ');
  if (warnings) {
    console.warn('[docxToMarkdown] mammoth warnings:', warnings);
  }

  const raw = (result.value ?? '').trim();
  if (!raw) {
    throw new Error('No content extracted from the Word document.');
  }

  // Already structured markdown — skip Haiku
  if (hasMarkdownHeadings(raw)) {
    return raw;
  }

  return normaliseWithHaiku(raw);
}
