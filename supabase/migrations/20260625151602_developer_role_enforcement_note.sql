-- The role enforcement will be done in the frontend, not the DB function,
-- since there's no session-based caller check in the current auth model.
-- The function stays as-is; the UI will prevent non-developers from selecting 'developer' role.
SELECT 1;
