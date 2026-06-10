/**
 * seed-demo-event.ts
 *
 * Creates a fully configured demo event for sales demos.
 * Inserts: event, KB sections, orders, conversations, messages, 1 escalation.
 * All writes go through createAdminClient() — no user session required.
 */

import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeedDemoResult {
  event_id: string;
  event_name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return a DATE string N days from today in YYYY-MM-DD format. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Return an ISO timestamp N hours ago. */
function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
}

// ─── Static demo data ─────────────────────────────────────────────────────────

const EVENT_NAME = 'Coastline Festival 2026';
const EVENT_SLUG = `coastline-festival-2026-demo-${Date.now()}`;

const DEMO_ORDERS = [
  { order_id: 'CF-001', customer_name: 'Ahmed Al Mansoori', customer_phone_e164: '+971501234001', customer_email: 'ahmed.m@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-002', customer_name: 'Fatima Al Rashidi', customer_phone_e164: '+971501234002', customer_email: 'fatima.r@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-003', customer_name: 'Mohammed Al Zahrani', customer_phone_e164: '+966501234003', customer_email: 'mo.z@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-004', customer_name: 'Sara Al Otaibi', customer_phone_e164: '+966501234004', customer_email: 'sara.o@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-005', customer_name: 'Khalid Al Shamsi', customer_phone_e164: '+971501234005', customer_email: 'khalid.s@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-006', customer_name: 'Nour El-Hassan', customer_phone_e164: '+971501234006', customer_email: 'nour.h@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-007', customer_name: 'Tariq Al Balushi', customer_phone_e164: '+968501234007', customer_email: 'tariq.b@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-008', customer_name: 'Layla Al Amri', customer_phone_e164: '+971501234008', customer_email: 'layla.a@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-009', customer_name: 'Omar Al Farsi', customer_phone_e164: '+971501234009', customer_email: 'omar.f@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-010', customer_name: 'Reem Al Nuaimi', customer_phone_e164: '+971501234010', customer_email: 'reem.n@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-011', customer_name: 'Abdullah Al Suwaidi', customer_phone_e164: '+971501234011', customer_email: 'abd.s@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-012', customer_name: 'Mariam Al Kaabi', customer_phone_e164: '+971501234012', customer_email: 'mariam.k@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-013', customer_name: 'Yousef Al Marzooqi', customer_phone_e164: '+971501234013', customer_email: 'yousef.m@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-014', customer_name: 'Hessa Al Falasi', customer_phone_e164: '+971501234014', customer_email: 'hessa.f@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-015', customer_name: 'Saad Al Qahtani', customer_phone_e164: '+966501234015', customer_email: 'saad.q@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-016', customer_name: 'Aisha Al Harthi', customer_phone_e164: '+966501234016', customer_email: 'aisha.h@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-017', customer_name: 'Hamad Al Neyadi', customer_phone_e164: '+971501234017', customer_email: 'hamad.n@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-018', customer_name: 'Shaikha Al Mazrouei', customer_phone_e164: '+971501234018', customer_email: 'shaikha.m@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
  { order_id: 'CF-019', customer_name: 'Faisal Al Ghamdi', customer_phone_e164: '+966501234019', customer_email: 'faisal.g@example.com', ticket_type: 'VIP', amount_paid: 350, currency: 'SAR', vip_flag: true },
  { order_id: 'CF-020', customer_name: 'Noura Al Sayed', customer_phone_e164: '+966501234020', customer_email: 'noura.s@example.com', ticket_type: 'General Admission', amount_paid: 150, currency: 'SAR', vip_flag: false },
] as const;

const KB_SECTIONS = [
  {
    section_id: 'timing.doors',
    category: 'Timing',
    intent: 'timing_doors',
    escalation_needed: false,
    question_en: 'What time do doors open?',
    answer_en: 'Doors open at 8:00 PM. We recommend arriving 30–45 minutes early to avoid queues at the entrance.',
    language: 'all',
  },
  {
    section_id: 'timing.last_entry',
    category: 'Timing',
    intent: 'timing_entry',
    escalation_needed: false,
    question_en: 'What is the last entry time?',
    answer_en: 'Last entry is at 11:00 PM. Gates close promptly at that time — please plan your journey accordingly.',
    language: 'all',
  },
  {
    section_id: 'venue.location',
    category: 'Venue',
    intent: 'venue_info',
    escalation_needed: false,
    question_en: 'Where is the festival located?',
    answer_en: 'Coastline Festival 2026 takes place at Jumeirah Beach Park, Dubai. The nearest metro station is Business Bay (approximately 15 minutes by taxi or rideshare).',
    language: 'all',
  },
  {
    section_id: 'tickets.price',
    category: 'Tickets',
    intent: 'ticket_info',
    escalation_needed: false,
    question_en: 'How much are tickets?',
    answer_en: 'General Admission is SAR 150. VIP tickets are SAR 350 and include access to the VIP lounge, a dedicated bar, and a complimentary welcome drink.',
    language: 'all',
  },
  {
    section_id: 'policy.refund.main',
    category: 'Refund Policy',
    intent: 'refund_policy',
    escalation_needed: false,
    question_en: 'What is your refund policy?',
    answer_en: 'Full refunds are available up to 7 days before the event. After that, tickets are non-refundable. For medical emergencies, please contact our team with supporting documentation.',
    language: 'all',
  },
  {
    section_id: 'dresscode.policy',
    category: 'Dress Code',
    intent: 'dress_code',
    escalation_needed: false,
    question_en: 'What is the dress code?',
    answer_en: 'Smart casual is required. No beachwear, flip-flops, or sportswear. The venue reserves the right to refuse entry to guests who do not meet the dress code.',
    language: 'all',
  },
  {
    section_id: 'parking.info',
    category: 'Parking',
    intent: 'parking_info',
    escalation_needed: false,
    question_en: 'Is there parking available?',
    answer_en: 'Free parking is available at Gate 3. Valet service is available at the main entrance for AED 30. We recommend arriving early as spaces fill quickly.',
    language: 'all',
  },
  {
    section_id: 'reentry.policy',
    category: 'Re-entry',
    intent: 'reentry_policy',
    escalation_needed: false,
    question_en: 'Is re-entry permitted?',
    answer_en: 'Re-entry is not permitted once you have exited the venue. Please ensure you have everything you need before leaving the festival grounds.',
    language: 'all',
  },
  {
    section_id: 'accessibility.info',
    category: 'Accessibility',
    intent: 'accessibility',
    escalation_needed: false,
    question_en: 'Is the venue wheelchair accessible?',
    answer_en: 'Yes, the venue is fully wheelchair accessible with ramps and accessible restrooms throughout. Dedicated accessible parking is available at Gate 1. Please contact us in advance if you require additional assistance.',
    language: 'all',
  },
  {
    section_id: 'food.drinks',
    category: 'Food & Drinks',
    intent: 'food_info',
    escalation_needed: false,
    question_en: 'Is there food and drink at the festival?',
    answer_en: 'Yes! There are 12 food vendors and 4 bars across the venue offering a wide variety of cuisines and beverages. Outside food and drinks are not permitted inside the festival.',
    language: 'all',
  },
] as const;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function seedDemoEvent(operatorId: string): Promise<SeedDemoResult> {
  const admin = createAdminClient();

  // ── 1. Compute event dates ─────────────────────────────────────────────────
  const startDate = daysFromToday(21);
  const endDate = daysFromToday(21); // single-day festival

  // ── 2. Build EventConfig JSONB ─────────────────────────────────────────────
  const config = {
    event_id: '',        // filled in after insert
    event_name: EVENT_NAME,
    event_date_iso: startDate,
    refund_policy: {
      shape: 'tiered',
      tiers: [{ days_before_event: 7, refund_pct: 100 }],
      allowed_alternatives_after_window: ['transfer', 'credit'],
      credit_validity_months: 12,
      medical_exception_section_id: 'policy.refund.medical',
    },
    escalation_keywords: ['urgent', 'emergency', 'manager', 'refund'],
    vip_orders_always_escalate: true,
    dress_code: 'Smart casual — no beachwear, flip-flops, or sportswear',
    age_minimum: 21,
    doors_open_local: '20:00',
    doors_close_local: '03:00',
    last_entry_local: '23:00',
    parking_info: 'Free parking at Gate 3. Valet at main entrance (AED 30).',
    escalation_contacts: [
      { name: 'Ops Manager', hours: '18:00–04:00', method: 'in-app handoff', phone: '' },
    ],
    ticket_tiers: [
      { name: 'General Admission', price: 150, description: 'Standard festival entry' },
      { name: 'VIP', price: 350, description: 'VIP lounge, dedicated bar, welcome drink' },
    ],
  };

  // ── 3. Insert event ────────────────────────────────────────────────────────
  const { data: eventRow, error: eventError } = await admin
    .from('events')
    .insert({
      operator_id: operatorId,
      name: EVENT_NAME,
      slug: EVENT_SLUG,
      event_type: 'festival',
      start_date: startDate,
      end_date: endDate,
      timezone: 'Asia/Dubai',
      venue_name: 'Jumeirah Beach Park',
      venue_city: 'Dubai',
      capacity: 5000,
      age_minimum: 21,
      status: 'live',
      config,
      is_demo: true,
    })
    .select('id')
    .single();

  if (eventError || !eventRow) {
    throw new Error(`Demo event insert failed: ${eventError?.message ?? 'unknown'}`);
  }

  const eventId = eventRow.id as string;

  // Patch config.event_id with the real UUID.
  await admin
    .from('events')
    .update({ config: { ...config, event_id: eventId } })
    .eq('id', eventId);

  // ── 4. Insert KB sections ──────────────────────────────────────────────────
  const kbRows = KB_SECTIONS.map((s, i) => ({
    event_id: eventId,
    section_id: s.section_id,
    category: s.category,
    intent: s.intent,
    escalation_needed: s.escalation_needed,
    question_en: s.question_en,
    answer_en: s.answer_en,
    question_ar: null,
    answer_ar: null,
    sort_order: i,
    language: s.language,
  }));

  await admin.from('kb_sections').insert(kbRows);

  // ── 5. Insert orders ───────────────────────────────────────────────────────
  const orderRows = DEMO_ORDERS.map((o) => ({
    event_id: eventId,
    order_id: o.order_id,
    customer_phone_e164: o.customer_phone_e164,
    customer_name: o.customer_name,
    customer_email: o.customer_email,
    ticket_type: o.ticket_type,
    quantity: 1,
    amount_paid: o.amount_paid,
    currency: o.currency,
    status: 'completed',
    vip_flag: o.vip_flag,
    transfer_eligible: true,
  }));

  await admin.from('orders').insert(orderRows);

  // ── 6. Insert conversations + messages ────────────────────────────────────

  // Conversation 1: Resolved — timing question (English)
  const { data: conv1 } = await admin
    .from('conversations')
    .insert({
      event_id: eventId,
      operator_id: operatorId,
      customer_phone_e164: '+971501234001',
      channel: 'whatsapp',
      language: 'en',
      state: 'session_closed',
      created_at: hoursAgo(48),
      updated_at: hoursAgo(47),
    })
    .select('id')
    .single();

  if (conv1?.id) {
    await admin.from('messages').insert([
      {
        conversation_id: conv1.id,
        role: 'user',
        text: "Hi, what time do doors open for the festival?",
        classified_intent: 'timing_doors',
        created_at: hoursAgo(48),
      },
      {
        conversation_id: conv1.id,
        role: 'agent',
        text: "Hi Ahmed! Doors open at 8:00 PM. We recommend arriving 30–45 minutes early to avoid queues at the entrance. See you there! 🎉",
        created_at: hoursAgo(47.9),
      },
      {
        conversation_id: conv1.id,
        role: 'user',
        text: "Perfect, thank you!",
        classified_intent: 'general_inquiry',
        created_at: hoursAgo(47.8),
      },
      {
        conversation_id: conv1.id,
        role: 'agent',
        text: "You're welcome! Enjoy the festival. If you have any more questions, feel free to ask. 😊",
        created_at: hoursAgo(47.7),
      },
    ]);
  }

  // Conversation 2: Resolved — dress code question (English)
  const { data: conv2 } = await admin
    .from('conversations')
    .insert({
      event_id: eventId,
      operator_id: operatorId,
      customer_phone_e164: '+971501234008',
      channel: 'whatsapp',
      language: 'en',
      state: 'session_closed',
      created_at: hoursAgo(36),
      updated_at: hoursAgo(35),
    })
    .select('id')
    .single();

  if (conv2?.id) {
    await admin.from('messages').insert([
      {
        conversation_id: conv2.id,
        role: 'user',
        text: "Can I wear sneakers to Coastline Festival?",
        classified_intent: 'dress_code',
        created_at: hoursAgo(36),
      },
      {
        conversation_id: conv2.id,
        role: 'agent',
        text: "Hi Layla! Clean, stylish sneakers are generally fine under the smart casual dress code. What's not permitted is beachwear, flip-flops, or athletic sportswear. The venue has the final say at the door — dressing smart always helps! 👟",
        created_at: hoursAgo(35.9),
      },
      {
        conversation_id: conv2.id,
        role: 'user',
        text: "Great, I was worried. Thanks!",
        classified_intent: 'general_inquiry',
        created_at: hoursAgo(35.8),
      },
    ]);
  }

  // Conversation 3: Escalated — VIP area complaint (English)
  const { data: conv3 } = await admin
    .from('conversations')
    .insert({
      event_id: eventId,
      operator_id: operatorId,
      customer_phone_e164: '+971501234002',
      channel: 'whatsapp',
      language: 'en',
      state: 'escalation_triggered',
      created_at: hoursAgo(24),
      updated_at: hoursAgo(23),
    })
    .select('id')
    .single();

  if (conv3?.id) {
    await admin.from('messages').insert([
      {
        conversation_id: conv3.id,
        role: 'user',
        text: "Hello, I purchased a VIP ticket but last year the VIP area was overcrowded and the bar ran out of drinks. I want to know what you're doing differently this year.",
        classified_intent: 'vip_inquiry',
        created_at: hoursAgo(24),
      },
      {
        conversation_id: conv3.id,
        role: 'agent',
        text: "Hi Fatima! I completely understand your concern — that experience sounds very frustrating. This year, VIP capacity has been reduced by 30% and we've added a second dedicated bar. I'd like to connect you with our Ops Manager who can share more details. Escalating you now.",
        created_at: hoursAgo(23.9),
      },
      {
        conversation_id: conv3.id,
        role: 'user',
        text: "Thank you, please do escalate. I want assurance before the event.",
        classified_intent: 'escalation_request',
        created_at: hoursAgo(23.8),
      },
    ]);

    // Escalation record
    await admin.from('escalations').insert({
      conversation_id: conv3.id,
      event_id: eventId,
      reason: 'VIP experience concern — customer requesting assurance about improvements',
      summary_for_ops: 'Customer purchased VIP ticket and had a poor experience last year (overcrowding, bar ran dry). Wants direct confirmation from ops team about improvements before the event.',
      priority: 'high',
      status: 'open',
      created_at: hoursAgo(23.8),
    });
  }

  // Conversation 4: Refund deflected (English)
  const { data: conv4 } = await admin
    .from('conversations')
    .insert({
      event_id: eventId,
      operator_id: operatorId,
      customer_phone_e164: '+966501234003',
      channel: 'whatsapp',
      language: 'en',
      state: 'session_closed',
      created_at: hoursAgo(12),
      updated_at: hoursAgo(11),
    })
    .select('id')
    .single();

  if (conv4?.id) {
    await admin.from('messages').insert([
      {
        conversation_id: conv4.id,
        role: 'user',
        text: "I need to cancel my ticket and get a refund. The event is in 4 days and I can't make it.",
        classified_intent: 'refund_request',
        created_at: hoursAgo(12),
      },
      {
        conversation_id: conv4.id,
        role: 'agent',
        text: "Hi Mohammed, I'm sorry to hear you can't make it. Unfortunately, our refund window closed 7 days before the event, so we're past that cutoff now. However, your ticket is transfer-eligible — you can transfer it to a friend or family member at no extra charge. Would you like instructions on how to do that?",
        created_at: hoursAgo(11.9),
      },
      {
        conversation_id: conv4.id,
        role: 'user',
        text: "Oh I didn't know I could transfer it. Yes, how does that work?",
        classified_intent: 'transfer_inquiry',
        created_at: hoursAgo(11.8),
      },
      {
        conversation_id: conv4.id,
        role: 'agent',
        text: "Great! To transfer your ticket, log in to the ticketing platform where you originally purchased, navigate to 'My Tickets', and select 'Transfer'. You'll need the recipient's email address. The transfer is instant and free. Would you like me to send you the direct link?",
        created_at: hoursAgo(11.7),
      },
      {
        conversation_id: conv4.id,
        role: 'user',
        text: "That's perfect, thank you. I'll sort it out.",
        classified_intent: 'general_inquiry',
        created_at: hoursAgo(11.6),
      },
    ]);
  }

  // Conversation 5: Arabic language — ticket price question
  const { data: conv5 } = await admin
    .from('conversations')
    .insert({
      event_id: eventId,
      operator_id: operatorId,
      customer_phone_e164: '+966501234004',
      channel: 'whatsapp',
      language: 'ar',
      state: 'session_closed',
      created_at: hoursAgo(6),
      updated_at: hoursAgo(5),
    })
    .select('id')
    .single();

  if (conv5?.id) {
    await admin.from('messages').insert([
      {
        conversation_id: conv5.id,
        role: 'user',
        text: 'مرحبا، كم سعر التذكرة العادية؟',
        classified_intent: 'ticket_info',
        created_at: hoursAgo(6),
      },
      {
        conversation_id: conv5.id,
        role: 'agent',
        text: 'أهلاً سارة! سعر تذكرة الدخول العام ١٥٠ ريال سعودي. أما تذاكر الـ VIP فسعرها ٣٥٠ ريال وتشمل وصولاً حصرياً لمنطقة VIP مع بار خاص ومشروب ترحيبي مجاني. هل تودين الاستفسار عن أي شيء آخر؟ 😊',
        created_at: hoursAgo(5.9),
      },
      {
        conversation_id: conv5.id,
        role: 'user',
        text: 'شكراً جزيلاً، هذا ممتاز!',
        classified_intent: 'general_inquiry',
        created_at: hoursAgo(5.8),
      },
    ]);
  }

  // ── 7. Audit log ───────────────────────────────────────────────────────────
  await admin.from('audit_log').insert({
    operator_id: operatorId,
    event_id: eventId,
    actor_type: 'user',
    actor_id: operatorId, // best-effort — no user session in this context
    action: 'demo.seeded',
    entity_type: 'event',
    entity_id: eventId,
    metadata: {
      event_name: EVENT_NAME,
      orders: DEMO_ORDERS.length,
      kb_sections: KB_SECTIONS.length,
      conversations: 5,
    },
  });

  return { event_id: eventId, event_name: EVENT_NAME };
}
