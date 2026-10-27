CREATE TABLE IF NOT EXISTS forecast_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number  integer     NOT NULL,
  updated_by      text        NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  row_count       integer     NOT NULL DEFAULT 0
);

ALTER TABLE forecast_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_forecast_versions"
  ON forecast_versions FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "insert_forecast_versions"
  ON forecast_versions FOR INSERT TO anon, authenticated WITH CHECK (true);
