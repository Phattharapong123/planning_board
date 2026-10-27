-- Self-service profile update (display name + password)
CREATE OR REPLACE FUNCTION update_own_profile(
  p_username     TEXT,
  p_display_name TEXT DEFAULT NULL,
  p_new_password TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE app_users
  SET
    display_name  = CASE WHEN p_display_name IS NOT NULL AND p_display_name <> ''
                         THEN p_display_name ELSE display_name END,
    password_plain = CASE WHEN p_new_password IS NOT NULL AND p_new_password <> ''
                          THEN p_new_password ELSE password_plain END
  WHERE username = p_username;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION update_own_profile(TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_own_profile(TEXT, TEXT, TEXT) TO authenticated;
