import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import type { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { orderRowSchema } from '@/lib/schemas';

const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_ROWS  = 100_000;
const BATCH     = 500;
const BUCKET    = 'orders';

// Storage upload + Papa.parse + 100k-row validation + batched upsert can run
// 30-60s at the upper end. Vercel Hobby caps at 10s; Pro respects up to 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';

/** Surface max 100 errors in the HTTP response; full list lives in order_import_errors. */
const MAX_ERRORS_IN_RESPONSE = 100;

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface OrderInsertRow {
  event_id: string;
  order_import_id: string;
  order_id: string;
  customer_phone_e164: string;
  customer_name: string | null;
  customer_email: string | null;
  preferred_language: string;
  ticket_type: string;
  quantity: number;
  amount_paid: number | null;
  currency: string;
  purchase_date: string | null;
  status: string;
  vip_flag: boolean;
  transfer_eligible: boolean;
  notes: string | null;
  raw_row: Record<string, unknown>;
}

function formatZodIssues(issues: z.ZodIssue[]): RowError['message'] {
  return issues
    .map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * POST /api/orders/import
 *
 * Multipart form fields:
 *   file     — CSV file (≤ 10 MB, ≤ 100 000 rows)
 *   event_id — UUID of the target event
 *
 * Returns:
 *   { import_id, row_count, error_count, errors[] }
 */
export async function POST(request: Request) {
  // ── 1. Parse multipart ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const file    = formData.get('file');
  const eventId = formData.get('event_id');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (typeof eventId !== 'string' || !eventId) {
    return NextResponse.json({ error: 'event_id is required.' }, { status: 400 });
  }

  // ── 2. Validate file ──────────────────────────────────────────────────────
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 10 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 },
    );
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext !== 'csv') {
    return NextResponse.json(
      { error: 'Only .csv files are supported.' },
      { status: 415 },
    );
  }

  // ── 3. Auth + event access ────────────────────────────────────────────────
  const supabase = createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
  }

  const { data: operatorUser } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', event.operator_id)
    .single();

  if (!operatorUser) {
    return NextResponse.json({ error: 'No operator membership found.' }, { status: 403 });
  }

  // ── 4. Upload raw CSV to storage ──────────────────────────────────────────
  const admin = createAdminClient();
  const timestamp   = Date.now();
  const storagePath = `events/${eventId}/orders/${timestamp}_${file.name}`;
  const fileBuffer  = Buffer.from(await file.arrayBuffer());

  const { error: storageError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: 'text/csv',
      upsert: false,
    });

  if (storageError) {
    return NextResponse.json(
      { error: `Storage upload failed: ${storageError.message}` },
      { status: 500 },
    );
  }

  // ── 5. Insert order_imports row (status: processing) ─────────────────────
  const { data: importRow, error: importInsertError } = await supabase
    .from('order_imports')
    .insert({
      event_id: eventId,
      filename: file.name,
      storage_path: storagePath,
      uploaded_by: operatorUser.id,
      status: 'processing',
    })
    .select('id')
    .single();

  if (importInsertError || !importRow) {
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: `Failed to record import: ${importInsertError?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  const importId = importRow.id as string;

  // ── 6. Parse CSV ──────────────────────────────────────────────────────────
  const csvText = new TextDecoder().decode(fileBuffer);

  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  if (parsed.data.length > MAX_ROWS) {
    await finalise(supabase, admin, importId, 0, parsed.data.length, event.operator_id, user.id, 'failed');
    return NextResponse.json(
      { error: `CSV exceeds the 100 000-row limit (got ${parsed.data.length} rows).` },
      { status: 422 },
    );
  }

  // ── 7. Validate rows ──────────────────────────────────────────────────────
  const validRows: OrderInsertRow[] = [];
  const rowErrors: RowError[]       = [];

  parsed.data.forEach((rawRow, i) => {
    const csvRowNumber = i + 2; // +1 for header, +1 for 1-based

    const result = orderRowSchema.safeParse(rawRow);
    if (result.success) {
      const d = result.data;
      validRows.push({
        event_id:               eventId,
        order_import_id:        importId,
        order_id:               d.order_id,
        customer_phone_e164:    d.customer_phone_e164,
        customer_name:          d.customer_name ?? null,
        customer_email:         d.customer_email ?? null,
        preferred_language:     d.preferred_language,
        ticket_type:            d.ticket_type,
        quantity:               d.quantity,
        amount_paid:            d.amount_paid_aed ?? null,
        currency:               d.currency,
        purchase_date:          d.purchase_date ?? null,
        status:                 d.status,
        vip_flag:               d.vip_flag,
        transfer_eligible:      d.transfer_eligible,
        notes:                  d.notes ?? null,
        raw_row:                rawRow,
      });
    } else {
      const message = formatZodIssues(result.error.issues);
      rowErrors.push({ row: csvRowNumber, field: result.error.issues[0]?.path.join('.') ?? '', message });
    }
  });

  // ── 8. Upsert valid rows to orders ────────────────────────────────────────
  let upsertedCount = 0;

  for (let i = 0; i < validRows.length; i += BATCH) {
    const batch = validRows.slice(i, i + BATCH);
    const { error: upsertError } = await supabase
      .from('orders')
      // Supabase JS generics require the generated DB type which we don't have;
      // cast through unknown to avoid the mismatch without losing runtime safety.
      .upsert(batch as unknown[], {
        onConflict: 'event_id,order_id',
        ignoreDuplicates: false,
      });

    if (upsertError) {
      // Surface batch failures as row-level errors.
      rowErrors.push({
        row: i + 2,
        field: '',
        message: `Batch upsert failed: ${upsertError.message}`,
      });
    } else {
      upsertedCount += batch.length;
    }
  }

  // ── 9. Insert order_import_errors ─────────────────────────────────────────
  if (rowErrors.length > 0) {
    const errorRows = rowErrors.map((e) => ({
      order_import_id: importId,
      row_number:      e.row,
      error_message:   `Row ${e.row}${e.field ? ` (${e.field})` : ''}: ${e.message}`,
      raw_row:         parsed.data[e.row - 2] ?? null,
    }));

    for (let i = 0; i < errorRows.length; i += BATCH) {
      await supabase
        .from('order_import_errors')
        .insert(errorRows.slice(i, i + BATCH));
    }
  }

  // ── 10. Finalise order_imports row ────────────────────────────────────────
  const finalStatus = upsertedCount === 0 ? 'failed' : 'completed';
  await finalise(
    supabase,
    admin,
    importId,
    upsertedCount,
    rowErrors.length,
    event.operator_id,
    user.id,
    finalStatus,
  );

  return NextResponse.json({
    import_id:   importId,
    row_count:   upsertedCount,
    error_count: rowErrors.length,
    errors:      rowErrors.slice(0, MAX_ERRORS_IN_RESPONSE),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function finalise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  importId: string,
  rowCount: number,
  errorCount: number,
  operatorId: string,
  userId: string,
  status: 'completed' | 'failed',
) {
  await supabase
    .from('order_imports')
    .update({ status, row_count: rowCount, error_count: errorCount })
    .eq('id', importId);

  await admin.from('audit_log').insert({
    operator_id:  operatorId,
    actor_type:   'user',
    actor_id:     userId,
    action:       'orders.imported',
    entity_type:  'order_import',
    entity_id:    importId,
    metadata:     { row_count: rowCount, error_count: errorCount, status },
  });
}
