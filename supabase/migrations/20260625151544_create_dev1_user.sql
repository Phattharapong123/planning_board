-- Create Dev1 user (developer role) — earliest timestamp so it sorts to top
INSERT INTO app_users (username, password_hash, password_plain, role, display_name, created_at)
VALUES (
  'Dev1',
  crypt('159753', gen_salt('bf')),
  '159753',
  'developer',
  'Developer',
  '2020-01-01 00:00:00+00'
)
ON CONFLICT (username) DO NOTHING;
