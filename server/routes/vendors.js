const router = require('express').Router();
const { requireRole } = require('../auth');
const { encrypt, decrypt, withTransaction, logActivity, HttpError } = require('../db');
const { wrap } = require('../util');

// Only these DB users hold SELECT on vendors.tin_enc (see sql/02_roles.sql).
const CAN_SEE_TIN = ['boss', 'accountant', 'po_officer'];

router.get('/', wrap(async (req, res) => {
  const cols = CAN_SEE_TIN.includes(req.user.role)
    ? `id, name, contact, ${decrypt('tin_enc')} AS tin`
    : 'id, name, contact';
  const [rows] = await req.db.query(`SELECT ${cols} FROM vendors ORDER BY name`);
  res.json(rows);
}));

router.post('/', requireRole('po_officer'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw new HttpError(400, 'Vendor name is required');
  const id = await withTransaction(req.db, async (conn) => {
    const tin = String(req.body.tin || '').trim();
    const [r] = await conn.query(
      `INSERT INTO vendors (name, contact, tin_enc) VALUES (?, ?, ${tin ? encrypt(tin) : 'NULL'})`,
      [name, req.body.contact || null]);
    await logActivity(conn, req.user.id, 'VENDOR_CREATED', 'vendor', r.insertId, name);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

module.exports = router;
