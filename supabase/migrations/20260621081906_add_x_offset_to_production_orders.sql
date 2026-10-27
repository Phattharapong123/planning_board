ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS x_offset FLOAT;
