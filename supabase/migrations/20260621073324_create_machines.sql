-- Create machines master table
CREATE TABLE IF NOT EXISTS machines (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_type  text        NOT NULL DEFAULT 'FANUC',
  size_ton      integer     NOT NULL,
  mc_no         text        NOT NULL,
  display_order integer     NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (machine_type, size_ton, mc_no)
);

ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_machines" ON machines;
CREATE POLICY "anon_select_machines" ON machines FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_machines" ON machines;
CREATE POLICY "anon_insert_machines" ON machines FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_machines" ON machines;
CREATE POLICY "anon_update_machines" ON machines FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_machines" ON machines;
CREATE POLICY "anon_delete_machines" ON machines FOR DELETE TO anon, authenticated USING (true);

-- Seed default machine rows (FANUC 50T matches the reference image)
INSERT INTO machines (machine_type, size_ton, mc_no, display_order) VALUES
  ('FANUC', 5,   '01', 10),
  ('FANUC', 5,   '02', 20),
  ('FANUC', 30,  '01', 30),
  ('FANUC', 30,  '02', 40),
  ('FANUC', 50,  '33', 50),
  ('FANUC', 50,  '34', 60),
  ('FANUC', 50,  '38', 70),
  ('FANUC', 50,  '44', 80),
  ('FANUC', 50,  '45', 90),
  ('FANUC', 50,  '46', 100),
  ('FANUC', 50,  '47', 110),
  ('FANUC', 50,  '51', 120),
  ('FANUC', 50,  '52', 130),
  ('FANUC', 100, '01', 140),
  ('FANUC', 100, '02', 150),
  ('FANUC', 100, '03', 160),
  ('FANUC', 150, '01', 170),
  ('FANUC', 150, '02', 180),
  ('FANUC', 250, '01', 190),
  ('FANUC', 300, '01', 200),
  ('FANUC', 350, '01', 210),
  ('FANUC', 450, '01', 220)
ON CONFLICT (machine_type, size_ton, mc_no) DO NOTHING;

-- Add optional machine assignment and scheduled_date to production_orders
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS machine_id uuid REFERENCES machines(id);
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS scheduled_date date;
