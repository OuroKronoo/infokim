const { HttpError } = require('./db');

// Express 4 does not catch rejected promises from async handlers; this forwards them to the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

// Throws a 400 unless every item has a description, qty > 0 (and unit_price >= 0 when priced).
function validateItems(items, priced) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item');
  return items.map((i) => {
    const description = String(i.description || '').trim();
    const unit = String(i.unit || '').trim();
    if (!description || !unit || !positive(i.qty)) throw new HttpError(400, 'Each item needs a description, unit and quantity above 0');
    const out = { description, unit, qty: Number(i.qty) };
    if (priced) {
      if (!(Number(i.unit_price) >= 0)) throw new HttpError(400, 'Each item needs a unit price of 0 or more');
      out.unit_price = Number(i.unit_price);
    }
    return out;
  });
}

module.exports = { wrap, validateItems, positive };
