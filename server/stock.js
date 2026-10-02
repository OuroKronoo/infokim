const { HttpError } = require('./db');

// Adds qty to an inventory item, creating the item first if it does not exist yet, and writes the
// movement-log row. Plain SELECT then UPDATE/INSERT (not ON DUPLICATE KEY): the Inventory DB user
// holds UPDATE on qty_on_hand only, and MariaDB would demand UPDATE on every inserted column.
async function stockIn(conn, { name, unit, qty, reason, poId = null, projectId = null, userId }) {
  const [[found]] = await conn.query('SELECT id FROM inventory WHERE item_name = ? AND unit = ?', [name, unit]);
  let inventoryId;
  if (found) {
    inventoryId = found.id;
    await conn.query('UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?', [qty, inventoryId]);
  } else {
    const [ins] = await conn.query('INSERT INTO inventory (item_name, unit, qty_on_hand) VALUES (?, ?, ?)', [name, unit, qty]);
    inventoryId = ins.insertId;
  }
  await conn.query(
    'INSERT INTO inventory_log (inventory_id, po_id, project_id, change_qty, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [inventoryId, poId, projectId, qty, reason, userId]);
  return inventoryId;
}

// Removes qty from an item. The WHERE guard makes "not enough stock" a 0-row update, so two people
// releasing the last units at once can never take the balance below zero.
async function stockOut(conn, { inventoryId, qty, reason, projectId = null, userId }) {
  const [r] = await conn.query(
    'UPDATE inventory SET qty_on_hand = qty_on_hand - ? WHERE id = ? AND qty_on_hand >= ?', [qty, inventoryId, qty]);
  if (r.affectedRows === 0) {
    const [[item]] = await conn.query('SELECT item_name, unit, qty_on_hand FROM inventory WHERE id = ?', [inventoryId]);
    if (!item) throw new HttpError(404, 'Item not found');
    throw new HttpError(409, `Not enough stock: only ${item.qty_on_hand} ${item.unit} of ${item.item_name} on hand`);
  }
  await conn.query(
    'INSERT INTO inventory_log (inventory_id, po_id, project_id, change_qty, reason, created_by) VALUES (?, NULL, ?, ?, ?, ?)',
    [inventoryId, projectId, -qty, reason, userId]);
}

module.exports = { stockIn, stockOut };
