/*
# Create delete_log table

1. New Tables
- `delete_log`
  - `id` (uuid, primary key)
  - `table_name` (text, not null) — which table the record was deleted from
  - `record_id` (uuid, not null) — the id of the deleted record
  - `order_id` (text, nullable) — the human-readable order_id (for production_orders)
  - `deleted_by` (text, not null) — username of the person who deleted the record
  - `deleted_at` (timestamptz, default now()) — when the deletion happened
  - `snapshot` (jsonb, nullable) — JSON snapshot of key fields from the deleted record
2. Security
- Enable RLS on `delete_log`.
- Allow authenticated users to read and insert (append-only audit log).
- No update or delete policies — audit entries are immutable.
3. Indexes
- Index on `deleted_at` DESC for chronological queries.
- Index on `table_name` for filtering by table.
*/

CREATE TABLE IF NOT EXISTS delete_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  text NOT NULL,
  record_id   uuid NOT NULL,
  order_id    text,
  deleted_by  text NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  snapshot    jsonb
);

ALTER TABLE delete_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_delete_log" ON delete_log;
CREATE POLICY "select_delete_log" ON delete_log FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_delete_log" ON delete_log;
CREATE POLICY "insert_delete_log" ON delete_log FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_delete_log_deleted_at ON delete_log (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_delete_log_table_name ON delete_log (table_name);
