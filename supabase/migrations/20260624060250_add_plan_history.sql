CREATE TABLE IF NOT EXISTS plan_history (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    uuid REFERENCES production_orders(id) ON DELETE CASCADE,
  order_ref   text NOT NULL,
  unc_codes   text,
  event_type  text NOT NULL,  -- 'created' | 'updated' | 'planned' | 'unplanned' | 'urgent_confirmed'
  field_name  text,
  old_value   text,
  new_value   text,
  changed_by  text,
  created_at  timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE plan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_select_history" ON plan_history FOR SELECT TO anon USING (true);
CREATE POLICY "allow_insert_history" ON plan_history FOR INSERT TO anon WITH CHECK (true);
