ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS is_finished BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_production_orders_is_finished ON production_orders(is_finished);
