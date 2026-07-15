/**
 * env.ts
 *
 * Centralised environment-variable reads. Every value is trimmed on read to
 * kill the documented "trailing newline" class (a `\n` in a Vercel env value
 * breaks exact-match comparisons, Authorization headers, and client
 * constructors — see CLAUDE.md, this cost a full production debugging session).
 *
 * - requireEnv(name): trimmed value, or throws a descriptive error naming the
 *   variable when it is unset or empty-after-trim. Use for values a code path
 *   cannot function without (auth tokens, service keys, client constructors).
 * - optionalEnv(name): trimmed value, or undefined when unset/empty-after-trim
 *   (so a whitespace-only value never masquerades as "configured"). Use for
 *   feature-gated values where absence is a valid state.
 */

export function requireEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    throw new Error(
      `Missing required environment variable ${name} (unset or empty after trim).`,
    );
  }
  return val;
}

export function optionalEnv(name: string): string | undefined {
  const val = process.env[name]?.trim();
  return val ? val : undefined;
}
