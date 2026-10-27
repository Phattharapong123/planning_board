-- Switch verify_login to use password_plain comparison (no pgcrypto/crypt dependency)
-- Works for all users who have password_plain set.
-- Users with password_plain IS NULL must have their password reset by admin.
CREATE OR REPLACE FUNCTION verify_login(p_username TEXT, p_password TEXT)
RETURNS TABLE(id UUID, username TEXT, role TEXT, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.username, u.role::TEXT, u.display_name
  FROM app_users u
  WHERE u.username = p_username
    AND u.password_plain = p_password;
END;
$$;

GRANT EXECUTE ON FUNCTION verify_login(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_login(TEXT, TEXT) TO authenticated;
