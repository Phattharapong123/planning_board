-- UNC Parts master list: one row per unique UNC Code 1
CREATE TABLE IF NOT EXISTS unc_parts (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unc_code    text NOT NULL UNIQUE,
  unc_code_2  text,
  unc_code_3  text,
  unc_code_4  text,
  size_ton    integer,
  plan_type   text NOT NULL DEFAULT 'White',
  updated_at  timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE unc_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unc_parts_select" ON unc_parts
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "unc_parts_insert" ON unc_parts
  FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "unc_parts_update" ON unc_parts
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "unc_parts_delete" ON unc_parts
  FOR DELETE TO anon, authenticated USING (true);

-- Pre-populate from existing orders: for each unique unc_code_1,
-- pick the row with the most associated codes, then latest created_at
INSERT INTO unc_parts (unc_code, unc_code_2, unc_code_3, unc_code_4, size_ton, plan_type)
SELECT
  unc_code_1,
  NULLIF(TRIM(COALESCE(unc_code_2,'')), ''),
  NULLIF(TRIM(COALESCE(unc_code_3,'')), ''),
  NULLIF(TRIM(COALESCE(unc_code_4,'')), ''),
  size_ton,
  plan_type
FROM (
  SELECT *,
    ROW_NUMBER() OVER (
      PARTITION BY unc_code_1
      ORDER BY
        (CASE WHEN unc_code_2 IS NOT NULL AND TRIM(unc_code_2) != '' THEN 1 ELSE 0 END +
         CASE WHEN unc_code_3 IS NOT NULL AND TRIM(unc_code_3) != '' THEN 1 ELSE 0 END +
         CASE WHEN unc_code_4 IS NOT NULL AND TRIM(unc_code_4) != '' THEN 1 ELSE 0 END) DESC,
        created_at DESC
    ) AS rn
  FROM production_orders
  WHERE unc_code_1 IS NOT NULL AND TRIM(unc_code_1) != ''
) t
WHERE rn = 1
ON CONFLICT (unc_code) DO NOTHING;
