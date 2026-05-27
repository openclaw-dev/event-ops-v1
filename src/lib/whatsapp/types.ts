// ─── Inbound message shapes ───────────────────────────────────────────────────

export type InboundMessageType = 'text' | 'button_reply' | 'unsupported'

export interface InboundTextMessage {
  type: 'text'
  wamid: string
  from_phone_e164: string
  text: string
  timestamp: number
}

export interface InboundButtonReplyMessage {
  type: 'button_reply'
  wamid: string
  from_phone_e164: string
  button_id: string        // e.g. "confirm_pc_<uuid>" or "cancel_pc_<uuid>"
  button_title: string
  context_wamid: string    // wamid of the message this replies to
  timestamp: number
}

export interface InboundUnsupportedMessage {
  type: 'unsupported'
  wamid: string
  from_phone_e164: string
  timestamp: number
}

export type InboundMessage =
  | InboundTextMessage
  | InboundButtonReplyMessage
  | InboundUnsupportedMessage

// ─── Outbound message shapes ──────────────────────────────────────────────────

export interface OutboundTextMessage {
  to_phone_e164: string
  text: string
}

export interface OutboundInteractiveMessage {
  to_phone_e164: string
  body_text: string
  buttons: Array<{
    id: string      // max 256 chars
    title: string   // max 20 chars
  }>
}

// ─── Adapter result ───────────────────────────────────────────────────────────

export interface SendResult {
  success: boolean
  wamid?: string
  error?: string
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface WhatsAppAdapter {
  /**
   * Parse a raw webhook request body (already read as unknown JSON)
   * into a normalised InboundMessage array.
   * Returns empty array if the payload contains no actionable messages.
   */
  parseInbound(rawBody: unknown): InboundMessage[]

  /**
   * Verify the webhook signature from request headers.
   * Throws if invalid. Returns void if valid.
   */
  verifySignature(rawBody: string, headers: Record<string, string>): void

  /**
   * Send a plain text message. Returns the wamid of the sent message.
   */
  sendText(msg: OutboundTextMessage): Promise<SendResult>

  /**
   * Send an interactive message with up to 3 buttons.
   * Returns the wamid of the sent message.
   */
  sendInteractive(msg: OutboundInteractiveMessage): Promise<SendResult>
}
