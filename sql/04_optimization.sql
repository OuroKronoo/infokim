-- ============================================================================
-- Criterion 5 - Query optimization (indexing + EXPLAIN).
-- Query: General Expenses totals per project for a date range (Boss/Accountant report).
-- ============================================================================
USE rsci_sql;

-- BEFORE: no index on expense_date. Expect type=ALL or type=index on the foreign-key index
-- (both examine every row, ~100,000) with Extra=Using where.
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


-- ============================================================================
-- MORE FOR CRITERION 5 - every technique the evaluation form lists, in SQL:
--   indexing ............. above (covering composite index)
--   EXPLAIN / ANALYZE .... above, and section 4 below for real timings
--   query rewriting ...... above (YEAR()/MONTH() -> BETWEEN), and section 2 below
--   efficient joins ...... section 3 below
--   partitioning ......... section 5 below
-- Run the index from the first part of this file before sections 2-5 (or drop it to compare).
-- ============================================================================

-- 2) QUERY REWRITING: same answer, one shape can use the index and the other cannot.
--    SLOW: a function on the column. MySQL must compute YEAR()/MONTH() for every row.
EXPLAIN SELECT SUM(amount) FROM expenses WHERE YEAR(expense_date) = 2026 AND MONTH(expense_date) = 3;
--    FAST: compare the bare column with a range, so the index can be searched.
EXPLAIN SELECT SUM(amount) FROM expenses WHERE expense_date >= '2026-03-01' AND expense_date < '2026-04-01';

-- 3) EFFICIENT JOINS. Goal: expense total per project NAME for March 2026.
--    SLOW shape: a correlated subquery runs once for every project row.
EXPLAIN
SELECT p.company, p.name,
       (SELECT SUM(e.amount) FROM expenses e
         WHERE e.project_id = p.id AND e.expense_date BETWEEN '2026-03-01' AND '2026-03-31') AS total
FROM projects p;
--    FAST shape: aggregate the big table once (using the index), then JOIN the few summary rows to
--    projects by its primary key. Join on indexed columns only, and select only the columns you need.
EXPLAIN
SELECT p.company, p.name, s.entries, s.total
FROM (SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
        FROM expenses
       WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
       GROUP BY project_id) AS s
JOIN projects p ON p.id = s.project_id;

-- 4) REAL TIMINGS (EXPLAIN only predicts; these RUN the query and report what happened).
--    MariaDB / XAMPP:      ANALYZE SELECT ...
--    MySQL 8.0.18+:        EXPLAIN ANALYZE SELECT ...
ANALYZE SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
FROM expenses
WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY project_id;
--    The same query for MySQL 8.0.18+ (not valid on MariaDB, so it stays a comment):
-- EXPLAIN ANALYZE
-- SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
-- FROM expenses
-- WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
-- GROUP BY project_id;
--    Read the output: "actual time" and "rows" are measured; "rows" in a plain EXPLAIN is only an estimate.

-- 5) PARTITIONING: split the big table by year so a query for one month reads only that year's partition
--    ("partition pruning"). A partitioned InnoDB table cannot have foreign keys, and the partition column
--    must be part of the primary key, which is why this is a demo copy and not the live expenses table.
DROP TABLE IF EXISTS expenses_part;
CREATE TABLE expenses_part (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id   INT UNSIGNED NOT NULL,
  po_id        INT UNSIGNED NULL,
  category     VARCHAR(40)  NOT NULL,
  description  VARCHAR(200) NULL,
  amount       DECIMAL(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  created_by   INT UNSIGNED NOT NULL,
  PRIMARY KEY (id, expense_date)
) ENGINE=InnoDB
PARTITION BY RANGE (YEAR(expense_date)) (
  PARTITION p2025 VALUES LESS THAN (2026),
  PARTITION p2026 VALUES LESS THAN (2027),
  PARTITION pmax  VALUES LESS THAN MAXVALUE
);
INSERT INTO expenses_part SELECT * FROM expenses;
--    The "partitions" column should list only p2026 (the other years are skipped).
--    MariaDB: EXPLAIN PARTITIONS ...      MySQL 8: plain EXPLAIN already shows the partitions column.
EXPLAIN PARTITIONS
SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
FROM expenses_part
WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY project_id;
--    Rows per partition:
SELECT PARTITION_NAME, TABLE_ROWS
FROM information_schema.PARTITIONS
WHERE TABLE_SCHEMA = 'rsci_sql' AND TABLE_NAME = 'expenses_part';
-- Clean up:  DROP TABLE expenses_part;
