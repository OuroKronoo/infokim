-- ============================================================================
-- Criterion 4 - real MySQL ROLE objects (CREATE ROLE / GRANT role TO user / REVOKE).
-- Run as root in phpMyAdmin or Workbench. Safe to re-run; the clean-up is at the bottom.
--
-- Two ways to organise privileges, and this project uses both:
--   * one account per role (sql/02_roles.sql) - the app logs in as rsci_<role>
--   * a ROLE object: privileges are granted ONCE to the role, then the role is granted to many users.
--     Change the role and every member changes with it.
--
-- Syntax note: CREATE ROLE and GRANT role TO user work on MariaDB 10.4 (XAMPP) and MySQL 8.
-- Only SET DEFAULT ROLE differs (MariaDB: ... FOR user, MySQL 8: ... TO user).
-- ============================================================================
USE rsci_sql;

-- 1) Create the role and give it privileges (least privilege: read two tables only).
CREATE ROLE IF NOT EXISTS r_site_viewer;
GRANT SELECT ON rsci_sql.projects  TO r_site_viewer;
GRANT SELECT ON rsci_sql.inventory TO r_site_viewer;

-- 2) Create a user and give it the role.
CREATE USER IF NOT EXISTS 'demo_viewer'@'localhost' IDENTIFIED BY 'Demo#Viewer2026';
GRANT r_site_viewer TO 'demo_viewer'@'localhost';
SET DEFAULT ROLE r_site_viewer FOR 'demo_viewer'@'localhost';      -- MariaDB
-- SET DEFAULT ROLE r_site_viewer TO 'demo_viewer'@'localhost';     -- MySQL 8 (use this line instead)

-- 3) See what was granted.
SHOW GRANTS FOR r_site_viewer;
SHOW GRANTS FOR 'demo_viewer'@'localhost';

-- 4) Test from a terminal:  mysql -u demo_viewer -pDemo#Viewer2026 rsci_sql
--      SELECT * FROM inventory;      -> works
--      SELECT * FROM vendors;        -> ERROR 1142 SELECT command denied  (not granted)
--      DELETE FROM inventory;        -> ERROR 1142 DELETE command denied   (least privilege)

-- 5) REVOKE from the role: every member loses it immediately.
REVOKE SELECT ON rsci_sql.inventory FROM r_site_viewer;
SHOW GRANTS FOR r_site_viewer;

-- 6) Clean up.
-- DROP USER 'demo_viewer'@'localhost';
-- DROP ROLE r_site_viewer;
