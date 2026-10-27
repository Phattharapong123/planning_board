-- Add plan status and creator tracking to production_orders
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS is_planned  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by  TEXT;

-- Notifications table (anon access — security enforced at app layer)
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  for_username TEXT NOT NULL,
  order_ref    TEXT NOT NULL,
  message      TEXT NOT NULL,
  edited_by    TEXT NOT NULL,
  is_read      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_for_user ON notifications (for_username, is_read, created_at DESC);
