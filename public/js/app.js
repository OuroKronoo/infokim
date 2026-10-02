/* RSCI SQL prototype - single-page client. Plain JS, talks to /api (Express + MySQL). */
const token = sessionStorage.getItem('token');
const me = JSON.parse(sessionStorage.getItem('user') || 'null');
if (!token || !me) location.href = 'index.html';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s) => (s ? String(s).slice(0, 10) : '');
const simulate = () => $('simFail').checked;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { sessionStorage.clear(); location.href = 'index.html'; }
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.data = data; throw e; }
  return data;
}

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
// Surfaces the MySQL-level outcome (incl. ROLLBACK) to the user.
const fail = (e) => toast((e.data && e.data.rolledBack ? 'ROLLED BACK - nothing was saved. ' : '') + e.message, 'bad');

function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return { el: bg.firstChild, close: () => bg.remove() };
}

const badge = (s) => {
  const kind = /Approved|Completed|Received|Purchased/.test(s) ? 'good' : /Rejected/.test(s) ? 'bad' : /Pending/.test(s) ? 'warn' : 'info';
  return `<span class="badge ${kind}">${esc(s)}</span>`;
};
const table = (head, rows) => `<div class="tbl"><table><thead><tr>${head.map((h) => `<th${h.endsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/#$/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">Nothing here yet.</td></tr>`}</tbody></table></div>`;

/* ---------- navigation by role ---------- */
const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', roles: 'all' },
  { id: 'requests',  label: 'Requests', roles: 'all' },
  { id: 'pos',       label: 'Purchase Orders', roles: ['boss', 'om', 'po_officer', 'accountant', 'inventory'] },
  { id: 'vendors',   label: 'Vendors', roles: ['boss', 'om', 'po_officer', 'accountant', 'engineer', 'inventory'] },
  { id: 'inventory', label: 'Inventory', roles: ['boss', 'om', 'inventory'] },
  { id: 'expenses',  label: 'Expenses', roles: ['boss', 'om', 'accountant'] },
  { id: 'activity',  label: 'Activity Log', roles: ['boss', 'om'] },
];
const allowed = VIEWS.filter((v) => v.roles === 'all' || v.roles.includes(me.role));

$('meName').textContent = me.name;
$('meRole').textContent = me.role.replace('_', ' ');
$('logout').onclick = () => { sessionStorage.clear(); location.href = 'index.html'; };
$('nav').innerHTML = allowed.map((v) => `<button data-v="${v.id}">${esc(v.label)}</button>`).join('');
$('nav').onclick = (e) => { if (e.target.dataset.v) go(e.target.dataset.v); };

async function go(id) {
  const v = allowed.find((x) => x.id === id) || allowed[0];
  [...$('nav').children].forEach((b) => b.classList.toggle('on', b.dataset.v === v.id));
  $('title').textContent = v.label;
  location.hash = v.id;
  $('view').innerHTML = '<p class="muted">Loading...</p>';
  try { await render[v.id](); } catch (e) { $('view').innerHTML = `<div class="card"><b>Could not load this page.</b><p class="err">${esc(e.message)}</p></div>`; }
}
const refresh = () => go(location.hash.slice(1));

/* ---------- views ---------- */
const render = {
  async dashboard() {
    const d = await api('/reports/dashboard');
    const cards = (rows) => rows.map((r) => `<div class="stat"><span>${esc(r.status)}</span><b>${r.n}</b></div>`).join('') || '<p class="muted">No records.</p>';
    $('view').innerHTML = `
      <h3>Requests</h3><div class="stats">${cards(d.tickets)}</div>
      ${d.pos ? `<h3>Purchase Orders</h3><div class="stats">${cards(d.pos)}</div>` : ''}`;
  },

  async requests() {
    const rows = await api('/tickets');
    const act = (t) => {
      const a = [`<button class="btn ghost sm" onclick="actions.viewTicket(${t.id})">View</button>`];
      if (me.role === 'boss' && t.status === 'Pending Boss Approval') {
        a.push(`<button class="btn ok sm" onclick="actions.decideTicket(${t.id},'approve')">Approve</button>`,
               `<button class="btn no sm" onclick="actions.rejectTicket(${t.id})">Reject</button>`);
      }
      if (t.requested_by_id === me.id && t.status === 'Rejected by Boss') a.push(`<button class="btn blue sm" onclick="actions.openTicketForm(${t.id})">Edit &amp; resubmit</button>`);
      if (me.role === 'po_officer' && t.status === 'Approved for PO') a.push(`<button class="btn sm" onclick="actions.newPO(${t.id})">Create P.O.</button>`);
      return `<div class="acts">${a.join('')}</div>`;
    };
    $('view').innerHTML = `
      <div class="acts" style="margin-bottom:14px"><button class="btn" onclick="actions.openTicketForm()">Submit a ticket</button></div>
      <div id="ticket-form"></div>
      <div class="card"><h3>${me.role === 'engineer' ? 'My requests' : 'All requests'}</h3>
      ${table(['Ticket', 'Project', 'By', 'Items#', 'Urgency', 'Needed', 'Status', ''], rows.map((t) => `<tr>
        <td><b>${esc(t.ticket_no)}</b></td><td>${esc(t.company)}<br><span class="muted">${esc(t.project)}</span></td>
        <td>${esc(t.requested_by)}</td><td class="num">${t.item_count}</td>
        <td>${t.urgency === 'urgent' ? '<span class="badge bad">urgent</span>' : 'normal'}</td>
        <td>${esc(day(t.date_needed))}</td>
        <td>${badge(t.status)}${t.status === 'Rejected by Boss' && t.reject_reason ? `<br><span class="muted">${esc(t.reject_reason)}</span>` : ''}</td>
        <td>${act(t)}</td></tr>`))}</div>`;
  },

  async pos() {
    const rows = await api('/purchase-orders');
    const act = (p) => {
      const a = [`<button class="btn ghost sm" onclick="actions.viewPO(${p.id})">View</button>`];
      if (['boss', 'om'].includes(me.role) && p.status === 'Pending Approval') {
        a.push(`<button class="btn ok sm" onclick="actions.decidePO(${p.id},'approve')">Approve</button>`,
               `<button class="btn no sm" onclick="actions.decidePO(${p.id},'reject')">Reject</button>`);
      }
      if (me.role === 'accountant' && p.status === 'Approved') a.push(`<button class="btn blue sm" onclick="actions.confirmPurchase(${p.id})">Confirm purchased</button>`);
      if (me.role === 'inventory' && p.status === 'Purchased') a.push(`<button class="btn sm" onclick="actions.receivePO(${p.id})">Receive into stock</button>`);
      return `<div class="acts">${a.join('')}</div>`;
    };
    $('view').innerHTML = `<div class="card">${table(['P.O. No.', 'Ticket', 'Project', 'Vendor', 'Total#', 'Status', ''],
      rows.map((p) => `<tr><td><b>${esc(p.po_no)}</b></td><td>${esc(p.ticket_no)}</td><td>${esc(p.project)}</td>
        <td>${esc(p.vendor)}</td><td class="num">${peso(p.total)}</td><td>${badge(p.status)}</td><td>${act(p)}</td></tr>`))}</div>`;
  },

  async vendors() {
    const rows = await api('/vendors');
    const showTin = rows[0] && 'tin' in rows[0];
    $('view').innerHTML = `
      ${me.role === 'po_officer' ? `<div class="card"><h3>Add vendor</h3><div class="row">
        <div><label>Name</label><input id="v-name"></div><div><label>Contact</label><input id="v-contact"></div>
        <div><label>TIN</label><input id="v-tin"></div>
        <div style="flex:0"><button class="btn" onclick="actions.addVendor()">Save</button></div></div></div>` : ''}
      <div class="card">${table(['Vendor', 'Contact', ...(showTin ? ['TIN (decrypted)'] : [])], rows.map((v) =>
        `<tr><td>${esc(v.name)}</td><td>${esc(v.contact)}</td>${showTin ? `<td>${esc(v.tin)}</td>` : ''}</tr>`))}</div>`;
  },

  async inventory() {
    const [stock, log] = await Promise.all([api('/inventory'), api('/inventory/log')]);
    const canMove = me.role === 'inventory';
    inventoryItems = stock;
    $('view').innerHTML = `
      ${canMove ? '<div class="acts" style="margin-bottom:14px"><button class="btn ok" onclick="actions.stockModal(\'in\')">Stock in</button><button class="btn no" onclick="actions.stockModal(\'out\')">Stock out</button></div>' : ''}
      <div class="card"><h3>Stock on hand</h3>${table(['Item', 'Unit', 'Qty#', ...(canMove ? [''] : [])], stock.map((i) =>
        `<tr><td>${esc(i.item_name)}</td><td>${esc(i.unit)}</td><td class="num">${i.qty_on_hand}</td>${canMove
          ? `<td><div class="acts"><button class="btn ghost sm" onclick="actions.stockModal('in', ${i.id})">In</button><button class="btn ghost sm" onclick="actions.stockModal('out', ${i.id})">Out</button></div></td>` : ''}</tr>`))}</div>
      <div class="card"><h3>Movement log</h3>${table(['When', 'Item', 'Type', 'Change#', 'Project', 'Reason', 'By'], log.map((l) =>
        `<tr><td>${esc(l.created_at)}</td><td>${esc(l.item_name)}</td>
          <td>${l.change_qty < 0 ? '<span class="badge bad">OUT</span>' : '<span class="badge good">IN</span>'}</td>
          <td class="num">${l.change_qty > 0 ? '+' : ''}${l.change_qty}</td><td>${esc(l.project || '')}</td><td>${esc(l.reason)}</td><td>${esc(l.by_user)}</td></tr>`))}</div>`;
  },

  async expenses() {
    $('view').innerHTML = `
      <div class="card"><h3>General Expenses by project</h3>
        <div class="row"><div><label>From</label><input type="date" id="ex-from" value="2026-03-01"></div>
        <div><label>To</label><input type="date" id="ex-to" value="2026-03-31"></div>
        <div style="flex:0"><button class="btn" onclick="actions.runExpenses()">Run report</button></div></div></div>
      <div id="ex-out"></div>`;
    await actions.runExpenses();
  },

  async activity() {
    const rows = await api('/reports/activity');
    $('view').innerHTML = `<div class="card">${table(['When', 'User', 'Action', 'Entity', 'Detail'], rows.map((a) =>
      `<tr><td>${esc(a.created_at)}</td><td>${esc(a.user)}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.entity)} #${esc(a.entity_id)}</td><td>${esc(a.detail)}</td></tr>`))}</div>`;
  },
};

/* ---------- forms ---------- */
/* Ticket form (same fields and flow as the live RSCI site): manager, project, date needed,
   urgent flag, materials with a stock check, then Preview -> Confirm & Submit. */
let ticketStock = [];
let ticketDraft = null;
let ticketEditId = null;
let inventoryItems = [];

// `t` is the rejected ticket when editing, undefined when filing a new one.
function ticketForm(projects, t) {
  return `<div class="card"><h3>${t ? `Edit &amp; resubmit ${esc(t.ticket_no)}` : 'Submit a ticket'}</h3>
    ${t ? `<div class="hint"><b>Rejected by the Boss:</b> ${esc(t.reject_reason || 'no reason given')}</div>` : ''}
    <datalist id="inv-names">${ticketStock.map((s) => `<option value="${esc(s.item_name)}">`).join('')}</datalist>
    <div class="row">
      <div><label>Project Manager</label><input id="tk-pm" value="${esc(me.name)}" readonly></div>
      <div><label>Project Name</label><select id="tk-project"><option value="">Select a project...</option>
        ${projects.map((p) => `<option value="${p.id}"${t && t.project_id === p.id ? ' selected' : ''}>${esc(p.name)} (${esc(p.company)})</option>`).join('')}</select></div>
      <div><label>Date Needed</label><input type="date" id="tk-needed" value="${t ? esc(day(t.date_needed)) : ''}"></div>
    </div>
    <label class="check"><input type="checkbox" id="tk-urgent"${t && t.urgency === 'urgent' ? ' checked' : ''}> Mark as urgent</label>
    <label>Materials List</label><div id="mat-entries"></div>
    <button class="btn ghost sm" type="button" onclick="addMatRow()">+ Add material</button>
    <label>Remarks (optional)</label><input id="tk-remarks" maxlength="500" placeholder="Additional notes" value="${t ? esc(t.remarks) : ''}">
    <div class="err" id="tk-err" role="alert"></div>
    <div class="acts" style="margin-top:12px"><button class="btn ghost" onclick="actions.closeTicketForm()">Cancel</button>
      <button class="btn" onclick="actions.previewTicket()">Preview</button></div></div>`;
}

// Stock check shown next to each material, like the live site's availability pill.
function stockStatus(name, qty) {
  const item = ticketStock.find((s) => s.item_name.toLowerCase() === name.trim().toLowerCase());
  if (!name.trim()) return { item, cls: '', text: '-' };
  if (!item) return { item, cls: 'info', text: 'Not in inventory yet' };
  if (!(qty > 0)) return { item, cls: 'info', text: `${item.qty_on_hand} in stock` };
  if (item.qty_on_hand >= qty) return { item, cls: 'good', text: 'In stock' };
  if (item.qty_on_hand > 0) return { item, cls: 'warn', text: `Only ${item.qty_on_hand} in stock` };
  return { item, cls: 'bad', text: 'Out of stock' };
}

function addMatRow(prefill) {
  const d = document.createElement('div');
  d.className = 'row mat-row';
  d.style.marginBottom = '8px';
  d.innerHTML = `<div style="flex:3"><label>Material Name</label><input class="m-name" list="inv-names" placeholder="Type to search inventory" oninput="updateAvail(this)"></div>
    <div><label>Quantity</label><input class="m-qty" type="number" min="1" step="1" placeholder="0" oninput="updateAvail(this)"></div>
    <div><label>Unit</label><input class="m-unit" placeholder="pc, bag, kg"></div>
    <div><label>Availability</label><div class="m-av"><span class="badge">-</span></div></div>
    <button class="btn ghost sm" style="flex:0" type="button" aria-label="Remove material" onclick="this.parentElement.remove()">x</button>`;
  $('mat-entries').appendChild(d);
  if (prefill) {
    d.querySelector('.m-name').value = prefill.description;
    d.querySelector('.m-qty').value = prefill.qty;
    d.querySelector('.m-unit').value = prefill.unit;
    updateAvail(d.querySelector('.m-qty'));
  }
}

function updateAvail(input) {
  const row = input.closest('.mat-row');
  const name = row.querySelector('.m-name').value;
  const qty = Number(row.querySelector('.m-qty').value);
  const s = stockStatus(name, qty);
  const unitEl = row.querySelector('.m-unit');
  if (s.item && !unitEl.value) unitEl.value = s.item.unit;
  row.querySelector('.m-av').innerHTML = `<span class="badge ${s.cls}">${esc(s.text)}</span>`;
}

function addItemRow(containerId, v = {}, priced = false) {
  const d = document.createElement('div');
  d.className = 'row';
  d.style.marginBottom = '6px';
  d.innerHTML = `<input class="i-desc" placeholder="Description" value="${esc(v.description)}" style="flex:3">
    <input class="i-qty" type="number" min="0.01" step="0.01" placeholder="Qty" value="${esc(v.qty)}">
    <input class="i-unit" placeholder="Unit" value="${esc(v.unit)}">
    ${priced ? '<input class="i-price" type="number" min="0" step="0.01" placeholder="Unit price">' : ''}
    <button class="btn ghost sm" style="flex:0" type="button" onclick="this.parentElement.remove()">x</button>`;
  $(containerId).appendChild(d);
}
const readItems = (id) => [...$(id).children].map((r) => ({
  description: r.querySelector('.i-desc').value, qty: r.querySelector('.i-qty').value, unit: r.querySelector('.i-unit').value,
  unit_price: r.querySelector('.i-price') ? r.querySelector('.i-price').value : undefined,
}));

/* ---------- actions ---------- */
const actions = {
  // No argument: file a new ticket. With a ticket id: edit that rejected ticket and resubmit it.
  async openTicketForm(editId) {
    try {
      const [projects, stock, t] = await Promise.all([api('/tickets/projects'), api('/tickets/availability'), editId ? api('/tickets/' + editId) : null]);
      ticketStock = stock;
      $('ticket-form').innerHTML = ticketForm(projects, t);
      ticketEditId = editId || null;
      if (t) t.items.forEach((i) => addMatRow(i)); else addMatRow();
      $('ticket-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('tk-project').focus();
    } catch (e) { fail(e); }
  },

  closeTicketForm() { $('ticket-form').innerHTML = ''; ticketEditId = null; },

  // Stock in (delivery, return from site, new item) or stock out (release to a project, damage, usage).
  async stockModal(kind, itemId) {
    const isIn = kind === 'in';
    const item = inventoryItems.find((i) => i.id === itemId);
    const projects = isIn ? [] : await api('/tickets/projects');
    const m = modal(`<h3>${isIn ? 'Stock in' : 'Stock out'}</h3>
      <datalist id="stock-names">${inventoryItems.map((i) => `<option value="${esc(i.item_name)}">`).join('')}</datalist>
      ${isIn ? `<div class="row"><div style="flex:3"><label>Item (new names create the item)</label><input id="st-name" list="stock-names" value="${item ? esc(item.item_name) : ''}"></div>
          <div><label>Unit</label><input id="st-unit" value="${item ? esc(item.unit) : ''}" placeholder="pc, bag, kg"></div></div>`
        : `<label>Item</label><select id="st-item">${inventoryItems.filter((i) => i.qty_on_hand > 0).map((i) =>
            `<option value="${i.id}"${item && item.id === i.id ? ' selected' : ''}>${esc(i.item_name)} (${i.qty_on_hand} ${esc(i.unit)} on hand)</option>`).join('')}</select>
          <label>Project (optional)</label><select id="st-project"><option value="">No project</option>${projects.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.company)})</option>`).join('')}</select>`}
      <label>Quantity</label><input id="st-qty" type="number" min="0.01" step="0.01">
      <label>Reason</label><input id="st-reason" maxlength="200" placeholder="${isIn ? 'e.g. Returned from site' : 'e.g. Released to site'}">
      <div class="err" id="st-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="st-cancel">Cancel</button><button class="btn ${isIn ? 'ok' : 'no'}" id="st-ok">${isIn ? 'Add to stock' : 'Release stock'}</button></div>`);
    $('st-cancel').onclick = m.close;
    $('st-ok').onclick = async () => {
      const body = isIn
        ? { item_name: $('st-name').value, unit: $('st-unit').value, qty: $('st-qty').value, reason: $('st-reason').value }
        : { inventory_id: $('st-item').value, project_id: $('st-project').value, qty: $('st-qty').value, reason: $('st-reason').value };
      try {
        await api(isIn ? '/inventory/stock-in' : '/inventory/stock-out', 'POST', { ...body, simulateFailure: simulate() });
        m.close(); toast(isIn ? 'Stock added' : 'Stock released', 'good'); refresh();
      } catch (e) { $('st-err').textContent = (e.data && e.data.rolledBack ? 'ROLLED BACK: ' : '') + e.message; }
    };
  },

  previewTicket() {
    const fail_ = (msg) => { $('tk-err').textContent = msg; };
    const projectSel = $('tk-project');
    const needed = $('tk-needed').value;
    if (!projectSel.value) return fail_('Pick a project.');
    if (!needed) return fail_('Set the date these materials are needed on site.');
    const items = [...document.querySelectorAll('#mat-entries .mat-row')].map((r) => ({
      description: r.querySelector('.m-name').value.trim(), qty: Number(r.querySelector('.m-qty').value), unit: r.querySelector('.m-unit').value.trim(),
    })).filter((i) => i.description || i.qty || i.unit);
    if (!items.length) return fail_('Add at least one material.');
    if (items.some((i) => !i.description || !(i.qty > 0) || !i.unit)) return fail_('Each material needs a name, a quantity above 0 and a unit.');
    $('tk-err').textContent = '';
    const opt = projectSel.selectedOptions[0].textContent;
    ticketDraft = { project_id: projectSel.value, date_needed: needed, urgency: $('tk-urgent').checked ? 'urgent' : 'normal',
      remarks: $('tk-remarks').value.trim(), items };
    const resubmitting = !!ticketEditId;
    const m = modal(`<h3>${resubmitting ? 'Preview resubmission' : 'Preview ticket'}</h3>
      <p><b>${esc(opt)}</b>${ticketDraft.urgency === 'urgent' ? ' <span class="badge bad">URGENT</span>' : ''}</p>
      <p class="muted">Manager: ${esc(me.name)} · Needed on site: ${esc(needed)}</p>
      ${ticketDraft.remarks ? `<p style="margin:8px 0">${esc(ticketDraft.remarks)}</p>` : ''}
      ${table(['Material', 'Qty#', 'Unit', 'Availability'], items.map((i) => {
        const s = stockStatus(i.description, i.qty);
        return `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td>${esc(i.unit)}</td><td><span class="badge ${s.cls}">${esc(s.text)}</span></td></tr>`;
      }))}
      <div class="err" id="tk-confirm-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="tk-edit">Edit</button><button class="btn" id="tk-confirm">${resubmitting ? 'Confirm &amp; Resubmit' : 'Confirm &amp; Submit'}</button></div>`);
    $('tk-edit').onclick = m.close;
    $('tk-confirm').onclick = async () => {
      $('tk-confirm').disabled = true;
      try {
        const r = resubmitting
          ? await api(`/tickets/${ticketEditId}/resubmit`, 'POST', { ...ticketDraft, simulateFailure: simulate() })
          : await api('/tickets', 'POST', ticketDraft);
        m.close();
        toast(resubmitting ? 'Ticket resubmitted to the Boss' : 'Ticket submitted. Ref: TKT-' + String(r.id).padStart(5, '0'), 'good');
        refresh();
      } catch (e) {
        $('tk-confirm').disabled = false;
        $('tk-confirm-err').textContent = (e.data && e.data.rolledBack ? 'ROLLED BACK: ' : '') + e.message;
      }
    };
  },

  async viewTicket(id) {
    const t = await api('/tickets/' + id);
    modal(`<h3>${esc(t.ticket_no)} - ${esc(t.project)}</h3><p class="muted">${esc(t.company)} · by ${esc(t.requested_by)} · ${badge(t.status)}${t.resubmit_count ? ` · resubmitted ${t.resubmit_count}x` : ''}</p>
      ${t.status === 'Rejected by Boss' ? `<div class="hint" style="margin-top:8px"><b>Rejected:</b> ${esc(t.reject_reason || 'no reason given')}</div>` : ''}
      ${t.remarks ? `<p style="margin:8px 0">${esc(t.remarks)}</p>` : ''}
      ${table(['Item', 'Qty#', 'Unit'], t.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td>${esc(i.unit)}</td></tr>`))}`);
  },

  async decideTicket(id, decision, reason) {
    try { await api(`/tickets/${id}/decision`, 'PATCH', { decision, reason }); toast('Request ' + decision + 'd', 'good'); refresh(); } catch (e) { fail(e); }
  },

  rejectTicket(id) {
    const m = modal(`<h3>Reject request</h3>
      <label for="rj-reason">Reason (the submitter sees this and can edit and resubmit)</label>
      <textarea id="rj-reason" rows="3" maxlength="300"></textarea>
      <div class="err" id="rj-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="rj-cancel">Cancel</button><button class="btn no" id="rj-ok">Reject</button></div>`);
    $('rj-reason').focus();
    $('rj-cancel').onclick = m.close;
    $('rj-ok').onclick = async () => {
      try {
        await api(`/tickets/${id}/decision`, 'PATCH', { decision: 'reject', reason: $('rj-reason').value });
        m.close(); toast('Request rejected', 'good'); refresh();
      } catch (e) { $('rj-err').textContent = e.message; }
    };
  },

  async newPO(ticketId) {
    const [t, vendors] = await Promise.all([api('/tickets/' + ticketId), api('/vendors')]);
    const m = modal(`<h3>Create P.O. for ${esc(t.ticket_no)}</h3>
      <div class="row"><div><label>P.O. number (must be unique)</label><input id="po-no" placeholder="e.g. PO-2026-0001"></div>
      <div><label>Vendor</label><select id="po-vendor">${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div></div>
      <label>Items and prices</label><div id="po-items" class="items-edit"></div>
      <div class="err" id="po-err"></div>
      <div class="acts"><button class="btn ghost" id="po-cancel">Cancel</button><button class="btn" id="po-save">Save P.O.</button></div>`);
    t.items.forEach((i) => addItemRow('po-items', i, true));
    $('po-cancel').onclick = m.close;
    $('po-save').onclick = async () => {
      try {
        await api('/purchase-orders', 'POST', { po_no: $('po-no').value, ticket_id: ticketId, vendor_id: $('po-vendor').value,
          items: readItems('po-items'), simulateFailure: simulate() });
        m.close(); toast('P.O. created', 'good'); refresh();
      } catch (e) { $('po-err').textContent = (e.data && e.data.rolledBack ? 'ROLLED BACK: ' : '') + e.message; }
    };
  },

  async viewPO(id) {
    const p = await api('/purchase-orders/' + id);
    modal(`<h3>${esc(p.po_no)} - ${esc(p.vendor)}</h3><p class="muted">${esc(p.project)} · ${esc(p.ticket_no)} · ${badge(p.status)}</p>
      ${table(['Item', 'Qty#', 'Unit', 'Price#', 'Total#'], p.items.map((i) =>
        `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td>${esc(i.unit)}</td><td class="num">${peso(i.unit_price)}</td><td class="num">${peso(i.line_total)}</td></tr>`))}
      <p class="num" style="margin-top:10px"><b>Total ${peso(p.total)}</b></p>`);
  },

  async decidePO(id, decision) {
    try { await api(`/purchase-orders/${id}/decision`, 'PATCH', { decision }); toast('P.O. ' + decision + 'd', 'good'); refresh(); } catch (e) { fail(e); }
  },

  confirmPurchase(id) {
    const m = modal(`<h3>Confirm purchase</h3>
      <label>Check / reference no.</label><input id="chk">
      <div class="err" id="chk-err"></div>
      <div class="acts"><button class="btn ghost" id="chk-cancel">Cancel</button><button class="btn blue" id="chk-ok">Confirm</button></div>`);
    $('chk-cancel').onclick = m.close;
    $('chk-ok').onclick = async () => {
      try {
        await api(`/purchase-orders/${id}/confirm-purchase`, 'POST', { check_no: $('chk').value, simulateFailure: simulate() });
        m.close(); toast('Payment recorded', 'good'); refresh();
      } catch (e) { $('chk-err').textContent = (e.data && e.data.rolledBack ? 'ROLLED BACK: ' : '') + e.message; }
    };
  },

  async receivePO(id) {
    try { await api(`/purchase-orders/${id}/receive`, 'POST', { simulateFailure: simulate() }); toast('Stock updated', 'good'); refresh(); } catch (e) { fail(e); }
  },

  async addVendor() {
    try {
      await api('/vendors', 'POST', { name: $('v-name').value, contact: $('v-contact').value, tin: $('v-tin').value });
      toast('Vendor saved', 'good'); refresh();
    } catch (e) { fail(e); }
  },

  async runExpenses() {
    try {
      const rows = await api(`/reports/expenses-summary?from=${$('ex-from').value}&to=${$('ex-to').value}`);
      $('ex-out').innerHTML = `<div class="card">${table(['Company', 'Project', 'Entries#', 'Total#'], rows.map((r) =>
        `<tr><td>${esc(r.company)}</td><td>${esc(r.project)}</td><td class="num">${r.entries}</td><td class="num">${peso(r.total)}</td></tr>`))}</div>`;
    } catch (e) { fail(e); }
  },
};

go(location.hash.slice(1) || 'dashboard');
