/*
# Add UNC Code 2, 3, 4 to master_plans

1. Modified Tables
   - `master_plans`
     - `unc_code_2` (text, nullable) — optional second UNC code linked to this master plan
     - `unc_code_3` (text, nullable) — optional third UNC code
     - `unc_code_4` (text, nullable) — optional fourth UNC code
2. Notes
   - All new columns are nullable so existing rows are unaffected.
   - These codes are used to look up production orders on the Board that should
     contribute to this master plan's daily "Board" production quantity.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'master_plans' AND column_name = 'unc_code_2') THEN
    ALTER TABLE master_plans ADD COLUMN unc_code_2 text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'master_plans' AND column_name = 'unc_code_3') THEN
    ALTER TABLE master_plans ADD COLUMN unc_code_3 text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'master_plans' AND column_name = 'unc_code_4') THEN
    ALTER TABLE master_plans ADD COLUMN unc_code_4 text;
  END IF;
END $$;
