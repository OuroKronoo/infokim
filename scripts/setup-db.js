// Creates the database, the per-role DB users + grants, and seed data.
// Usage: npm run setup-db   (connects as DB_ROOT_USER from .env)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const { DB_HOST = '127.0.0.1', DB_PORT = 3306, DB_ROOT_USER = 'root', DB_ROOT_PASSWORD = '',
  DB_ROLE_PASSWORD = 'Rsci#Demo2026', ENC_KEY } = process.env;
const DEMO_LOGIN_PASSWORD = 'Password123!';
const BULK_EXPENSES = 100000;

const sqlFile = (name) => fs.readFileSync(path.join(__dirname, '..', 'sql', name), 'utf8');

async function main() {
  if (!ENC_KEY) throw new Error('ENC_KEY missing in .env');
  const root = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_ROOT_USER, password: DB_ROOT_PASSWORD, multipleStatements: true,
  });

  console.log('Creating schema...');
  await root.query(sqlFile('01_schema.sql'));
  console.log('Creating DB users and grants...');
  await root.query(sqlFile('02_roles.sql').replaceAll('__PW__', DB_ROLE_PASSWORD.replace(/'/g, "''")));
  await root.query('USE rsci_sql');

  const aes = (v) => root.format('AES_ENCRYPT(?, SHA2(?, 256))', [v, ENC_KEY]);

  console.log('Seeding users...');
  const hash = await bcrypt.hash(DEMO_LOGIN_PASSWORD, 10);
  const users = [
    ['Boss Malupiton', 'boss@rsci.test', 'boss', '0917-000-0001'],
    ['Sir Ar-Jay', 'om@rsci.test', 'om', '0917-000-0002'],
    ['Engr. Josef', 'engineer@rsci.test', 'engineer', '0917-000-0003'],
    ['Officer Renz', 'po@rsci.test', 'po_officer', '0917-000-0004'],
    ['Maam Fauna', 'accountant@rsci.test', 'accountant', '0917-000-0005'],
    ['Sir John', 'inventory@rsci.test', 'inventory', '0917-000-0006'],
    ['Engr. Andrea', 'engineer2@rsci.test', 'engineer', '0917-000-0007'],
    ['Maam Shanea', 'admin@rsci.test', 'admin', '0917-000-0008'],
  ];
  for (const [name, email, role, phone] of users) {
    await root.query(
      `INSERT INTO users (name, email, password_hash, role, phone_enc) VALUES (?, ?, ?, ?, ${aes(phone)})`,
      [name, email, hash, role]);
  }

  console.log('Seeding projects, vendors, tickets...');
  await root.query(
    `INSERT INTO projects (company, name) VALUES
     ('Ayala Land','Tower 2 Fit-out'),('SM Prime','Mall Annex Phase 1'),('Megaworld','Uptown Parksuites'),
     ('DMCI','Riverfront Residences'),('Internal','Warehouse Repairs')`);
  const vendors = [['Hardware Depot', '0917-555-0101', '123-456-789-000'],
  ['Steel Masters Inc.', '0917-555-0102', '234-567-890-000'],
  ['Pioneer Electrical', '0917-555-0103', '345-678-901-000'],
  ['Paint & Tools Hub', '0917-555-0104', '456-789-012-000']];
  for (const [n, c, tin] of vendors) {
    await root.query(`INSERT INTO vendors (name, contact, tin_enc) VALUES (?, ?, ${aes(tin)})`, [n, c]);
  }
  // Tickets 1-2 await the Boss; tickets 3-4 are approved and waiting for a P.O.
  const tickets = [
    [1, 3, 'urgent', 'Pending Boss Approval', [['Cement 40kg', 50, 'bag'], ['Sand', 5, 'cu.m']]],
    [2, 7, 'normal', 'Pending Boss Approval', [['Steel bar 12mm', 100, 'pc']]],
    [3, 3, 'normal', 'Approved for PO', [['Cement 40kg', 10, 'bag']]],
    [4, 7, 'urgent', 'Approved for PO', [['THHN wire 3.5mm', 20, 'roll'], ['Conduit 20mm', 40, 'pc']]],
  ];
  for (const [proj, by, urg, status, items] of tickets) {
    const [r] = await root.query(
      `INSERT INTO tickets (project_id, requested_by, urgency, date_needed, remarks, status, decided_by)
       VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Seed data', ?, ?)`,
      [proj, by, urg, status, status === 'Approved for PO' ? 1 : null]);
    for (const [d, q, u] of items) {
      await root.query('INSERT INTO ticket_items (ticket_id, description, qty, unit) VALUES (?, ?, ?, ?)', [r.insertId, d, q, u]);
    }
  }

  // Opening balances. THHN wire and conduit are below what ticket 4 asks for, so the
  // availability label shows "Only N in stock" there.
  const stock = [['Cement 40kg', 'bag', 120], ['Sand', 'cu.m', 30], ['Steel bar 12mm', 'pc', 250],
  ['THHN wire 3.5mm', 'roll', 8], ['Conduit 20mm', 'pc', 15]];
  for (const [name, unit, qty] of stock) {
    const [r] = await root.query('INSERT INTO inventory (item_name, unit, qty_on_hand) VALUES (?, ?, ?)', [name, unit, qty]);
    await root.query(`INSERT INTO inventory_log (inventory_id, change_qty, reason, created_by) VALUES (?, ?, 'Opening balance', 6)`, [r.insertId, qty]);
  }

  console.log(`Seeding ${BULK_EXPENSES.toLocaleString()} expense rows (for the query-optimization demo)...`);
  const cats = ['Materials', 'Labor', 'Fuel', 'Equipment Rental', 'Permits', 'Office', 'Transport'];
  const start = Date.UTC(2025, 0, 1), span = Date.UTC(2026, 8, 30) - start;
  for (let done = 0; done < BULK_EXPENSES; done += 5000) {
    const rows = [];
    for (let i = 0; i < 5000; i++) {
      const d = new Date(start + Math.floor(Math.random() * span)).toISOString().slice(0, 10);
      rows.push([1 + Math.floor(Math.random() * 5), null, cats[Math.floor(Math.random() * cats.length)],
        'Bulk seed', (50 + Math.random() * 9950).toFixed(2), d, 5]);
    }
    await root.query('INSERT INTO expenses (project_id, po_id, category, description, amount, expense_date, created_by) VALUES ?', [rows]);
  }

  await root.end();
  console.log('\nDone. Start the app with: npm start');
  console.log(`Demo logins (password for all: ${DEMO_LOGIN_PASSWORD}):`);
  users.forEach(([n, e, r]) => console.log(`  ${r.padEnd(11)} ${e}`));
}

main().catch((e) => { console.error('\nSetup failed:', e.message); process.exit(1); });
