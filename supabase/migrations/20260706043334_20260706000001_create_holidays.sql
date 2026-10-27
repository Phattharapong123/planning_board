/*
# Create holidays table

1. New Tables
- `holidays`
  - `id` (uuid, primary key)
  - `date` (date, unique — one entry per calendar date)
  - `name` (text, optional holiday label)
  - `created_by` (text, username who added the holiday)
  - `created_at` (timestamptz, auto-set)

2. Security
- Enable RLS on `holidays`.
- Allow anon + authenticated full CRUD — the app uses its own role system
  (not Supabase auth), so all frontend requests run as the anon role.
  Role-based access is enforced in the UI layer.
*/

CREATE TABLE IF NOT EXISTS holidays (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date       date        NOT NULL UNIQUE,
  name       text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_holidays" ON holidays;
CREATE POLICY "anon_select_holidays" ON holidays FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_holidays" ON holidays;
CREATE POLICY "anon_insert_holidays" ON holidays FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_holidays" ON holidays;
CREATE POLICY "anon_update_holidays" ON holidays FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_holidays" ON holidays;
CREATE POLICY "anon_delete_holidays" ON holidays FOR DELETE
  TO anon, authenticated USING (true);
