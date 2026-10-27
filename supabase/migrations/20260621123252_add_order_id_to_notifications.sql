ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL;
