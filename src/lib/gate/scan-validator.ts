import { createAdminClient } from '@/lib/supabase/admin';

export interface ScanResult {
  result: 'admitted' | 'duplicate' | 'not_found' | 'invalid';
  order_id?: string;
  customer_name?: string;
  customer_phone?: string;
  ticket_type?: string;
  quantity?: number;
  first_scan_at?: string;
  message: string;
  message_ar?: string;
}

interface ValidateScanParams {
  event_id: string;
  operator_id: string;
  scanned_code: string;
  gate_name?: string;
  scanner_device?: string;
  scanned_by_user_id?: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function validateAndRecordScan(params: ValidateScanParams): Promise<ScanResult> {
  const supabase = createAdminClient();
  const code = params.scanned_code.trim();

  if (!code) {
    return { result: 'invalid', message: '✗ Empty code', message_ar: '✗ رمز فارغ' };
  }

  // Check if this code was already admitted at this event.
  const { data: existing } = await supabase
    .from('gate_scans')
    .select('id, created_at, customer_name')
    .eq('event_id', params.event_id)
    .eq('scanned_code', code)
    .eq('scan_result', 'admitted')
    .maybeSingle();

  if (existing) {
    await supabase.from('gate_scans').insert({
      operator_id: params.operator_id,
      event_id: params.event_id,
      scanned_code: code,
      scan_result: 'duplicate',
      first_scan_id: existing.id,
      first_scan_at: existing.created_at,
      gate_name: params.gate_name,
      scanner_device: params.scanner_device,
      scanned_by_user_id: params.scanned_by_user_id ?? null,
    });

    const time = formatTime(existing.created_at as string);
    return {
      result: 'duplicate',
      first_scan_at: existing.created_at as string,
      message: `⚠ Already scanned at ${time}`,
      message_ar: `⚠ تم المسح مسبقاً في ${time}`,
    };
  }

  // Look up the order — match on external order_id (case-insensitive).
  const { data: order } = await supabase
    .from('orders')
    .select('order_id, customer_name, customer_phone_e164, ticket_type, quantity')
    .eq('event_id', params.event_id)
    .eq('status', 'completed')
    .ilike('order_id', code)
    .maybeSingle();

  if (!order) {
    await supabase.from('gate_scans').insert({
      operator_id: params.operator_id,
      event_id: params.event_id,
      scanned_code: code,
      scan_result: 'not_found',
      gate_name: params.gate_name,
      scanner_device: params.scanner_device,
      scanned_by_user_id: params.scanned_by_user_id ?? null,
    });

    return {
      result: 'not_found',
      message: '✗ Ticket not found',
      message_ar: '✗ التذكرة غير موجودة',
    };
  }

  // Admit the ticket.
  await supabase.from('gate_scans').insert({
    operator_id: params.operator_id,
    event_id: params.event_id,
    scanned_code: code,
    scan_result: 'admitted',
    order_id: order.order_id as string,
    customer_name: order.customer_name as string | null,
    customer_phone: order.customer_phone_e164 as string,
    ticket_type: order.ticket_type as string | null,
    quantity: order.quantity as number,
    gate_name: params.gate_name,
    scanner_device: params.scanner_device,
    scanned_by_user_id: params.scanned_by_user_id ?? null,
  });

  const name = (order.customer_name as string | null) ?? '';
  const ticketType = (order.ticket_type as string | null) ?? '';

  return {
    result: 'admitted',
    order_id: order.order_id as string,
    customer_name: name || undefined,
    customer_phone: order.customer_phone_e164 as string,
    ticket_type: ticketType || undefined,
    quantity: order.quantity as number,
    message: `✓ Welcome${name ? `, ${name}` : ''}!${ticketType ? ` ${ticketType}` : ''}`,
    message_ar: `✓ أهلاً${name ? `، ${name}` : ''}!${ticketType ? ` ${ticketType}` : ''}`,
  };
}
