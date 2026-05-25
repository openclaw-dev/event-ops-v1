import type { ParsedSection, ParseResult } from './kb-types';

/** Convert a heading string to a dot-separated section_id. */
function headingToSectionId(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '.');
}

/**
 * Parse a simple `key: value` YAML block (no nesting, no arrays).
 * Returns a plain object with string or boolean values.
 */
function parseYamlBlock(block: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (!m) continue;
    const [, key, val] = m;
    out[key.trim()] =
      val.trim() === 'true' ? true : val.trim() === 'false' ? false : val.trim();
  }
  return out;
}

/**
 * Parse a Markdown file into KB sections.
 *
 * Rules (from spec §6.2):
 *  - Split on `## ` level-2 headers. Content before the first header is ignored.
 *  - Heading text becomes the fallback section_id (lowercased, kebab-cased → dot-separated).
 *  - If the heading is immediately followed by a fenced ```yaml block, parse the
 *    block for `section_id`, `category`, `intent`, `escalation_needed`,
 *    `question_en`, `question_ar`. The text after the block becomes `answer_en`.
 *  - Without a yaml block, all body text under the heading is `answer_en`.
 */
export function parseMarkdown(content: string): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: string[] = [];

  // Split on level-2 headings (## ).
  // /^## /m matches the start of each heading line.
  const rawChunks = content.split(/^## /m);
  // rawChunks[0] is text before the first ## (ignored)
  const chunks = rawChunks.slice(1);

  chunks.forEach((chunk, i) => {
    try {
      const lines = chunk.split('\n');
      const headingRaw = lines[0]?.trim() ?? '';
      if (!headingRaw) {
        errors.push(`Chunk ${i + 1}: empty heading, skipped.`);
        return;
      }

      const bodyText = lines.slice(1).join('\n');

      // Attempt to extract a fenced yaml/yml code block at the start of the body.
      const yamlFenceRe = /^\s*```(?:yaml|yml)?\n([\s\S]*?)```\n?([\s\S]*)/;
      const yamlMatch = bodyText.trimStart().match(yamlFenceRe);

      let meta: Record<string, string | boolean> = {};
      let answer_en = '';

      if (yamlMatch) {
        meta = parseYamlBlock(yamlMatch[1]);
        answer_en = (yamlMatch[2] ?? '').trim();
      } else {
        answer_en = bodyText.trim();
      }

      const section_id =
        typeof meta.section_id === 'string' && meta.section_id
          ? meta.section_id
          : headingToSectionId(headingRaw);

      if (!answer_en) {
        // Fallback: use the heading text itself as the answer.
        answer_en = headingRaw;
      }

      sections.push({
        section_id,
        category: typeof meta.category === 'string' ? meta.category : null,
        intent: typeof meta.intent === 'string' ? meta.intent : null,
        escalation_needed: meta.escalation_needed === true,
        question_en:
          typeof meta.question_en === 'string' ? meta.question_en : null,
        answer_en,
        question_ar:
          typeof meta.question_ar === 'string' ? meta.question_ar : null,
        answer_ar:
          typeof meta.answer_ar === 'string' ? meta.answer_ar : null,
        sort_order: i,
      });
    } catch (err) {
      errors.push(`Chunk ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return { sections, errors };
}
