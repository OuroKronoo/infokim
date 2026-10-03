const router = require('express').Router();
const { requireRole } = require('../auth');
const { withTransaction, logActivity, HttpError } = require('../db');
const { wrap, positive } = require('../util');
const { stockIn, stockOut } = require('../stock');

const VIEWERS = ['boss', 'om', 'inventory', 'admin'];
const guard = (req) => {
  if (!VIEWERS.includes(req.user.role)) throw new HttpError(403, 'Not allowed to view inventory');
};
const reasonOf = (body) => {
  const reason = String(body.reason || '').trim().slice(0, 200);
  if (reason.length < 3) throw new HttpError(400, 'Give a reason for this movement');
  return reason;
};
const maybeFail = (req) => {
  if (req.body && req.body.simulateFailure) throw new Error('Simulated failure just before COMMIT');
};

router.get('/', wrap(async (req, res) => {
  guard(req);
  const [rows] = await req.db.query('SELECT id, item_name, unit, qty_on_hand FROM inventory ORDER BY item_name');
  res.json(rows);
}));

router.get('/log', wrap(async (req, res) => {
  guard(req);
  const [rows] = await req.db.query(
    `SELECT l.id, i.item_name, i.unit, l.change_qty, l.reason, l.created_at, u.name AS by_user, p.name AS project
     FROM inventory_log l
     JOIN inventory i ON i.id = l.inventory_id
     JOIN users u     ON u.id = l.created_by
     LEFT JOIN projects p ON p.id = l.project_id
     ORDER BY l.id DESC LIMIT 100`);
  res.json(rows);
}));

// Stock in: delivery not tied to a P.O., return from site, opening balance. Creates the item if new.
router.post('/stock-in', requireRole('inventory'), wrap(async (req, res) => {
  const name = String(req.body.item_name || '').trim();
  const unit = String(req.body.unit || '').trim();
  if (!name || !unit || !positive(req.body.qty)) throw new HttpError(400, 'Item, unit and a quantity above 0 are required');
  const reason = reasonOf(req.body);
  await withTransaction(req.db, async (conn) => {
    const id = await stockIn(conn, { name, unit, qty: Number(req.body.qty), reason, userId: req.user.id });
    await logActivity(conn, req.user.id, 'STOCK_IN', 'inventory', id, `+${req.body.qty} ${unit} ${name}`);
    maybeFail(req);
  });
  res.status(201).json({ ok: true });
}));

// Stock out: release to a project, damage, usage. Cannot take the balance below zero.
router.post('/stock-out', requireRole('inventory'), wrap(async (req, res) => {
  if (!req.body.inventory_id || !positive(req.body.qty)) throw new HttpError(400, 'Choose an item and a quantity above 0');
  const reason = reasonOf(req.body);
  await withTransaction(req.db, async (conn) => {
    await stockOut(conn, { inventoryId: req.body.inventory_id, qty: Number(req.body.qty), reason,
      projectId: req.body.project_id || null, userId: req.user.id });
    await logActivity(conn, req.user.id, 'STOCK_OUT', 'inventory', Number(req.body.inventory_id), `-${req.body.qty} (${reason})`);
    maybeFail(req);
  });
  res.json({ ok: true });
}));

module.exports = router;
