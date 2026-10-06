-- ============================================================================
-- RSCI SQL prototype - schema (3NF)
-- Runs on MySQL 8 and MariaDB 10.4 (XAMPP). Re-run with: npm run setup-db
--
-- HOW THE EVALUATION FORM (7 criteria) MAPS TO THE BACKEND (everything below lives in
-- the database / server, not in the browser):
--   1 Project context ........ this file: tables, PK/FK, UNIQUE, CHECK (3NF design)
--   2 Transaction mgmt ....... START TRANSACTION / COMMIT / ROLLBACK, SAVEPOINT, isolation levels,
--                              EXIT HANDLER + RESIGNAL  -> procedure sp_create_po (bottom of this file),
--                              server/db.js withTransaction, and sql/03_transactions_demo.sql
--   3 Database encryption .... *_enc VARBINARY columns (AES_ENCRYPT / AES_DECRYPT), bcrypt password_hash
--                              -> server/db.js encrypt()/decrypt(), sql/06_encryption_demo.sql
--   4 Authorization .......... one MySQL user per role + GRANT/REVOKE, least privilege, column grants
--                              -> sql/02_roles.sql, sql/05_revoke_demo.sql, sql/07_roles_demo.sql
--   5 Query optimization ..... indexes, EXPLAIN / ANALYZE, query rewriting, efficient joins, partitioning
--                              -> sql/04_optimization.sql
--   6 Integration ............ server/ (Express API) + public/ (web pages) call exactly these objects
--   7 Presentation ........... README.md and PRESENTATION_SCRIPT.md
--
-- TO ADD OR CHANGE A ROLE (it shows up on the web registration form automatically):
--   a) add / edit its row in the `roles` table below  (set self_register = 0 to hide it from the form)
--   b) add its MySQL account + GRANTs in sql/02_roles.sql  (account name must be rsci_<code>)
--   c) if it needs its own screens, add it to the VIEWS list in public/js/app.js
--   d) run: npm run setup-db
-- ============================================================================
DROP DATABASE IF EXISTS rsci_sql;
CREATE DATABASE rsci_sql CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rsci_sql;

-- Role catalogue (Criterion 4). This is the single place that defines which roles exist.
-- The web registration form reads this table (GET /api/roles); users.role must match a code here.
--   code          = short name; the MySQL account for it is rsci_<code> (see sql/02_roles.sql)
--   self_register = 1: people may pick this role when they create an account on the website
--                   0: hidden from the form (only a DBA can create such users)
--   sort_order    = order shown in the dropdown
CREATE TABLE roles (
  code          VARCHAR(20)  NOT NULL PRIMARY KEY,
  label         VARCHAR(60)  NOT NULL,
  description   VARCHAR(200) NOT NULL,
  self_register TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    TINYINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

INSERT INTO roles (code, label, description, self_register, sort_order) VALUES
  ('engineer',   'Engineer',           'Files material requests (tickets) for a project',                1, 1),
  ('boss',       'Boss',               'Approves or rejects requests and purchase orders',                1, 2),
  ('om',         'Operations Manager', 'Approves or rejects purchase orders; read-only elsewhere',        1, 3),
  ('po_officer', 'PO Officer',         'Creates purchase orders and vendors',                             1, 4),
  ('accountant', 'Accountant',         'Records payments and posts them to expenses',                     1, 5),
  ('inventory',  'Inventory',          'Receives delivered goods and moves stock',                        1, 6),
  ('admin',      'Administrator',      'Read-only oversight of every action; cannot act or see secrets',  1, 7);

-- Staff accounts. password_hash = bcrypt (one-way). phone_enc = AES (reversible).
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  password_hash VARCHAR(100)  NOT NULL,
  role          VARCHAR(20)   NOT NULL,
  phone_enc     VARBINARY(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_u_role FOREIGN KEY (role) REFERENCES roles(code)
) ENGINE=InnoDB;

CREATE TABLE projects (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company VARCHAR(120) NOT NULL,
  name    VARCHAR(150) NOT NULL,
  UNIQUE KEY uq_project (company, name)
) ENGINE=InnoDB;

-- tin_enc = supplier tax ID, encrypted at rest.
CREATE TABLE vendors (
  id      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name    VARCHAR(150) NOT NULL UNIQUE,
  contact VARCHAR(100) NULL,
  tin_enc VARBINARY(255) NULL
) ENGINE=InnoDB;

-- Engineer's material request. Status machine:
-- Pending Boss Approval -> Approved for PO | Rejected by Boss
-- Rejected by Boss -> (submitter edits and resubmits) -> Pending Boss Approval
-- Approved for PO -> PO Created -> Completed
CREATE TABLE tickets (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id   INT UNSIGNED NOT NULL,
  requested_by INT UNSIGNED NOT NULL,
  urgency      ENUM('normal','urgent') NOT NULL DEFAULT 'normal',
  date_needed  DATE NULL,
  remarks      VARCHAR(500) NULL,
  status       ENUM('Pending Boss Approval','Approved for PO','Rejected by Boss','PO Created','Completed')
               NOT NULL DEFAULT 'Pending Boss Approval',
  decided_by   INT UNSIGNED NULL,
  reject_reason  VARCHAR(300) NULL,
  resubmit_count INT UNSIGNED NOT NULL DEFAULT 0,
  resubmitted_at TIMESTAMP NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_t_project FOREIGN KEY (project_id)   REFERENCES projects(id),
  CONSTRAINT fk_t_user    FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_t_decider FOREIGN KEY (decided_by)   REFERENCES users(id),
  KEY idx_t_status (status)
) ENGINE=InnoDB;

CREATE TABLE ticket_items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  description VARCHAR(200) NOT NULL,
  qty         DECIMAL(12,2) NOT NULL CHECK (qty > 0),
  unit        VARCHAR(20) NOT NULL,
  CONSTRAINT fk_ti_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- po_no is typed in by the P.O. Officer and must be unique (as in the live system).
-- Status: Pending Approval -> Approved | Rejected -> Purchased -> Received
CREATE TABLE purchase_orders (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_no       VARCHAR(30) NOT NULL UNIQUE,
  ticket_id   INT UNSIGNED NOT NULL,
  vendor_id   INT UNSIGNED NOT NULL,
  created_by  INT UNSIGNED NOT NULL,
  status      ENUM('Pending Approval','Approved','Rejected','Purchased','Received')
              NOT NULL DEFAULT 'Pending Approval',
  total       DECIMAL(14,2) NOT NULL DEFAULT 0,
  decided_by  INT UNSIGNED NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_po_ticket  FOREIGN KEY (ticket_id)  REFERENCES tickets(id),
  CONSTRAINT fk_po_vendor  FOREIGN KEY (vendor_id)  REFERENCES vendors(id),
  CONSTRAINT fk_po_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_po_decider FOREIGN KEY (decided_by) REFERENCES users(id),
  KEY idx_po_status (status)
) ENGINE=InnoDB;

CREATE TABLE po_items (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_id       INT UNSIGNED NOT NULL,
  description VARCHAR(200) NOT NULL,
  qty         DECIMAL(12,2) NOT NULL CHECK (qty > 0),
  unit        VARCHAR(20) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL CHECK (unit_price >= 0),
  CONSTRAINT fk_pi_po FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- check_no_enc = check / reference number, encrypted at rest.
CREATE TABLE payments (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_id        INT UNSIGNED NOT NULL UNIQUE,
  amount       DECIMAL(14,2) NOT NULL,
  check_no_enc VARBINARY(255) NOT NULL,
  recorded_by  INT UNSIGNED NOT NULL,
  paid_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_po   FOREIGN KEY (po_id)       REFERENCES purchase_orders(id),
  CONSTRAINT fk_pay_user FOREIGN KEY (recorded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- General Expenses ledger. Grows large (seeded to 100k rows) for the
-- query-optimization demo. Deliberately has NO index on expense_date yet:
-- sql/04_optimization.sql adds it.
CREATE TABLE expenses (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id   INT UNSIGNED NOT NULL,
  po_id        INT UNSIGNED NULL,
  category     VARCHAR(40)  NOT NULL,
  description  VARCHAR(200) NULL,
  amount       DECIMAL(14,2) NOT NULL,
  expense_date DATE NOT NULL,
  created_by   INT UNSIGNED NOT NULL,
  CONSTRAINT fk_e_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_e_po      FOREIGN KEY (po_id)      REFERENCES purchase_orders(id),
  CONSTRAINT fk_e_user    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE inventory (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_name   VARCHAR(200) NOT NULL,
  unit        VARCHAR(20)  NOT NULL,
  qty_on_hand DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  UNIQUE KEY uq_item (item_name, unit)
) ENGINE=InnoDB;

CREATE TABLE inventory_log (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id INT UNSIGNED NOT NULL,
  po_id        INT UNSIGNED NULL,
  project_id   INT UNSIGNED NULL,
  change_qty   DECIMAL(12,2) NOT NULL,
  reason       VARCHAR(200) NOT NULL,
  created_by   INT UNSIGNED NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_il_inv  FOREIGN KEY (inventory_id) REFERENCES inventory(id),
  CONSTRAINT fk_il_po   FOREIGN KEY (po_id)        REFERENCES purchase_orders(id),
  CONSTRAINT fk_il_proj FOREIGN KEY (project_id)   REFERENCES projects(id),
  CONSTRAINT fk_il_user FOREIGN KEY (created_by)   REFERENCES users(id)
) ENGINE=InnoDB;

-- Append-only audit trail (no role is granted UPDATE or DELETE on it).
CREATE TABLE activity_log (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  action     VARCHAR(60)  NOT NULL,
  entity     VARCHAR(40)  NOT NULL,
  entity_id  INT UNSIGNED NULL,
  detail     VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id),
  KEY idx_al_created (created_at)
) ENGINE=InnoDB;

-- Resubmit a ticket the Boss rejected. SQL SECURITY DEFINER lets submitters change one
-- ticket row only through this procedure, so no role needs UPDATE or DELETE on tickets /
-- ticket_items. The checks inside are what enforce "own ticket, currently rejected".
DROP PROCEDURE IF EXISTS resubmit_ticket;
CREATE PROCEDURE resubmit_ticket(
  IN p_ticket INT UNSIGNED, IN p_user INT UNSIGNED, IN p_project INT UNSIGNED,
  IN p_urgency VARCHAR(10), IN p_needed DATE, IN p_remarks VARCHAR(500))
SQL SECURITY DEFINER
BEGIN
  DECLARE v_ok INT DEFAULT 0;
  SELECT COUNT(*) INTO v_ok FROM tickets
   WHERE id = p_ticket AND requested_by = p_user AND status = 'Rejected by Boss' FOR UPDATE;
  IF v_ok = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only the submitter can edit a ticket the Boss rejected';
  END IF;
  DELETE FROM ticket_items WHERE ticket_id = p_ticket;
  UPDATE tickets
     SET project_id = p_project, urgency = p_urgency, date_needed = p_needed, remarks = p_remarks,
         status = 'Pending Boss Approval', decided_by = NULL, reject_reason = NULL,
         resubmit_count = resubmit_count + 1, resubmitted_at = NOW()
   WHERE id = p_ticket;
END;

-- ----------------------------------------------------------------------------
-- Criterion 2 - the whole "create a purchase order" transaction written in SQL only.
-- The Express route (server/routes/purchaseOrders.js) does the same steps with
-- withTransaction(); this procedure shows that the database alone can guarantee them.
--   * Atomicity     : START TRANSACTION ... COMMIT, or ROLLBACK if anything fails
--   * Error handling: DECLARE EXIT HANDLER catches any SQL error, rolls back, then RESIGNAL
--                     re-raises it so the caller still sees the real error (e.g. 1062 duplicate P.O. no.)
--   * Consistency   : SIGNAL refuses a ticket that is not 'Approved for PO'; FKs/CHECKs do the rest
--   * Isolation     : the guarded UPDATE takes a row lock, so two people cannot create two P.O.s for one ticket
-- SQL SECURITY INVOKER = runs with the caller's own privileges (least privilege is not bypassed).
-- Try it: sql/03_transactions_demo.sql, section H.
-- ----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS sp_create_po;
CREATE PROCEDURE sp_create_po(
  IN p_po_no VARCHAR(30), IN p_ticket INT UNSIGNED, IN p_vendor INT UNSIGNED,
  IN p_user INT UNSIGNED, IN p_unit_price DECIMAL(12,2))
SQL SECURITY INVOKER
BEGIN
  DECLARE v_total DECIMAL(14,2);
  DECLARE v_po INT UNSIGNED;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    UPDATE tickets SET status = 'PO Created' WHERE id = p_ticket AND status = 'Approved for PO';
    IF ROW_COUNT() = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ticket is not approved for a P.O.';
    END IF;
    SELECT SUM(qty) * p_unit_price INTO v_total FROM ticket_items WHERE ticket_id = p_ticket;
    INSERT INTO purchase_orders (po_no, ticket_id, vendor_id, created_by, total)
    VALUES (p_po_no, p_ticket, p_vendor, p_user, IFNULL(v_total, 0));
    SET v_po = LAST_INSERT_ID();
    INSERT INTO po_items (po_id, description, qty, unit, unit_price)
      SELECT v_po, description, qty, unit, p_unit_price FROM ticket_items WHERE ticket_id = p_ticket;
    INSERT INTO activity_log (user_id, action, entity, entity_id, detail)
    VALUES (p_user, 'PO_CREATED', 'purchase_order', v_po, CONCAT(p_po_no, ' total ', IFNULL(v_total, 0)));
  COMMIT;
  SELECT v_po AS po_id, v_total AS total;
END;
