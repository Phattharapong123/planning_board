-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- User roles enum
CREATE TYPE user_role AS ENUM ('admin', 'machine_planner', 'planner', 'viewer');

-- Application users table
CREATE TABLE app_users (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role         user_role NOT NULL,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

-- Public cannot read app_users directly (login is via RPC function below)
CREATE POLICY "deny_direct_select" ON app_users FOR SELECT TO anon USING (false);
CREATE POLICY "deny_direct_select_auth" ON app_users FOR SELECT TO authenticated USING (false);

-- Secure login function — runs as DB owner, bypasses RLS
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS TABLE(id UUID, username TEXT, role TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username, u.role::TEXT, u.display_name
  FROM app_users u
  WHERE u.username = p_username
    AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$;

-- Seed sample users for each role
INSERT INTO app_users (username, password_hash, role, display_name) VALUES
  ('admin',    crypt('Admin@1234',   gen_salt('bf')), 'admin',          'Administrator'),
  ('mplanner', crypt('MPlan@1234',   gen_salt('bf')), 'machine_planner','Machine Planner'),
  ('planner',  crypt('Plan@1234',    gen_salt('bf')), 'planner',        'Planner'),
  ('viewer',   crypt('View@1234',    gen_salt('bf')), 'viewer',         'Viewer');
