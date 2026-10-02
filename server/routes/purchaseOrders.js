// Criterion 2: the workflows below each run as ONE transaction.
const router = require('express').Router();
const { requireRole } = require('../auth');
const { encrypt, withTransaction, logActivity, HttpError } = require('../db');
const { wrap, validateItems } = require('../util');
const { stockIn } = require('../stock');

const PO_SELECT = `
  SELECT po.id, po.po_no, po.status, po.total, po.created_at, po.ticket_id,
         CONCAT('TKT-', LPAD(po.ticket_id, 5, '0')) AS ticket_no,
         v.name AS vendor, p.name AS project, u.name AS created_by
  FROM purchase_orders po
  JOIN vendors v  ON v.id = po.vendor_id
  JOIN tickets t  ON t.id = po.ticket_id
  JOIN projects p ON p.id = t.project_id
  JOIN users u    ON u.id = po.created_by`;

// Demo switch: after every statement succeeded, blow up before COMMIT to show ROLLBACK undoing all of it.
const maybeFail = (req) => {
  if (req.body && req.body.simulateFailure) throw new Error('Simulated failure just before COMMIT');
};

// Guarded status change: affects 0 rows if somebody else already moved the P.O. on.
async function moveStatus(conn, id, from, to, extraSet = '', extraParams = []) {
  const [r] = await conn.query(
    `UPDATE purchase_orders SET status = ?${extraSet} WHERE id = ? AND status = ?`, [to, ...extraParams, id, from]);
  if (r.affectedRows === 0) throw new HttpError(409, `P.O. is not in status "${from}" (someone may have just changed it)`);
}

const noEngineers = (req) => {
  if (req.user.role === 'engineer') throw new HttpError(403, 'Engineers cannot view purchase orders');
};

router.get('/', wrap(async (req, res) => {
  noEngineers(req);
  const [rows] = await req.db.query(
    `${PO_SELECT} ${req.query.status ? 'WHERE po.status = ?' : ''} ORDER BY po.id DESC LIMIT 200`,
    req.query.status ? [req.query.status] : []);
  res.json(rows);
}));

router.get('/:id', wrap(async (req, res) => {
  noEngineers(req);
  const [rows] = await req.db.query(`${PO_SELECT} WHERE po.id = ?`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'P.O. not found');
  const [items] = await req.db.query(
    'SELECT description, qty, unit, unit_price, ROUND(qty * unit_price, 2) AS line_total FROM po_items WHERE po_id = ?',
    [req.params.id]);
  res.json({ ...rows[0], items });
}));

// PO Officer: P.O. header + items + ticket status flip + audit entry.
router.post('/', requireRole('po_officer'), wrap(async (req, res) => {
  const po_no = String(req.body.po_no || '').trim();
  if (!po_no) throw new HttpError(400, 'P.O. number is required');
  if (!req.body.ticket_id || !req.body.vendor_id) throw new HttpError(400, 'Choose a ticket and a vendor');
  const items = validateItems(req.body.items, true);
  const total = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price * 100), 0) / 100;

  const id = await withTransaction(req.db, async (conn) => {
    const [flip] = await conn.query(
      `UPDATE tickets SET status = 'PO Created' WHERE id = ? AND status = 'Approved for PO'`, [req.body.ticket_id]);
    if (flip.affectedRows === 0) throw new HttpError(409, 'Ticket is not approved for a P.O.');
    // A duplicate po_no raises ER_DUP_ENTRY here, which rolls back the ticket flip above.
    const [po] = await conn.query(
      'INSERT INTO purchase_orders (po_no, ticket_id, vendor_id, created_by, total) VALUES (?, ?, ?, ?, ?)',
      [po_no, req.body.ticket_id, req.body.vendor_id, req.user.id, total]);
    await conn.query('INSERT INTO po_items (po_id, description, qty, unit, unit_price) VALUES ?',
      [items.map((i) => [po.insertId, i.description, i.qty, i.unit, i.unit_price])]);
    await logActivity(conn, req.user.id, 'PO_CREATED', 'purchase_order', po.insertId, `${po_no} total ${total}`);
    maybeFail(req);
    return po.insertId;
  });
  res.status(201).json({ id });
}));

// Boss or OM: either sign-off alone clears the P.O. (as in the live system).
router.patch('/:id/decision', requireRole('boss', 'om'), wrap(async (req, res) => {
  const approve = req.body.decision === 'approve';
  if (!approve && req.body.decision !== 'reject') throw new HttpError(400, 'decision must be approve or reject');
  await withTransaction(req.db, async (conn) => {
    await moveStatus(conn, req.params.id, 'Pending Approval', approve ? 'Approved' : 'Rejected', ', decided_by = ?', [req.user.id]);
    await logActivity(conn, req.user.id, approve ? 'PO_APPROVED' : 'PO_REJECTED', 'purchase_order', Number(req.params.id));
  });
  res.json({ ok: true });
}));

// Accountant: payment (check no. encrypted) + expense posting + status change, atomically.
router.post('/:id/confirm-purchase', requireRole('accountant'), wrap(async (req, res) => {
  const checkNo = String(req.body.check_no || '').trim();
  if (!checkNo) throw new HttpError(400, 'Check / reference number is required');
  await withTransaction(req.db, async (conn) => {
    await moveStatus(conn, req.params.id, 'Approved', 'Purchased');
    const [[po]] = await conn.query(
      `SELECT po.po_no, po.total, t.project_id FROM purchase_orders po JOIN tickets t ON t.id = po.ticket_id WHERE po.id = ?`,
      [req.params.id]);
    await conn.query(
      `INSERT INTO payments (po_id, amount, check_no_enc, recorded_by) VALUES (?, ?, ${encrypt(checkNo)}, ?)`,
      [req.params.id, po.total, req.user.id]);
    await conn.query(
      `INSERT INTO expenses (project_id, po_id, category, description, amount, expense_date, created_by)
       VALUES (?, ?, 'Materials', ?, ?, CURDATE(), ?)`,
      [po.project_id, req.params.id, `P.O. ${po.po_no}`, po.total, req.user.id]);
    await logActivity(conn, req.user.id, 'PO_PURCHASED', 'purchase_order', Number(req.params.id), `posted ${po.total} to expenses`);
    maybeFail(req);
  });
  res.json({ ok: true });
}));

// Inventory: add delivered items to stock, write the movement log, close the P.O. and its ticket.
router.post('/:id/receive', requireRole('inventory'), wrap(async (req, res) => {
  await withTransaction(req.db, async (conn) => {
    await moveStatus(conn, req.params.id, 'Purchased', 'Received');
    const [[po]] = await conn.query('SELECT ticket_id, po_no FROM purchase_orders WHERE id = ?', [req.params.id]);
    const [items] = await conn.query('SELECT description, qty, unit FROM po_items WHERE po_id = ?', [req.params.id]);
    for (const it of items) {
      await stockIn(conn, { name: it.description, unit: it.unit, qty: it.qty, reason: `Received via P.O. ${po.po_no}`,
        poId: req.params.id, userId: req.user.id });
    }
    await conn.query(`UPDATE tickets SET status = 'Completed' WHERE id = ?`, [po.ticket_id]);
    await logActivity(conn, req.user.id, 'PO_RECEIVED', 'purchase_order', Number(req.params.id), `${items.length} line(s) stocked`);
    maybeFail(req);
  });
  res.json({ ok: true });
}));

module.exports = router;
