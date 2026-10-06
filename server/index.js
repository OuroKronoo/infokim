require('dotenv').config();
const path = require('path');
const express = require('express');
const { login, register, listRoles, requireAuth } = require('./auth');
const { HttpError } = require('./db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.post('/api/login', wrap(async (req, res) => res.json(await login(req.body.email, req.body.password))));

app.get('/api/roles', wrap(async (req, res) => res.json(await listRoles())));
app.post('/api/register', wrap(async (req, res) => res.status(201).json(await register(req.body))));

app.use('/api', requireAuth);
app.get('/api/me', (req, res) => res.json(req.user));
app.use('/api/tickets', require('./routes/tickets'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/reports', require('./routes/reports'));

app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

// MySQL privilege errors become 403s with the real MySQL message (useful for the demo).
const DENIED = new Set(['ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_SPECIFIC_ACCESS_DENIED_ERROR']);
app.use((err, req, res, next) => {
  let status = err.status || 500;
  if (DENIED.has(err.code) || err.code === 'ER_SIGNAL_EXCEPTION') status = 403;
  else if (err.code === 'ER_DUP_ENTRY') status = 409;
  else if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') status = 400;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.sqlMessage || err.message, code: err.code, rolledBack: !!err.rolledBack });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`RSCI SQL prototype running at http://localhost:${port}`));
