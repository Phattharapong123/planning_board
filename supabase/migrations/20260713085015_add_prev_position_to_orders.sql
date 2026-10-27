ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS prev_machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prev_slot_index smallint;
