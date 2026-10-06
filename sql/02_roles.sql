-- ============================================================================
-- Criterion 4 - Authorization and privileges (users, roles, GRANT, REVOKE, least privilege)
--
-- Design: every application role in the `roles` table (sql/01_schema.sql) has its own MySQL
-- ACCOUNT named rsci_<code>. The Express API opens a connection as the account that matches
-- the logged-in person's role (server/db.js poolFor), so MySQL itself decides what is allowed.
--
--   CREATE USER ... IDENTIFIED BY   -> the database users (one per role, plus rsci_auth)
--   GRANT   <privilege> ON <table>   -> what each user may do
--   GRANT   <privilege>(<columns>)   -> column-level grants: a user can touch ONLY those columns
--   REVOKE                           -> take a privilege away again (sql/05_revoke_demo.sql)
--   Least privilege                  -> nobody has DELETE; secrets (tin_enc, check_no_enc, phone_enc,
--                                       password_hash) are visible only to the roles that must see them
--   Real MySQL ROLE objects          -> sql/07_roles_demo.sql
--
-- rsci_auth is the account used by the login and registration pages. It can read the login
-- columns and the role catalogue, INSERT a new user and write the audit log. Nothing else.
-- ============================================================================
USE rsci_sql;
DROP USER IF EXISTS 'rsci_auth' @'%';
DROP USER IF EXISTS 'rsci_engineer' @'%';
DROP USER IF EXISTS 'rsci_boss' @'%';
DROP USER IF EXISTS 'rsci_om' @'%';
DROP USER IF EXISTS 'rsci_po_officer' @'%';
DROP USER IF EXISTS 'rsci_accountant' @'%';
DROP USER IF EXISTS 'rsci_inventory' @'%';
DROP USER IF EXISTS 'rsci_admin' @'%';
CREATE USER 'rsci_auth' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_engineer' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_boss' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_om' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_po_officer' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_accountant' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_inventory' @'%' IDENTIFIED BY '__PW__';
CREATE USER 'rsci_admin' @'%' IDENTIFIED BY '__PW__';
-- ---- AUTH: login lookup only. The only account that can read password_hash.
GRANT SELECT (id, name, email, role, password_hash) ON rsci_sql.users TO 'rsci_auth' @'%';
-- ---- ENGINEER: files requests; reads vendors WITHOUT the encrypted TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_engineer' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_engineer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_engineer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_engineer' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_engineer' @'%';
GRANT SELECT (id, name, contact) ON rsci_sql.vendors TO 'rsci_engineer' @'%';
GRANT INSERT ON rsci_sql.activity_log TO 'rsci_engineer' @'%';
-- ---- BOSS: approves requests and P.O.s, sees everything financial. No DELETE anywhere.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_boss' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.projects TO 'rsci_boss' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_boss' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.purchase_orders TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.po_items TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.vendors TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.payments TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.expenses TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_boss' @'%';
GRANT SELECT ON rsci_sql.inventory_log TO 'rsci_boss' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.activity_log TO 'rsci_boss' @'%';
GRANT UPDATE (status, decided_by, reject_reason) ON rsci_sql.tickets TO 'rsci_boss' @'%';
GRANT UPDATE (status, decided_by) ON rsci_sql.purchase_orders TO 'rsci_boss' @'%';
-- ---- OM: same P.O. sign-off, read-only elsewhere; no payments, no TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_om' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_om' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.purchase_orders TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.po_items TO 'rsci_om' @'%';
GRANT SELECT (id, name, contact) ON rsci_sql.vendors TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.expenses TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_om' @'%';
GRANT SELECT ON rsci_sql.inventory_log TO 'rsci_om' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.activity_log TO 'rsci_om' @'%';
GRANT UPDATE (status, decided_by) ON rsci_sql.purchase_orders TO 'rsci_om' @'%';
-- ---- PO OFFICER: creates P.O.s and vendors; can only flip a ticket's status.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_po_officer' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_po_officer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_po_officer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_po_officer' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_po_officer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.vendors TO 'rsci_po_officer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.purchase_orders TO 'rsci_po_officer' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.po_items TO 'rsci_po_officer' @'%';
GRANT UPDATE (status) ON rsci_sql.tickets TO 'rsci_po_officer' @'%';
GRANT INSERT ON rsci_sql.activity_log TO 'rsci_po_officer' @'%';
-- ---- ACCOUNTANT: records payment and posts to expenses. Cannot approve anything.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_accountant' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_accountant' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_accountant' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_accountant' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_accountant' @'%';
GRANT SELECT ON rsci_sql.purchase_orders TO 'rsci_accountant' @'%';
GRANT SELECT ON rsci_sql.po_items TO 'rsci_accountant' @'%';
GRANT SELECT ON rsci_sql.vendors TO 'rsci_accountant' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.payments TO 'rsci_accountant' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.expenses TO 'rsci_accountant' @'%';
GRANT UPDATE (status) ON rsci_sql.purchase_orders TO 'rsci_accountant' @'%';
GRANT INSERT ON rsci_sql.activity_log TO 'rsci_accountant' @'%';
-- ---- INVENTORY: receives deliveries and moves stock. No payments, no TIN.
GRANT SELECT (id, name, email, role) ON rsci_sql.users TO 'rsci_inventory' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_inventory' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.tickets TO 'rsci_inventory' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.ticket_items TO 'rsci_inventory' @'%';
GRANT SELECT ON rsci_sql.purchase_orders TO 'rsci_inventory' @'%';
GRANT SELECT ON rsci_sql.po_items TO 'rsci_inventory' @'%';
GRANT SELECT (id, name, contact) ON rsci_sql.vendors TO 'rsci_inventory' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.inventory TO 'rsci_inventory' @'%';
GRANT UPDATE (qty_on_hand) ON rsci_sql.inventory TO 'rsci_inventory' @'%';
GRANT SELECT,
    INSERT ON rsci_sql.inventory_log TO 'rsci_inventory' @'%';
GRANT UPDATE (status) ON rsci_sql.purchase_orders TO 'rsci_inventory' @'%';
GRANT UPDATE (status) ON rsci_sql.tickets TO 'rsci_inventory' @'%';
GRANT INSERT ON rsci_sql.activity_log TO 'rsci_inventory' @'%';
-- ---- ADMIN: read-only oversight of every action. No INSERT/UPDATE/DELETE anywhere, and the secret
-- columns (password_hash, phone_enc, tin_enc, check_no_enc) stay hidden: an auditor needs visibility, not secrets.
GRANT SELECT (id, name, email, role, created_at) ON rsci_sql.users TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.projects TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.tickets TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.ticket_items TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.purchase_orders TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.po_items TO 'rsci_admin' @'%';
GRANT SELECT (id, name, contact) ON rsci_sql.vendors TO 'rsci_admin' @'%';
GRANT SELECT (id, po_id, amount, recorded_by, paid_at) ON rsci_sql.payments TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.expenses TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.inventory TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.inventory_log TO 'rsci_admin' @'%';
GRANT SELECT ON rsci_sql.activity_log TO 'rsci_admin' @'%';
-- Editing a rejected ticket goes through a stored procedure (checks owner + status inside),
-- so submitters need no UPDATE/DELETE on tickets or ticket_items.
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_engineer' @'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_boss' @'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_om' @'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_po_officer' @'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_accountant' @'%';
GRANT EXECUTE ON PROCEDURE rsci_sql.resubmit_ticket TO 'rsci_inventory' @'%';
-- ---- AUTH (registration page): create a user. Only these columns can be written, so a new
-- account can never set id or created_at; the role must exist in `roles` (foreign key).
GRANT SELECT ON rsci_sql.roles TO 'rsci_auth' @'%';
GRANT INSERT (name, email, password_hash, role, phone_enc) ON rsci_sql.users TO 'rsci_auth' @'%';
GRANT INSERT ON rsci_sql.activity_log TO 'rsci_auth' @'%';
-- ---- Criterion 2: the all-SQL purchase-order transaction (sql/01_schema.sql, sp_create_po).
-- It runs as the caller, so it only works for roles that already hold the table privileges.
GRANT EXECUTE ON PROCEDURE rsci_sql.sp_create_po TO 'rsci_po_officer' @'%';
FLUSH PRIVILEGES;