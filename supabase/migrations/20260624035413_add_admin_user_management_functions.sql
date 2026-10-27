-- Admin function to upsert a user (create or update password)
CREATE OR REPLACE FUNCTION admin_upsert_user(
  p_username    TEXT,
  p_password    TEXT,
  p_role        user_role,
  p_display_name TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO app_users (username, password_hash, role, display_name)
  VALUES (p_username, crypt(p_password, gen_salt('bf')), p_role, p_display_name)
  ON CONFLICT (username) DO UPDATE
    SET password_hash = CASE WHEN p_password = '' THEN app_users.password_hash ELSE crypt(p_password, gen_salt('bf')) END,
        role          = p_role,
        display_name  = p_display_name;
END;
$$;

-- Admin function to delete a user
CREATE OR REPLACE FUNCTION admin_delete_user(p_username TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM app_users WHERE username = p_username;
END;
$$;
