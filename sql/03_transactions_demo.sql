-- ============================================================================
-- Criterion 2 - Transaction management, runnable by hand in phpMyAdmin / Workbench.
-- The app runs the same pattern in server/routes/purchaseOrders.js.
-- Prerequisite: `npm run setup-db` (seed: tickets 3 and 4 are 'Approved for PO',
-- user 4 is the PO Officer, vendor 1 exists).
-- ============================================================================
USE rsci_sql;
-- A) COMMIT: create a P.O. for ticket 3 - all steps succeed together.
START TRANSACTION;
UPDATE tickets
SET status = 'PO Created'
WHERE id = 3
  AND status = 'Approved for PO';
INSERT INTO purchase_orders (po_no, ticket_id, vendor_id, created_by, total)
VALUES ('PO-DEMO-001', 3, 1, 4, 1500.00);
SET @po := LAST_INSERT_ID();
INSERT INTO po_items (po_id, description, qty, unit, unit_price)
VALUES (@po, 'Cement 40kg', 10, 'bag', 150.00);
COMMIT;
-- B) ROLLBACK: the P.O. number already exists, so step 2 fails and step 1 is undone.
START TRANSACTION;
UPDATE tickets
SET status = 'PO Created'
WHERE id = 4
  AND status = 'Approved for PO';
INSERT INTO purchase_orders (po_no, ticket_id, vendor_id, created_by, total)
VALUES ('PO-DEMO-001', 4, 1, 4, 99.00);
-- ERROR 1062 duplicate entry
ROLLBACK;
SELECT id,
  status
FROM tickets
WHERE id = 4;
-- still 'Approved for PO' (atomicity)
-- C) Isolation: run in two sessions. The guarded UPDATE takes a row lock, so a second
--    approver waits, then sees 0 rows affected and cannot approve twice.
--    Session 1: START TRANSACTION;
--               UPDATE purchase_orders SET status='Approved' WHERE id=1 AND status='Pending Approval';
--    Session 2: UPDATE purchase_orders SET status='Rejected' WHERE id=1 AND status='Pending Approval';  -- waits
--    Session 1: COMMIT;   -- Session 2 resumes: 0 rows affected
-- D) Stock out never goes below zero: the guard is in the WHERE clause.
--    Item 1 (Cement 40kg) has 120 bags after `npm run setup-db`.
START TRANSACTION;
  UPDATE inventory SET qty_on_hand = qty_on_hand - 30 WHERE id = 1 AND qty_on_hand >= 30;   -- 1 row affected
  INSERT INTO inventory_log (inventory_id, project_id, change_qty, reason, created_by)
  VALUES (1, 1, -30, 'Released to site', 6);
COMMIT;

START TRANSACTION;
  UPDATE inventory SET qty_on_hand = qty_on_hand - 99999 WHERE id = 1 AND qty_on_hand >= 99999;  -- 0 rows affected
ROLLBACK;                                      -- nothing changed, no log row written
SELECT id, item_name, qty_on_hand FROM inventory WHERE id = 1;

-- E) Edit and resubmit a rejected ticket goes through a stored procedure (SQL SECURITY DEFINER),
--    so submitters need no UPDATE or DELETE on tickets/ticket_items.
--    First reject ticket 1 as the Boss, then resubmit as its owner (user 3):
UPDATE tickets SET status = 'Rejected by Boss', decided_by = 1, reject_reason = 'Quantity too high'
WHERE id = 1 AND status = 'Pending Boss Approval';

START TRANSACTION;
  CALL resubmit_ticket(1, 3, 1, 'normal', '2026-12-01', 'Corrected quantities');
  INSERT INTO ticket_items (ticket_id, description, qty, unit) VALUES (1, 'Cement 40kg', 20, 'bag');
COMMIT;
SELECT id, status, resubmit_count, reject_reason FROM tickets WHERE id = 1;

-- Someone else (user 7) trying the same call is refused inside the procedure:
-- CALL resubmit_ticket(1, 7, 1, 'normal', '2026-12-01', 'x');   -- ERROR 1644 Only the submitter ...
