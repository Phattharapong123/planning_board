-- Fix verify_login: explicit search_path + grant to anon
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS TABLE(id UUID, username TEXT, role TEXT, display_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username, u.role::TEXT, u.display_name
  FROM app_users u
  WHERE u.username = p_username
    AND u.password_hash = crypt(p_password, u.password_hash);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_login(TEXT, TEXT) TO authenticated;
