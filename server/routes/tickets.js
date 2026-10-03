const router = require('express').Router();
const { requireRole } = require('../auth');
const { withTransaction, logActivity, HttpError } = require('../db');
const { wrap, validateItems } = require('../util');

const TICKET_SELECT = `
  SELECT t.id, CONCAT('TKT-', LPAD(t.id, 5, '0')) AS ticket_no, t.status, t.urgency, t.date_needed,
         t.remarks, t.created_at, t.project_id, t.requested_by AS requested_by_id, t.reject_reason, t.resubmit_count,
         p.name AS project, p.company, u.name AS requested_by,
         (SELECT COUNT(*) FROM ticket_items i WHERE i.ticket_id = t.id) AS item_count
  FROM tickets t
  JOIN projects p ON p.id = t.project_id
  JOIN users u    ON u.id = t.requested_by`;

// Engineers only see their own requests; every other role sees all.
router.get('/', wrap(async (req, res) => {
  const where = [], params = [];
  if (req.user.role === 'engineer') { where.push('t.requested_by = ?'); params.push(req.user.id); }
  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  const [rows] = await req.db.query(
    `${TICKET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.id DESC LIMIT 200`, params);
  res.json(rows);
}));

router.get('/projects', wrap(async (req, res) => {
  const [rows] = await req.db.query('SELECT id, company, name FROM projects ORDER BY company, name');
  res.json(rows);
}));

// Stock levels shown next to each material while the ticket is being filled in.
router.get('/availability', wrap(async (req, res) => {
  const [rows] = await req.db.query('SELECT item_name, unit, qty_on_hand FROM inventory ORDER BY item_name');
  res.json(rows);
}));

router.get('/:id', wrap(async (req, res) => {
  const [rows] = await req.db.query(`${TICKET_SELECT} WHERE t.id = ?`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Ticket not found');
  const [items] = await req.db.query('SELECT id, description, qty, unit FROM ticket_items WHERE ticket_id = ?', [req.params.id]);
  res.json({ ...rows[0], items });
}));

// Any signed-in role may file a ticket (same as the live system). Ticket + items are saved
// together or not at all, and every ticket starts at Pending Boss Approval.
function parseTicketBody(body) {
  const { project_id, urgency, date_needed, remarks } = body;
  const items = validateItems(body.items, false);
  if (!project_id) throw new HttpError(400, 'Choose a project');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date_needed || ''))) throw new HttpError(400, 'Set the date these materials are needed on site');
  return { project_id, urgency: urgency === 'urgent' ? 'urgent' : 'normal', date_needed, remarks: remarks || null, items };
}

router.post('/', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw new HttpError(403, 'The administrator role is read-only');
  const t = parseTicketBody(req.body);
  const id = await withTransaction(req.db, async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO tickets (project_id, requested_by, urgency, date_needed, remarks) VALUES (?, ?, ?, ?, ?)',
      [t.project_id, req.user.id, t.urgency, t.date_needed, t.remarks]);
    await conn.query('INSERT INTO ticket_items (ticket_id, description, qty, unit) VALUES ?',
      [t.items.map((i) => [r.insertId, i.description, i.qty, i.unit])]);
    await logActivity(conn, req.user.id, 'TICKET_CREATED', 'ticket', r.insertId, `${t.items.length} item(s)`);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

// The submitter edits a ticket the Boss rejected and sends it back to Pending Boss Approval.
// The stored procedure verifies ownership and status and replaces the header; the new items
// are inserted in the same transaction, so a failure leaves the rejected ticket untouched.
router.post('/:id/resubmit', wrap(async (req, res) => {
  if (req.user.role === 'admin') throw new HttpError(403, 'The administrator role is read-only');
  const t = parseTicketBody(req.body);
  await withTransaction(req.db, async (conn) => {
    await conn.query('CALL resubmit_ticket(?, ?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, t.project_id, t.urgency, t.date_needed, t.remarks]);
    await conn.query('INSERT INTO ticket_items (ticket_id, description, qty, unit) VALUES ?',
      [t.items.map((i) => [req.params.id, i.description, i.qty, i.unit])]);
    await logActivity(conn, req.user.id, 'TICKET_RESUBMITTED', 'ticket', Number(req.params.id), `${t.items.length} item(s)`);
    if (req.body.simulateFailure) throw new Error('Simulated failure just before COMMIT');
  });
  res.json({ ok: true });
}));

// Boss approves or rejects (a rejection needs a reason). The status guard in WHERE makes a double-click harmless.
router.patch('/:id/decision', requireRole('boss'), wrap(async (req, res) => {
  const approve = req.body.decision === 'approve';
  if (!approve && req.body.decision !== 'reject') throw new HttpError(400, 'decision must be approve or reject');
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (!approve && reason.length < 3) throw new HttpError(400, 'Give a reason so the submitter knows what to fix');
  await withTransaction(req.db, async (conn) => {
    const [r] = await conn.query(
      `UPDATE tickets SET status = ?, decided_by = ?, reject_reason = ? WHERE id = ? AND status = 'Pending Boss Approval'`,
      [approve ? 'Approved for PO' : 'Rejected by Boss', req.user.id, approve ? null : reason, req.params.id]);
    if (r.affectedRows === 0) throw new HttpError(409, 'Ticket is not waiting for approval');
    await logActivity(conn, req.user.id, approve ? 'TICKET_APPROVED' : 'TICKET_REJECTED', 'ticket', Number(req.params.id), approve ? null : reason);
  });
  res.json({ ok: true });
}));

module.exports = router;
