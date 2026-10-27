ALTER TABLE production_orders
ADD COLUMN IF NOT EXISTS plan_issue_date date;
