
/*
# Create Production Orders Table

## Summary
Creates the core table for the Production Board System.

## New Tables

### production_orders
Stores each production order entry with the following columns:
- `id` (uuid, primary key) — internal unique identifier
- `order_id` (text, unique) — human-readable ID in format PL1-000001, auto-generated from a sequence
- `unc_code_1..4` (text) — up to 4 UNC Code values
- `qty_1..4` (numeric) — up to 4 QTY values paired with UNC Codes
- `size_ton` (numeric) — Size in Ton
- `leadtime` (integer) — Lead time (days)
- `due_date` (date) — Due Date
- `remark` (text) — Remark/notes
- `plan_type` (text) — 'White' or 'Yellow', defaults to 'White'
- `urgent` (boolean) — Whether the order is urgent, defaults to false
- `created_at` (timestamptz) — Creation timestamp

## Security
- RLS enabled; anon + authenticated users can CRUD (single-tenant, no sign-in required)

## Notes
1. A sequence `production_order_seq` drives the auto-incrementing numeric portion.
2. A function `generate_order_id()` formats the sequence value as PL1-000001.
3. `order_id` defaults to `generate_order_id()` so inserts need not supply it.
*/

-- Sequence for order ID numbering
CREATE SEQUENCE IF NOT EXISTS production_order_seq START 1;

-- Function to generate formatted order ID
CREATE OR REPLACE FUNCTION generate_order_id()
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'PL1-' || LPAD(nextval('production_order_seq')::text, 6, '0');
END;
$$;

-- Main table
CREATE TABLE IF NOT EXISTS production_orders (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      text        UNIQUE NOT NULL DEFAULT generate_order_id(),
  unc_code_1    text,
  qty_1         numeric,
  unc_code_2    text,
  qty_2         numeric,
  unc_code_3    text,
  qty_3         numeric,
  unc_code_4    text,
  qty_4         numeric,
  size_ton      numeric,
  leadtime      integer,
  due_date      date,
  remark        text,
  plan_type     text        NOT NULL DEFAULT 'White' CHECK (plan_type IN ('White', 'Yellow')),
  urgent        boolean     NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_production_orders" ON production_orders;
CREATE POLICY "anon_select_production_orders" ON production_orders FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_production_orders" ON production_orders;
CREATE POLICY "anon_insert_production_orders" ON production_orders FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_production_orders" ON production_orders;
CREATE POLICY "anon_update_production_orders" ON production_orders FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_production_orders" ON production_orders;
CREATE POLICY "anon_delete_production_orders" ON production_orders FOR DELETE
  TO anon, authenticated USING (true);
