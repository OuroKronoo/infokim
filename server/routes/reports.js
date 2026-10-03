const router = require('express').Router();
const { requireRole } = require('../auth');
const { HttpError } = require('../db');
const { wrap } = require('../util');

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// Counts for the dashboard cards. Engineers hold no SELECT on purchase_orders, so they get tickets only.
router.get('/dashboard', wrap(async (req, res) => {
  const mine = req.user.role === 'engineer';
  const [tickets] = await req.db.query(
    `SELECT status, COUNT(*) AS n FROM tickets ${mine ? 'WHERE requested_by = ?' : ''} GROUP BY status`, mine ? [req.user.id] : []);
  let pos = null;
  if (!mine) [pos] = await req.db.query('SELECT status, COUNT(*) AS n FROM purchase_orders GROUP BY status');
  res.json({ tickets, pos });
}));

// Criterion 5 query: this is the one Query Lab tunes with an index.
router.get('/expenses-summary', requireRole('boss', 'om', 'accountant', 'admin'), wrap(async (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from and to must be YYYY-MM-DD');
  const t0 = process.hrtime.bigint();
  const [rows] = await req.db.query(
    `SELECT e.project_id, p.company, p.name AS project, COUNT(*) AS entries, SUM(e.amount) AS total
     FROM expenses e JOIN projects p ON p.id = e.project_id
     WHERE e.expense_date BETWEEN ? AND ?
     GROUP BY e.project_id, p.company, p.name ORDER BY total DESC`, [from, to]);
  // Shown on the Expenses page: this number drops when the covering index from sql/04 exists.
  res.set('X-Query-Ms', (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1));
  res.json(rows);
}));

router.get('/activity', requireRole('boss', 'om', 'admin'), wrap(async (req, res) => {
  const [rows] = await req.db.query(
    `SELECT a.id, a.created_at, u.name AS user, a.action, a.entity, a.entity_id, a.detail
     FROM activity_log a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`);
  res.json(rows);
}));

// Administrator oversight: who did how much, and when they last acted (from the append-only audit log).
router.get('/team', requireRole('admin'), wrap(async (req, res) => {
  const [rows] = await req.db.query(
    `SELECT u.id, u.name, u.role, COUNT(a.id) AS actions, MAX(a.created_at) AS last_action
     FROM users u LEFT JOIN activity_log a ON a.user_id = u.id
     GROUP BY u.id, u.name, u.role ORDER BY actions DESC, u.name`);
  res.json(rows);
}));

module.exports = router;
