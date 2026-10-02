require('dotenv').config();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { poolFor, HttpError } = require('./db');

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

module.exports = { login, requireAuth, requireRole };
