/**
 * Shared Anthropic client.
 *
 * Configures an HTTPS_PROXY (or lowercase https_proxy) when present, so the
 * SDK's underlying fetch routes through the proxy. Node's global fetch does
 * not honor proxy env vars on its own; curl does, which masks the issue
 * during ad-hoc testing.
 *
 * The proxy is only installed when a proxy URL is set, so this is a no-op
 * in environments without one (production, CI).
 */

import Anthropic from '@anthropic-ai/sdk';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

import { requireEnv } from '@/lib/env';

let proxyConfigured = false;

function ensureProxyConfigured() {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }
}

// Lazily construct the client on first use rather than at module load, so a
// missing/whitespace ANTHROPIC_API_KEY throws a descriptive error only when an
// agent call is actually made — not by crashing every route that merely imports
// something in this module's dependency graph (audit 2.7). requireEnv trims the
// key, killing the trailing-newline → opaque-401 failure mode.
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (client) return client;
  ensureProxyConfigured();
  client = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  return client;
}

/**
 * Proxy that defers construction to first property access while keeping the
 * exported surface identical to `new Anthropic(...)` — callers still write
 * `claude.messages.create(...)` unchanged.
 */
export const claude: Anthropic = new Proxy({} as Anthropic, {
  get(_target, prop, receiver) {
    const c = getClient();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});
