// Maps the user-facing intent filter key to the conversation states it covers.
// Shared between the conversations list page and the CSV export route.
export const INTENT_TO_STATES: Record<string, string[]> = {
  faq:        ['faq_answer'],
  order:      ['order_lookup'],
  refund:     ['refund_deflection'],
  escalation: ['escalation_triggered'],
  other:      ['greeting', 'session_closed', 'START', 'INTAKE'],
};
