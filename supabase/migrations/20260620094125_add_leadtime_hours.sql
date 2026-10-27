-- Add separate leadtime_hours column (keeping existing leadtime column as leadtime_days)
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS leadtime_hours integer;
-- Rename conceptually: existing leadtime column will now represent days; no drop/rename to preserve data
