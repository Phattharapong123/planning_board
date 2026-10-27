/*
# Add unc_code, due_date, qty columns to delete_log

The user wants Order ID, UNC Code, Due date, and Qty visible as explicit columns
rather than buried in the JSONB snapshot.

1. New columns
- `unc_code` (text, nullable) — concatenated UNC codes from the deleted order
- `due_date` (date, nullable) — due date of the deleted order
- `qty` (text, nullable) — concatenated quantities from the deleted order
2. No security changes — existing RLS policies remain in effect.
*/

ALTER TABLE delete_log
  ADD COLUMN IF NOT EXISTS unc_code text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS qty text;
