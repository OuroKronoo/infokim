require('dotenv').config();
const mysqlSync = require('mysql2');
const mysql = require('mysql2/promise');

const { DB_HOST = '127.0.0.1', DB_PORT = 3306, DB_NAME = 'rsci_sql',
        DB_ROLE_PASSWORD = 'Rsci#Demo2026', ENC_KEY } = process.env;
if (!ENC_KEY) throw new Error('ENC_KEY missing in .env');

// One pool per DB user. The app role of the logged-in person decides which pool
// runs their queries, so MySQL's GRANTs (sql/02_roles.sql) are the real gatekeeper.
const pools = {};
function poolFor(key) {
  if (!pools[key]) {
    pools[key] = mysql.createPool({
      host: DB_HOST, port: Number(DB_PORT), database: DB_NAME,
      user: `rsci_${key}`, password: DB_ROLE_PASSWORD,
      connectionLimit: 5, decimalNumbers: true, dateStrings: true,
    });
  }
  return pools[key];
}

// Encryption helpers: AES with a key derived from ENC_KEY (never stored in the DB).
const encrypt = (value) => `AES_ENCRYPT(${mysqlSync.escape(value)}, SHA2(${mysqlSync.escape(ENC_KEY)}, 256))`;
const decrypt = (col) => `CAST(AES_DECRYPT(${col}, SHA2(${mysqlSync.escape(ENC_KEY)}, 256)) AS CHAR)`;

// Criterion 2: run fn(conn) inside START TRANSACTION ... COMMIT; any error -> ROLLBACK.
async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); err.rolledBack = true; } catch { /* connection already gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

const logActivity = (conn, userId, action, entity, entityId, detail) =>
  conn.query('INSERT INTO activity_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entity, entityId, detail || null]);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

module.exports = { poolFor, encrypt, decrypt, withTransaction, logActivity, HttpError };
