-- ============================================================================
-- 0009_rls.sql
-- Row-Level Security: helper function + policies for every table.
-- Verbatim from admin_shell_spec.md section 3.5. Without these policies,
-- RLS is enabled but no rows are visible to any authenticated user.
-- ============================================================================

-- Helper function: returns operator_ids the current authenticated user belongs to.
CREATE OR REPLACE FUNCTION current_user_operator_ids()
RETURNS SETOF UUID
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT operator_id FROM operator_users WHERE user_id = auth.uid();
$$;

-- Enable RLS on all tables
ALTER TABLE operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_import_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Operators: users see operators they belong to.
CREATE POLICY operators_select ON operators FOR SELECT
  USING (id IN (SELECT current_user_operator_ids()));

-- Operator_users: users see other users in their operators.
CREATE POLICY operator_users_select ON operator_users FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));

-- Events: scoped by operator_id.
CREATE POLICY events_all ON events FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));

-- Event_users: scoped by event's operator.
CREATE POLICY event_users_all ON event_users FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- KB documents: scoped via event_id.
CREATE POLICY kb_documents_all ON kb_documents FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- KB sections: same scoping pattern.
CREATE POLICY kb_sections_all ON kb_sections FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY order_imports_all ON order_imports FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY orders_all ON orders FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY order_import_errors_all ON order_import_errors FOR ALL
  USING (order_import_id IN (SELECT id FROM order_imports WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))))
  WITH CHECK (order_import_id IN (SELECT id FROM order_imports WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))));

CREATE POLICY conversations_all ON conversations FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY messages_all ON messages FOR ALL
  USING (conversation_id IN (SELECT id FROM conversations WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))))
  WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids()))));

CREATE POLICY escalations_all ON escalations FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

CREATE POLICY refund_cases_all ON refund_cases FOR ALL
  USING (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())))
  WITH CHECK (event_id IN (SELECT id FROM events WHERE operator_id IN (SELECT current_user_operator_ids())));

-- Audit log: read-only via RLS, writes via service role only.
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));
