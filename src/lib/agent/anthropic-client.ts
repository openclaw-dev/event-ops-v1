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

let proxyConfigured = false;

function ensureProxyConfigured() {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl) {
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  }
}

ensureProxyConfigured();

export const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
