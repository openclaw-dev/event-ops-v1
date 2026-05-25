/**
 * GET /api/orders/template
 *
 * Returns a minimal template CSV with all required and optional column
 * headers, plus one example data row, as a file download.
 */
export async function GET() {
  const headers =
    'order_id,customer_phone_e164,customer_name,customer_email,preferred_language,' +
    'ticket_type,quantity,amount_paid_aed,currency,purchase_date,status,vip_flag,' +
    'transfer_eligible,notes';

  const example =
    'ORD-EXAMPLE,+971501234567,Jane Smith,jane@example.com,en,' +
    'GA - Day 1,1,200.00,AED,2026-01-15,completed,false,true,';

  const csv = `${headers}\n${example}\n`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="orders_template.csv"',
    },
  });
}
