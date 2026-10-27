/*
# Fix delete_log RLS policies to allow anon access

The app uses a custom auth system (verify_login RPC), not Supabase Auth sessions.
The frontend client always runs as the `anon` role, so policies scoped to
`authenticated` only silently block all inserts. This migration widens the
policies to include `anon`.

1. Security changes
- SELECT policy: `TO anon, authenticated` (audit log is readable by all app users)
- INSERT policy: `TO anon, authenticated` (any app user can append audit entries)
- No UPDATE or DELETE policies — entries remain immutable.
*/

DROP POLICY IF EXISTS "select_delete_log" ON delete_log;
CREATE POLICY "select_delete_log" ON delete_log FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "insert_delete_log" ON delete_log;
CREATE POLICY "insert_delete_log" ON delete_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);
