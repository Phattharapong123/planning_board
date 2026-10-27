-- Add plain password column for admin visibility
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_plain TEXT;

-- Update existing seed users with their plain passwords
UPDATE app_users SET password_plain = 'Admin@1234'  WHERE username = 'admin'    AND password_plain IS NULL;
UPDATE app_users SET password_plain = 'MPlan@1234'  WHERE username = 'mplanner' AND password_plain IS NULL;
UPDATE app_users SET password_plain = 'Plan@1234'   WHERE username = 'planner'  AND password_plain IS NULL;
UPDATE app_users SET password_plain = 'View@1234'   WHERE username = 'viewer'   AND password_plain IS NULL;

-- Update admin_upsert_user to also store plain password
CREATE OR REPLACE FUNCTION admin_upsert_user(
  p_username     TEXT,
  p_password     TEXT,
  p_role         user_role,
  p_display_name TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO app_users (username, password_hash, password_plain, role, display_name)
  VALUES (p_username, crypt(p_password, gen_salt('bf')), NULLIF(p_password, ''), p_role, p_display_name)
  ON CONFLICT (username) DO UPDATE
    SET password_hash  = CASE WHEN p_password = '' THEN app_users.password_hash  ELSE crypt(p_password, gen_salt('bf')) END,
        password_plain = CASE WHEN p_password = '' THEN app_users.password_plain ELSE p_password END,
        role           = p_role,
        display_name   = p_display_name;
END;
$$;

-- Admin function to list all users (bypasses RLS)
CREATE OR REPLACE FUNCTION admin_list_users()
RETURNS TABLE(
  id            UUID,
  username      TEXT,
  display_name  TEXT,
  role          TEXT,
  password_plain TEXT,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username, u.display_name, u.role::TEXT, u.password_plain, u.created_at
  FROM app_users u
  ORDER BY u.created_at;
END;
$$;
