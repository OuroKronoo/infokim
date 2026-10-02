-- ============================================================================
-- Criterion 4 - users, GRANT, least privilege.
-- The Express server opens a connection AS the DB user matching the logged-in
-- role, so these grants are what actually enforce access (not just app code).
-- __PW__ is replaced by scripts/setup-db.js with DB_ROLE_PASSWORD.
-- One object per GRANT, no CREATE ROLE: runs on MySQL 8 and MariaDB 10.4.
-- ============================================================================
USE rsci_sql;

DROP USER IF EXISTS 'rsci_auth'@'%';
DROP USER IF EXISTS 'rsci_engineer'@'%';
DROP USER IF EXISTS 'rsci_boss'@'%';
DROP USER IF EXISTS 'rsci_om'@'%';
DROP USER IF EXISTS 'rsci_po_officer'@'%';
DROP USER IF EXISTS 'rsci_accountant'@'%';
DROP USER IF EXISTS 'rsci_inventory'@'%';

CREATE USER 'rsci_auth'@'%'       IDENTIFIED BY '__PW__';
CREATE USER 'rsci_engineer'@'%'   IDENTIFIED BY '__PW__';
CREATE USER 'rsci_boss'@'%'       IDENTIFIED BY '__PW__';
CREATE USER 'rsci_om'@'%'         IDENTIFIED BY '__PW__';
CREATE USER 'rsci_po_officer'@'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_accountant'@'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_inventory'@'%'  IDENTIFIED BY '__PW__';

-- ---- AUTH: login lookup only. The only account that can read password_hash.
GRANT SELECT (id, name, email, role, password_hash) ON rsci_sql.users TO 'rsci_auth'@'%';

-- Every role may file a ticket (INSERT on tickets + ticket_items), as in the live system.
-- ---- ENGINEER: files requests; reads vendors WITHOUT the encrypted TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users        TO 'rsci_engineer'@'%';
GRANT SELECT                         ON rsci_sql.projects     TO 'rsci_engineer'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.tickets      TO 'rsci_engineer'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.ticket_items TO 'rsci_engineer'@'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_engineer'@'%';
GRANT SELECT (id, name, contact)     ON rsci_sql.vendors      TO 'rsci_engineer'@'%';
GRANT INSERT                         ON rsci_sql.activity_log TO 'rsci_engineer'@'%';

-- ---- BOSS: approves requests and P.O.s, sees everything financial. No DELETE anywhere.
GRANT SELECT (id, name, email, role) ON rsci_sql.users           TO 'rsci_boss'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.projects        TO 'rsci_boss'@'%';
GRANT SELECT, INSERT ON rsci_sql.tickets TO 'rsci_boss'@'%';
GRANT SELECT, INSERT ON rsci_sql.ticket_items TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.purchase_orders TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.po_items        TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.vendors         TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.payments        TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.expenses        TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.inventory       TO 'rsci_boss'@'%';
GRANT SELECT                         ON rsci_sql.inventory_log   TO 'rsci_boss'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.activity_log    TO 'rsci_boss'@'%';
GRANT UPDATE (status, decided_by, reject_reason) ON rsci_sql.tickets TO 'rsci_boss'@'%';
GRANT UPDATE (status, decided_by)    ON rsci_sql.purchase_orders TO 'rsci_boss'@'%';

-- ---- OM: same P.O. sign-off, read-only elsewhere; no payments, no TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users           TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.projects        TO 'rsci_om'@'%';
GRANT SELECT, INSERT ON rsci_sql.tickets TO 'rsci_om'@'%';
GRANT SELECT, INSERT ON rsci_sql.ticket_items TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.purchase_orders TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.po_items        TO 'rsci_om'@'%';
GRANT SELECT (id, name, contact)     ON rsci_sql.vendors         TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.expenses        TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.inventory       TO 'rsci_om'@'%';
GRANT SELECT                         ON rsci_sql.inventory_log   TO 'rsci_om'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.activity_log    TO 'rsci_om'@'%';
GRANT UPDATE (status, decided_by)    ON rsci_sql.purchase_orders TO 'rsci_om'@'%';

-- ---- PO OFFICER: creates P.O.s and vendors; can only flip a ticket's status.
GRANT SELECT (id, name, email, role) ON rsci_sql.users           TO 'rsci_po_officer'@'%';
GRANT SELECT                         ON rsci_sql.projects        TO 'rsci_po_officer'@'%';
GRANT SELECT, INSERT ON rsci_sql.tickets TO 'rsci_po_officer'@'%';
GRANT SELECT, INSERT ON rsci_sql.ticket_items TO 'rsci_po_officer'@'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_po_officer'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.vendors         TO 'rsci_po_officer'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.purchase_orders TO 'rsci_po_officer'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.po_items        TO 'rsci_po_officer'@'%';
GRANT UPDATE (status)                ON rsci_sql.tickets         TO 'rsci_po_officer'@'%';
GRANT INSERT                         ON rsci_sql.activity_log    TO 'rsci_po_officer'@'%';

-- ---- ACCOUNTANT: records payment and posts to expenses. Cannot approve anything.
GRANT SELECT (id, name, email, role) ON rsci_sql.users           TO 'rsci_accountant'@'%';
GRANT SELECT                         ON rsci_sql.projects        TO 'rsci_accountant'@'%';
GRANT SELECT, INSERT ON rsci_sql.tickets TO 'rsci_accountant'@'%';
GRANT SELECT, INSERT ON rsci_sql.ticket_items TO 'rsci_accountant'@'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_accountant'@'%';
GRANT SELECT                         ON rsci_sql.purchase_orders TO 'rsci_accountant'@'%';
GRANT SELECT                         ON rsci_sql.po_items        TO 'rsci_accountant'@'%';
GRANT SELECT                         ON rsci_sql.vendors         TO 'rsci_accountant'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.payments        TO 'rsci_accountant'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.expenses        TO 'rsci_accountant'@'%';
GRANT UPDATE (status)                ON rsci_sql.purchase_orders TO 'rsci_accountant'@'%';
GRANT INSERT                         ON rsci_sql.activity_log    TO 'rsci_accountant'@'%';

-- ---- INVENTORY: receives deliveries and moves stock. No payments, no TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users           TO 'rsci_inventory'@'%';
GRANT SELECT                         ON rsci_sql.projects        TO 'rsci_inventory'@'%';
GRANT SELECT, INSERT ON rsci_sql.tickets TO 'rsci_inventory'@'%';
GRANT SELECT, INSERT ON rsci_sql.ticket_items TO 'rsci_inventory'@'%';
GRANT SELECT                         ON rsci_sql.purchase_orders TO 'rsci_inventory'@'%';
GRANT SELECT                         ON rsci_sql.po_items        TO 'rsci_inventory'@'%';
GRANT SELECT (id, name, contact)     ON rsci_sql.vendors         TO 'rsci_inventory'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.inventory       TO 'rsci_inventory'@'%';
GRANT UPDATE (qty_on_hand)           ON rsci_sql.inventory       TO 'rsci_inventory'@'%';
GRANT SELECT, INSERT                 ON rsci_sql.inventory_log   TO 'rsci_inventory'@'%';
GRANT UPDATE (status)                ON rsci_sql.purchase_orders TO 'rsci_inventory'@'%';
GRANT UPDATE (status)                ON rsci_sql.tickets         TO 'rsci_inventory'@'%';
GRANT INSERT                         ON rsci_sql.activity_log    TO 'rsci_inventory'@'%';


-- Editing a rejected ticket goes through a stored procedure (checks owner + status inside),
-- so submitters need no UPDATE/DELETE on tickets or ticket_items.
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_engineer'@'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_boss'@'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_om'@'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_po_officer'@'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_accountant'@'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_inventory'@'%';

FLUSH PRIVILEGES;
