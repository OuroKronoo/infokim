-- ============================================================================
-- Criterion 4 - REVOKE demo. Run as root (phpMyAdmin / Workbench) while the app is
-- running, logged in as the OM, and refresh the Activity Log page between steps.
-- ============================================================================
USE rsci_sql;

SHOW GRANTS FOR 'rsci_om'@'%';

-- 1) Take away the OM's right to read the audit log.
REVOKE SELECT ON rsci_sql.activity_log FROM 'rsci_om'@'%';
--    -> Activity Log page for the OM now fails with "SELECT command denied ... activity_log".

-- 2) Give it back.
GRANT SELECT ON rsci_sql.activity_log TO 'rsci_om'@'%';

-- 3) Column-level revoke: hide the vendor contact column from the PO Officer's reads.
-- REVOKE SELECT (contact) ON rsci_sql.vendors FROM 'rsci_inventory'@'%';
