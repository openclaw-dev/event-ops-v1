import type { WhatsAppAdapter } from './types'

/**
 * Returns the correct adapter based on WHATSAPP_PROVIDER env var.
 * Actual adapter implementations are created in Issues 17a/17b (not this issue).
 * This factory is a stub that throws until the implementations land.
 * The inbound webhook route imports only this factory — never a concrete adapter.
 */
export function createWhatsAppAdapter(): WhatsAppAdapter {
  // Trim + lowercase so a trailing newline or stray casing in WHATSAPP_PROVIDER
  // cannot silently defeat the exact-match (the documented "meta\n" !== "meta" bug).
  const provider = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase()

  if (provider === 'meta') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MetaAdapter } = require('./meta-adapter')
    return new MetaAdapter()
  }

  if (provider === '360dialog') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Dialog360Adapter } = require('./360dialog-adapter')
    return new Dialog360Adapter()
  }

  throw new Error(
    `WHATSAPP_PROVIDER is "${provider ?? 'unset'}". ` +
    `Set it to exactly "meta" or "360dialog" in your environment variables.`
  )
}
