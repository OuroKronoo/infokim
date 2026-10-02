-- ============================================================================
-- Criterion 5 - Query optimization (indexing + EXPLAIN).
-- Query: General Expenses totals per project for a date range (Boss/Accountant report).
-- ============================================================================
USE rsci_sql;

-- BEFORE: no index on expense_date -> expect type=ALL (full table scan, ~100k rows).
EXPLAIN
SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
FROM expenses
WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY project_id;
-- MySQL 8.0.18+: use  EXPLAIN ANALYZE  instead for real timings.
-- MariaDB:       use  ANALYZE <query>  instead.

-- FIX: composite COVERING index. Range column first, then the grouped and summed
-- columns, so the query is answered from the index alone.
CREATE INDEX idx_expenses_date_proj_amt ON expenses (expense_date, project_id, amount);

-- AFTER: expect type=range, key=idx_expenses_date_proj_amt, Extra=Using index,
-- and rows examined dropping from ~100,000 to the ~5% inside the month.
EXPLAIN
SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
FROM expenses
WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY project_id;

-- Anti-pattern for contrast: wrapping the column in a function defeats the index.
EXPLAIN
SELECT project_id, SUM(amount)
FROM expenses
WHERE YEAR(expense_date) = 2026 AND MONTH(expense_date) = 3     -- not sargable
GROUP BY project_id;

-- To reset the demo:
-- DROP INDEX idx_expenses_date_proj_amt ON expenses;
