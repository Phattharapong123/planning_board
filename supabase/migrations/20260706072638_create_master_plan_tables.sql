/*
# Create Master Plan Tables

## Summary
Creates three normalized tables for the Master Plan module:
- master_plans: core plan metadata (unc_code, part_name, planner, customer, etc.)
- master_plan_parameters: unlimited dynamic key-value parameters per plan (Stock Max, Stock Min, etc.)
- master_plan_daily: daily planning grid with forecast, stock, plan, actual columns

## New Tables

### master_plans
Stores one row per master plan.
- id (uuid PK)
- unc_code (text) – UNC part code
- part_name (text)
- planner (text) – planner name
- customer (text)
- size_ton (numeric, nullable)
- cycle_time (numeric, nullable) – cycle time in seconds per piece
- plan_cavity (integer) – number of cavities
- plan_type (text) – 'White', 'Yellow', or 'Blue'
- status (text) – 'Active' or 'Inactive'
- created_at, updated_at (timestamptz)

### master_plan_parameters
Stores unlimited key-value parameters per plan.
- id (uuid PK)
- master_plan_id (uuid FK → master_plans.id)
- parameter_name (text) – e.g. 'Stock Max', 'Stock Min', 'Current Stock', 'Safety Stock'
- parameter_value (numeric, nullable)
- display_order (integer) – for consistent display ordering
- created_at (timestamptz)
Unique constraint on (master_plan_id, parameter_name).

### master_plan_daily
Stores one row per (plan, date) for the planning grid.
- id (uuid PK)
- master_plan_id (uuid FK → master_plans.id)
- date (date)
- forecast (numeric DEFAULT 0)
- stock (numeric, nullable) – stored result of calculation
- plan (numeric DEFAULT 0) – production plan quantity
- actual (numeric DEFAULT 0)
Unique constraint on (master_plan_id, date).

## Security
RLS enabled on all three tables. Using anon + authenticated policies since the app
uses a custom username/password auth system (not Supabase auth). Application-layer
access control restricts which users can navigate to this module.

## Notes
1. No user_id columns needed – access is controlled at the application layer.
2. master_plan_parameters uses a unique constraint to prevent duplicate parameter names per plan.
3. ON DELETE CASCADE ensures child rows are removed when a master plan is deleted.
*/

-- ── master_plans ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_plans (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unc_code     text        NOT NULL,
  part_name    text        NOT NULL,
  planner      text        NOT NULL,
  customer     text        NOT NULL DEFAULT '',
  size_ton     numeric,
  cycle_time   numeric,
  plan_cavity  integer     NOT NULL DEFAULT 1,
  plan_type    text        NOT NULL DEFAULT 'White',
  status       text        NOT NULL DEFAULT 'Active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE master_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mp_select" ON master_plans;
CREATE POLICY "mp_select" ON master_plans FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mp_insert" ON master_plans;
CREATE POLICY "mp_insert" ON master_plans FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mp_update" ON master_plans;
CREATE POLICY "mp_update" ON master_plans FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mp_delete" ON master_plans;
CREATE POLICY "mp_delete" ON master_plans FOR DELETE TO anon, authenticated USING (true);

-- ── master_plan_parameters ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_plan_parameters (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  master_plan_id   uuid        NOT NULL REFERENCES master_plans(id) ON DELETE CASCADE,
  parameter_name   text        NOT NULL,
  parameter_value  numeric,
  display_order    integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mp_param UNIQUE (master_plan_id, parameter_name)
);

CREATE INDEX IF NOT EXISTS idx_mpp_plan_id ON master_plan_parameters(master_plan_id);

ALTER TABLE master_plan_parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mpp_select" ON master_plan_parameters;
CREATE POLICY "mpp_select" ON master_plan_parameters FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mpp_insert" ON master_plan_parameters;
CREATE POLICY "mpp_insert" ON master_plan_parameters FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mpp_update" ON master_plan_parameters;
CREATE POLICY "mpp_update" ON master_plan_parameters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mpp_delete" ON master_plan_parameters;
CREATE POLICY "mpp_delete" ON master_plan_parameters FOR DELETE TO anon, authenticated USING (true);

-- ── master_plan_daily ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_plan_daily (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  master_plan_id   uuid        NOT NULL REFERENCES master_plans(id) ON DELETE CASCADE,
  date             date        NOT NULL,
  forecast         numeric     NOT NULL DEFAULT 0,
  stock            numeric,
  plan             numeric     NOT NULL DEFAULT 0,
  actual           numeric     NOT NULL DEFAULT 0,
  CONSTRAINT uq_mpd_plan_date UNIQUE (master_plan_id, date)
);

CREATE INDEX IF NOT EXISTS idx_mpd_plan_id      ON master_plan_daily(master_plan_id);
CREATE INDEX IF NOT EXISTS idx_mpd_plan_date    ON master_plan_daily(master_plan_id, date);

ALTER TABLE master_plan_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mpd_select" ON master_plan_daily;
CREATE POLICY "mpd_select" ON master_plan_daily FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "mpd_insert" ON master_plan_daily;
CREATE POLICY "mpd_insert" ON master_plan_daily FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "mpd_update" ON master_plan_daily;
CREATE POLICY "mpd_update" ON master_plan_daily FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "mpd_delete" ON master_plan_daily;
CREATE POLICY "mpd_delete" ON master_plan_daily FOR DELETE TO anon, authenticated USING (true);
