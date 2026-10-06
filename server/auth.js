require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { poolFor, withTransaction, encrypt, logActivity, HttpError } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET missing in .env');

async function login(email, password) {
  const [rows] = await poolFor('auth').query(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = ?', [String(email || '').trim().toLowerCase()]);
  const user = rows[0];
  // Same message for unknown email and wrong password: don't reveal which accounts exist.
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  const profile = { id: user.id, name: user.name, email: user.email, role: user.role };
  return { token: jwt.sign(profile, JWT_SECRET, { expiresIn: '8h' }), user: profile };
}

// Roles people may pick on the registration form. The list lives in the `roles` table
// (sql/01_schema.sql), so changing the SQL file changes the form.
async function listRoles() {
  const [rows] = await poolFor('auth').query(
    'SELECT code, label, description FROM roles WHERE self_register = 1 ORDER BY sort_order');
  return rows;
}

// Create an account. Runs as the rsci_auth DB user, which can only INSERT the columns in 02_roles.sql.
// User row + audit-log row are one transaction: both are saved, or neither.
async function register({ name, email, phone, role, password }) {
  name = String(name || '').trim();
  email = String(email || '').trim().toLowerCase();
  phone = String(phone || '').trim();
  role = String(role || '').trim();
  password = String(password || '');
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Enter your full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw new HttpError(400, 'Enter a valid email address');
  if (phone.length > 30) throw new HttpError(400, 'Phone number is too long');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (!(await listRoles()).some((r) => r.code === role)) throw new HttpError(400, 'Choose a role from the list');

  const hash = await bcrypt.hash(password, 10);   // one-way: the database never sees the real password
  let id;
  try {
    id = await withTransaction(poolFor('auth'), async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO users (name, email, password_hash, role, phone_enc) VALUES (?, ?, ?, ?, ${phone ? encrypt(phone) : 'NULL'})`,
        [name, email, hash, role]);
      await logActivity(conn, r.insertId, 'USER_REGISTERED', 'user', r.insertId, `role ${role}`);
      return r.insertId;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'That email is already registered');
    throw err;
  }
  const profile = { id, name, email, role };
  return { token: jwt.sign(profile, JWT_SECRET, { expiresIn: '8h' }), user: profile };
}

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return next(new HttpError(401, 'Please sign in'));
  }
  req.db = poolFor(req.user.role);
  next();
}

// App-level check on top of the DB grants (gives a friendly 403 before MySQL has to).
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, `Role "${req.user.role}" cannot do this`));

module.exports = { login, register, listRoles, requireAuth, requireRole };
