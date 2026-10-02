-- ============================================================================
-- RSCI SQL prototype - schema (3NF)
-- Criterion 1 (project context) + Criterion 2 (ACID needs InnoDB + FKs)
-- Runs on MySQL 8 and MariaDB 10.4 (XAMPP).
-- ============================================================================
DROP DATABASE IF EXISTS rsci_sql;
CREATE DATABASE rsci_sql CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE rsci_sql;

-- Staff accounts. password_hash = bcrypt (one-way). phone_enc = AES (reversible).
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  password_hash VARCHAR(100)  NOT NULL,
  role          ENUM('boss','om','engineer','po_officer','accountant','inventory') NOT NULL,
  phone_enc     VARBINARY(255) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
