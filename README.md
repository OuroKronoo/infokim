# RSCI Operations System - SQL prototype

IT EL 5 - Advanced Information Management. A scaled-down copy of the RSCI procurement
ticketing website (`../rsci-ticketing`, Firebase) rebuilt on **MySQL** with a plain HTML/JS
frontend and a small Express API. No Firebase.

Presenting this? Read **[PRESENTATION_SCRIPT.md](PRESENTATION_SCRIPT.md)** (speaker script, front end / back end explanation, demo order, likely questions).
The visual direction is recorded in **[DESIGN.md](DESIGN.md)**.

## 1. Project context (Criterion 1)

**Background.** Rivera-Sarvida Construction Inc. replaces QuickBooks-plus-paper with a website
that follows a material request from the site engineer to stock in the warehouse.

**Objectives.** One traceable pipeline, no double approvals or double payments, sensitive
supplier and payment data protected, and each staff role limited to what its job needs.

**Users (7 roles).** Engineer, Boss, OM, PO Officer, Accountant, Inventory, and a read-only Administrator who oversees every action but cannot act or see secrets.

**Business process.**

```
Engineer files request -> Boss approves -> PO Officer creates P.O. (unique P.O. no.)
-> Boss OR OM approves P.O. -> Accountant records payment + posts to Expenses
-> Inventory receives goods into stock -> request Completed
```

**Database requirements.** Relational integrity (FKs, unique P.O. numbers), atomic multi-table
updates, encrypted TIN and check numbers, per-role privileges, and fast expense reports on a
large ledger. Tables: `users, projects, vendors, tickets, ticket_items, purchase_orders,
po_items, payments, expenses, inventory, inventory_log, activity_log` (3NF, see `sql/01_schema.sql`).

Left out of the prototype on purpose: billing/VO cascade, subcontractors, notifications,
photo attachments, Excel export.

## 2. Run it

Needs Node 18+ and MySQL 8 **or** XAMPP's MariaDB 10.4 (start MySQL in the XAMPP Control Panel).

```bash
npm install
cp .env.example .env      # edit DB_ROOT_PASSWORD if your root has one; change ENC_KEY and JWT_SECRET
npm run setup-db          # creates rsci_sql, DB users + grants, seed data, 100k expense rows
npm start                 # http://localhost:3000
```

`npm run setup-db` wipes and recreates `rsci_sql`; run it again any time to reset the demo.

Every role can file a ticket (Requests -> Submit a ticket); it always starts at Pending Boss Approval, as in the live site.
A rejected ticket shows the Boss's reason and its submitter can **Edit & resubmit** it. The Inventory role can **Stock in** and **Stock out** (Inventory page) besides receiving P.O.s.

**Creating more accounts.** The sign-in page has a **Create an account** link. Pick a name, email, optional phone
(stored encrypted), role and password; you are signed in as that role straight away. The role list comes from the
`roles` table in `sql/01_schema.sql`, so to add, rename or hide a role edit that table (set `self_register = 0` to
hide it), add its `rsci_<code>` account and grants in `sql/02_roles.sql`, then run `npm run setup-db`.
The registration page runs as the restricted `rsci_auth` DB user, which may only insert the user columns shown in `02_roles.sql`.

Demo logins, password `Password123!` for all: `boss@rsci.test`, `om@rsci.test`,
`engineer@rsci.test`, `po@rsci.test`, `accountant@rsci.test`, `inventory@rsci.test`, `admin@rsci.test`.
The login page has one-click buttons. Open each role in a separate browser profile or
private window, because the session is per tab.

## 3. Where each rubric criterion is demonstrated

| # | Criterion | Code | Live demo |
|---|-----------|------|-----------|
| 2 | Transaction management | `server/db.js` `withTransaction`, `server/routes/purchaseOrders.js`, `sql/03_transactions_demo.sql` (COMMIT, ROLLBACK, SAVEPOINT, isolation, `sp_create_po` with an error handler) | Tick **Simulate failure before COMMIT**, then create a P.O. / confirm purchase / receive. Everything is undone and the toast says ROLLED BACK. Reuse a P.O. number to trigger a duplicate-key rollback. Click a decision button twice: the second gets 409 (isolation via guarded `UPDATE ... WHERE status=`). |
| 3 | Database encryption | `server/db.js` `encrypt/decrypt`, `sql/01_schema.sql` (`VARBINARY` columns), `sql/06_encryption_demo.sql` | Run `sql/06_encryption_demo.sql`: stored hex next to the decrypted value for vendor TIN, check numbers and phone numbers. Passwords are bcrypt-hashed. The key lives in `.env`, not the database. |
| 4 | Authorization and privileges | `sql/02_roles.sql`, `sql/05_revoke_demo.sql`, `sql/07_roles_demo.sql` (CREATE ROLE), `server/db.js` `poolFor` | The API connects as a **different MySQL user per role**, so MySQL enforces access. Column-level grants hide `tin_enc` from Engineer/OM/Inventory. No role has `DELETE` (submitters edit a rejected ticket only through the `resubmit_ticket` stored procedure), and `activity_log` is insert-only. Run `sql/05_revoke_demo.sql` to `SHOW GRANTS` and `REVOKE` live. |
| 5 | Query optimization | `sql/04_optimization.sql` (indexing, EXPLAIN/ANALYZE, query rewriting, efficient joins, partitioning) | Run `sql/04_optimization.sql`: `EXPLAIN` without the index (full scan), create the covering index, `EXPLAIN` again (range scan), plus the `YEAR()/MONTH()` form that defeats the index. |
| 6 | Integration | `server/`, `public/` | The whole pipeline above runs end to end from the UI. |

## 4. Suggested presentation order

1. Context slide (section 1) and the ERD from `sql/01_schema.sql`.
2. Walk the pipeline with 2-3 roles. Show a failed transaction rolling back.
3. `sql/06_encryption_demo.sql`, then `sql/02_roles.sql` and `sql/05_revoke_demo.sql`.
4. `sql/04_optimization.sql` before/after.
5. Close on `server/routes/purchaseOrders.js` (the transactions in code).

## 5. Notes and limits

- Developed against MariaDB 10.4 (XAMPP). The SQL avoids MySQL-8-only syntax. Not yet run on MySQL 8; on MySQL 8.0.18+ use `EXPLAIN ANALYZE`, on MariaDB use `ANALYZE`.
- The per-role DB users share one demo password (`DB_ROLE_PASSWORD`). Use distinct secrets in any real deployment.
- Seed users share the password `Password123!`. Local demo only.
- Login tokens live in `sessionStorage` and expire after 8 hours.
- If `npm run setup-db` ever sits for minutes (seen once on MariaDB 10.4: an InnoDB internal lock,
  `semaphore wait ... dict0dict.cc` in `xampp/mysql/data/mysql_error.log`), stop and restart MySQL
  from the XAMPP Control Panel and run it again.

