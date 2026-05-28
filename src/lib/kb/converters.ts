/**
 * Converters for non-markdown KB file formats.
 *
 * xlsxToMarkdown — parses an Excel workbook and produces markdown.
 * docxToMarkdown — converts a Word document to markdown via mammoth.
 *
 * Both pass the raw result through a Haiku normalisation prompt that
 * enforces ## headings + bullet points and strips formatting artefacts.
 */

import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

import { claude } from '@/lib/agent/anthropic-client';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// Haiku normalisation pass
// ---------------------------------------------------------------------------

async function normaliseWithHaiku(raw: string): Promise<string> {
  const message = await claude.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content:
          'Convert the following event FAQ content into clean markdown sections. ' +
          'Each section must have a ## heading and use bullet points. ' +
          'Preserve all factual content. Remove formatting artifacts. ' +
          'Return only the markdown, no preamble.\n\nContent:\n' +
          raw,
      },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Haiku normalisation.');
  }
  return block.text.trim();
}

// ---------------------------------------------------------------------------
// Excel → markdown
// ---------------------------------------------------------------------------

/**
 * Converts an xlsx/xls buffer to a markdown string.
 *
 * Detection heuristic:
 *   - If the first sheet has exactly 2 columns and the first row headers
 *     contain "question"/"q" and "answer"/"a", render as Q/A pairs.
 *   - Otherwise render each sheet as a markdown table.
 *
 * The raw result is then normalised through Haiku.
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

    const header = rows[0] as string[];
    const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

    // FAQ format detection: 2 columns with question/answer headers
    const isFaq =
      header.length === 2 &&
      /^(question|q)$/i.test(String(header[0]).trim()) &&
      /^(answer|a)$/i.test(String(header[1]).trim());

    parts.push(`## ${sheetName}`);

    if (isFaq) {
      for (const row of dataRows) {
        const q = String(row[0] ?? '').trim();
        const a = String(row[1] ?? '').trim();
        if (q) {
          parts.push(`**Q: ${q}**`);
          parts.push(`A: ${a}`);
          parts.push('');
        }
      }
    } else {
      // Render as markdown table
      const colWidths = header.map((h, i) =>
        Math.max(
          String(h).length,
          ...dataRows.map((r) => String(r[i] ?? '').length),
        ),
      );
      const sep = colWidths.map((w) => '-'.repeat(Math.max(w, 3))).join(' | ');
      const head = header.map((h, i) => String(h).padEnd(colWidths[i] ?? 3)).join(' | ');
      parts.push(`| ${head} |`);
      parts.push(`| ${sep} |`);
      for (const row of dataRows) {
        const cells = header.map((_, i) => String(row[i] ?? '').padEnd(colWidths[i] ?? 3));
        parts.push(`| ${cells.join(' | ')} |`);
      }
      parts.push('');
    }
  }

  const raw = parts.join('\n');
  return normaliseWithHaiku(raw);
}

// ---------------------------------------------------------------------------
// Word (.docx) → markdown
// ---------------------------------------------------------------------------

/**
 * Converts a .docx buffer to markdown using mammoth (HTML pass), then
 * normalises the result through Haiku.
 *
 * mammoth's type definitions omit convertToMarkdown; we use convertToHtml
 * (which is typed) and pass the HTML directly to Haiku, which handles the
 * HTML→markdown conversion as part of its normalisation prompt.
 */
export async function docxToMarkdown(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer });

  if (result.messages.length > 0) {
    const warnings = result.messages
      .filter((m) => m.type === 'warning')
      .map((m) => m.message)
      .join('; ');
    if (warnings) {
      console.warn('[docxToMarkdown] mammoth warnings:', warnings);
    }
  }

  const raw = result.value.trim();
  if (!raw) {
    throw new Error('No content extracted from the Word document.');
  }

  return normaliseWithHaiku(raw);
}
