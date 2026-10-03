/* RSCI SQL prototype - single-page client. Plain JS, talks to /api (Express + MySQL). */
const token = sessionStorage.getItem('token');
const me = JSON.parse(sessionStorage.getItem('user') || 'null');
if (!token || !me) location.href = 'index.html';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (s) => (s ? String(s).slice(0, 10) : '');
const simulate = () => $('simFail').checked;

let lastQueryMs = null;   // server-measured time of the last report query (X-Query-Ms header)

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = r.headers.get('X-Query-Ms');
  if (ms) lastQueryMs = ms;
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { sessionStorage.clear(); location.href = 'index.html'; }
  if (!r.ok) { const e = new Error(data.error || r.statusText); e.data = data; throw e; }
  return data;
}

function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}
// Surfaces the MySQL-level outcome (incl. ROLLBACK) to the user.
const fail = (e) => toast((e.data && e.data.rolledBack ? 'ROLLED BACK. Nothing was saved. ' : '') + e.message, 'bad');

function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  const first = bg.querySelector('input, select, textarea, button');
  if (first) first.focus();
  return { el: bg.firstChild, close: () => bg.remove() };
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelectorAll('.modal-bg');
  if (open.length) open[open.length - 1].remove();
});

const badge = (s) => {
  const kind = /^(Approved|Completed|Received)/.test(s) ? 'good' : /Rejected/.test(s) ? 'bad' : /Pending/.test(s) ? 'warn' : 'info';
  return `<span class="badge ${kind}">${esc(s)}</span>`;
};
// A header ending in # is right-aligned (numbers). `empty` explains why the table is empty and what fills it.
const table = (head, rows, empty = 'Nothing to show.') =>
  `<div class="tbl"><table><thead><tr>${head.map((h) => `<th${h.endsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/#$/, ''))}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">${esc(empty)}</td></tr>`}</tbody></table></div>`;

/* ---------- navigation by role ---------- */
const ROLE_LABEL = { boss: 'Boss', om: 'Operations Manager', engineer: 'Engineer', po_officer: 'PO Officer', accountant: 'Accountant', inventory: 'Inventory', admin: 'Administrator' };
const VIEWS = [
  { id: 'dashboard', label: 'Dashboard', roles: 'all' },
  { id: 'requests',  label: 'Requests', roles: 'all' },
  { id: 'pos',       label: 'Purchase Orders', roles: ['boss', 'om', 'po_officer', 'accountant', 'inventory', 'admin'] },
  { id: 'vendors',   label: 'Vendors', roles: ['boss', 'om', 'po_officer', 'accountant', 'engineer', 'inventory', 'admin'] },
  { id: 'inventory', label: 'Inventory', roles: ['boss', 'om', 'inventory', 'admin'] },
  { id: 'expenses',  label: 'Expenses', roles: ['boss', 'om', 'accountant', 'admin'] },
  { id: 'activity',  label: 'Activity Log', roles: ['boss', 'om', 'admin'] },
];
const allowed = VIEWS.filter((v) => v.roles === 'all' || v.roles.includes(me.role));

$('meName').textContent = me.name;
$('meRole').textContent = ROLE_LABEL[me.role] || me.role;
$('meDb').textContent = 'rsci_' + me.role;
if (me.role === 'admin') document.querySelector('.sim').hidden = true;   // read-only role: nothing to simulate
$('logout').onclick = () => { sessionStorage.clear(); location.href = 'index.html'; };
$('nav').innerHTML = allowed.map((v) => `<button data-v="${v.id}">${esc(v.label)}<span class="navcount" hidden></span></button>`).join('');
$('nav').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };

/* ---------- what is waiting on the signed-in role ---------- */
const QUEUE_RULES = {
  engineer:   { tickets: (t) => t.status === 'Rejected by Boss' && t.requested_by_id === me.id },
  boss:       { tickets: (t) => t.status === 'Pending Boss Approval', pos: (p) => p.status === 'Pending Approval' },
  om:         { pos: (p) => p.status === 'Pending Approval' },
  po_officer: { tickets: (t) => t.status === 'Approved for PO' },
  accountant: { pos: (p) => p.status === 'Approved' },
  inventory:  { pos: (p) => p.status === 'Purchased' },
};
const QUEUE_EMPTY = {
  engineer: 'Nothing to fix. If the Boss rejects one of your tickets, it appears here with the reason.',
  boss: 'No requests or purchase orders are waiting for your decision.',
  om: 'No purchase orders are waiting for approval.',
  po_officer: 'No approved tickets are waiting for a purchase order. They appear here once the Boss approves a request.',
  accountant: 'No approved purchase orders are waiting for payment. They appear here once the Boss or OM approves one.',
  inventory: 'No purchased orders are waiting to be received into stock.',
};
let data = { tickets: [], pos: [] };

async function loadData() {
  const [tickets, pos] = await Promise.all([api('/tickets'), me.role === 'engineer' ? [] : api('/purchase-orders')]);
  data = { tickets, pos };
  updateNavCounts();
  return data;
}
function queue() {
  const rule = QUEUE_RULES[me.role] || {};
  return { tickets: rule.tickets ? data.tickets.filter(rule.tickets) : [], pos: rule.pos ? data.pos.filter(rule.pos) : [] };
}
function updateNavCounts() {
  const q = queue();
  const set = (view, n) => {
    const el = $('nav').querySelector(`[data-v="${view}"] .navcount`);
    if (!el) return;
    el.textContent = n;
    el.hidden = n === 0;
  };
  set('requests', q.tickets.length);
  set('pos', q.pos.length);
}

async function go(id) {
  const v = allowed.find((x) => x.id === id) || allowed[0];
  [...$('nav').children].forEach((b) => b.classList.toggle('on', b.dataset.v === v.id));
  $('title').textContent = v.label;
  location.hash = v.id;
  $('view').innerHTML = `<p class="muted">Loading ${esc(v.label.toLowerCase())}...</p>`;
  try { await render[v.id](); }
  catch (e) {
    $('view').innerHTML = `<div class="card"><h3>Could not load ${esc(v.label.toLowerCase())}</h3><p class="err">${esc(e.message)}</p>
      <button class="btn ghost sm" onclick="refresh()">Try again</button></div>`;
  }
}
const refresh = () => go(location.hash.slice(1));

/* ---------- row actions, shared by the tables and the dashboard queue ---------- */
function ticketActions(t) {
  const a = [`<button class="btn ghost sm" onclick="actions.viewTicket(${t.id})">View</button>`];
  if (me.role === 'boss' && t.status === 'Pending Boss Approval') {
    a.push(`<button class="btn sm" onclick="actions.decideTicket(${t.id},'approve')">Approve</button>`,
           `<button class="btn no sm" onclick="actions.rejectTicket(${t.id})">Reject</button>`);
  }
  if (t.requested_by_id === me.id && t.status === 'Rejected by Boss') a.push(`<button class="btn sm" onclick="actions.openTicketForm(${t.id})">Edit &amp; resubmit</button>`);
  if (me.role === 'po_officer' && t.status === 'Approved for PO') a.push(`<button class="btn sm" onclick="actions.newPO(${t.id})">Create P.O.</button>`);
  return `<div class="acts">${a.join('')}</div>`;
}
function poActions(p) {
  const a = [`<button class="btn ghost sm" onclick="actions.viewPO(${p.id})">View</button>`];
  if (['boss', 'om'].includes(me.role) && p.status === 'Pending Approval') {
    a.push(`<button class="btn sm" onclick="actions.decidePO(${p.id},'approve')">Approve</button>`,
           `<button class="btn no sm" onclick="actions.decidePO(${p.id},'reject')">Reject</button>`);
  }
  if (me.role === 'accountant' && p.status === 'Approved') a.push(`<button class="btn sm" onclick="actions.confirmPurchase(${p.id})">Confirm purchased</button>`);
  if (me.role === 'inventory' && p.status === 'Purchased') a.push(`<button class="btn sm" onclick="actions.receivePO(${p.id})">Receive into stock</button>`);
  return `<div class="acts">${a.join('')}</div>`;
}

/* ---------- pipeline rail (shared by every role's dashboard) ---------- */
function pipelineHTML(d) {
  const n = (rows, s) => (rows.find((r) => r.status === s) || { n: 0 }).n;
  // The stage a role acts on is marked "Your queue"; the administrator watches all stages and acts on none.
  const stages = d.pos
    ? [
        { label: 'Requests awaiting the Boss', n: n(d.tickets, 'Pending Boss Approval'), who: ['boss'] },
        { label: 'Approved, awaiting a P.O.', n: n(d.tickets, 'Approved for PO'), who: ['po_officer'] },
        { label: 'P.O.s awaiting approval', n: n(d.pos, 'Pending Approval'), who: ['boss', 'om'] },
        { label: 'Approved P.O.s to pay', n: n(d.pos, 'Approved'), who: ['accountant'] },
        { label: 'Purchased, to receive', n: n(d.pos, 'Purchased'), who: ['inventory'] },
        { label: 'Received into stock', n: n(d.pos, 'Received'), who: [] },
      ]
    : [
        { label: 'Awaiting the Boss', n: n(d.tickets, 'Pending Boss Approval'), who: [] },
        { label: 'Approved', n: n(d.tickets, 'Approved for PO'), who: [] },
        { label: 'P.O. created', n: n(d.tickets, 'PO Created'), who: [] },
        { label: 'Completed', n: n(d.tickets, 'Completed'), who: [] },
        { label: 'Rejected', n: n(d.tickets, 'Rejected by Boss'), who: ['engineer'] },
      ];
  const rejected = n(d.tickets, 'Rejected by Boss');
  return `<section class="card" aria-labelledby="p-h">
    <h3 id="p-h" class="section-h">Pipeline</h3>
    <div class="rail" style="--cols:${stages.length}">
      ${stages.map((s) => `<div class="stage${s.who.includes(me.role) ? ' mine' : ''}"><b>${s.n}</b><span>${esc(s.label)}</span>${s.who.includes(me.role) ? '<em>Your queue</em>' : ''}</div>`).join('')}
    </div>
    ${d.pos && rejected ? `<p class="rail-note">${rejected} rejected request${rejected === 1 ? '' : 's'} waiting for the submitter to edit and resubmit.</p>` : ''}
  </section>`;
}

const humanize = (code) => { const s = String(code).toLowerCase().replace(/_/g, ' ').replace(/\bpo\b/g, 'P.O.'); return s.charAt(0).toUpperCase() + s.slice(1); };
const activityRows = (rows) => rows.map((a) =>
  `<tr><td class="nw">${esc(String(a.created_at).slice(0, 16))}</td><td class="nw">${esc(a.user)}</td><td class="nw">${esc(humanize(a.action))}</td>
    <td style="min-width:150px"><span class="muted">${esc(String(a.entity).replace(/_/g, ' '))} #${esc(a.entity_id)}</span>${a.detail ? `<br>${esc(a.detail)}` : ''}</td></tr>`);

// Administrator: read-only view of every action in the system.
async function adminDashboard() {
  const [d, team, log] = await Promise.all([api('/reports/dashboard'), api('/reports/team'), api('/reports/activity')]);
  $('view').innerHTML = `
    ${pipelineHTML(d)}
    <section class="card" aria-labelledby="ra-h">
      <h3 id="ra-h" class="section-h">Latest actions <button class="btn ghost sm" onclick="go('activity')">Open activity log</button></h3>
      ${table(['When', 'User', 'Action', 'Detail'], activityRows(log.slice(0, 10)), 'No actions recorded yet. Every approval, payment and stock movement appears here as it happens.')}
    </section>
    <section class="card" aria-labelledby="tm-h">
      <h3 id="tm-h" class="section-h">Team</h3>
      ${table(['Name', 'Role', 'Actions#', 'Last action'], team.map((u) =>
        `<tr><td>${esc(u.name)}</td><td>${esc(ROLE_LABEL[u.role] || u.role)}</td><td class="num">${u.actions}</td><td class="nw">${u.last_action ? esc(u.last_action) : '<span class="restricted">No actions yet</span>'}</td></tr>`),
        'No staff accounts found.')}
    </section>`;
}

/* ---------- views ---------- */
const render = {
  async dashboard() {
    if (me.role === 'admin') return adminDashboard();
    const [, d] = await Promise.all([loadData(), api('/reports/dashboard')]);
    const q = queue();
    const total = q.tickets.length + q.pos.length;
    const rows = [
      ...q.tickets.slice(0, 8).map((t) => `<div class="queue-row"><div class="what"><b>${esc(t.ticket_no)} · ${esc(t.project)}</b>
        <span>${esc(t.company)} · ${esc(t.requested_by)} · ${t.item_count} item${t.item_count === 1 ? '' : 's'}${t.date_needed ? ' · needed ' + esc(day(t.date_needed)) : ''}</span></div>${ticketActions(t)}</div>`),
      ...q.pos.slice(0, 8).map((p) => `<div class="queue-row"><div class="what"><b>${esc(p.po_no)} · ${esc(p.vendor)}</b>
        <span>${esc(p.project)} · ${peso(p.total)} · ${esc(p.ticket_no)}</span></div>${poActions(p)}</div>`),
    ];
    const more = total > rows.length;

    $('view').innerHTML = `
      <section class="card queue-card" aria-labelledby="q-h">
        <div class="queue-head"><h3 id="q-h">Waiting on you <span class="n">${total}</span></h3></div>
        ${rows.length ? rows.join('') : `<p class="queue-empty">${esc(QUEUE_EMPTY[me.role])}</p>`}
        ${more ? `<div class="queue-row"><span class="muted">${total - rows.length} more not shown.</span>
          <button class="btn ghost sm" onclick="go('${q.tickets.length ? 'requests' : 'pos'}')">See all</button></div>` : ''}
      </section>
      ${pipelineHTML(d)}`;
  },

  async requests() {
    await loadData();
    const rows = data.tickets;
    $('view').innerHTML = `
      ${me.role === 'admin' ? '' : '<div class="acts" style="margin-bottom:16px"><button class="btn accent" onclick="actions.openTicketForm()">Submit a ticket</button></div>'}
      <div id="ticket-form"></div>
      <div class="card"><h3>${me.role === 'engineer' ? 'My requests' : 'All requests'}</h3>
      ${table(['Ticket', 'Project', 'Status', ''], rows.map((t) => `<tr>
        <td class="nw">${esc(t.ticket_no)}${t.urgency === 'urgent' ? '<br><span class="badge bad">Urgent</span>' : ''}</td>
        <td style="min-width:170px">${esc(t.project)}<br><span class="muted">${esc(t.company)} · ${esc(t.requested_by)} · ${t.item_count} item${t.item_count === 1 ? '' : 's'}${t.date_needed ? ' · needed ' + esc(day(t.date_needed)) : ''}</span></td>
        <td>${badge(t.status)}${t.status === 'Rejected by Boss' && t.reject_reason ? `<br><span class="muted">${esc(t.reject_reason)}</span>` : ''}</td>
        <td>${ticketActions(t)}</td></tr>`),
      me.role === 'engineer' ? 'You have not filed a ticket yet. Use Submit a ticket to request materials.' : 'No tickets yet. Staff file them with Submit a ticket.')}</div>`;
  },

  async pos() {
    await loadData();
    $('view').innerHTML = `<div class="card">${table(['P.O. no.', 'Project', 'Vendor', 'Total#', 'Status', ''],
      data.pos.map((p) => `<tr><td class="nw">${esc(p.po_no)}<br><span class="muted">${esc(p.ticket_no)}</span></td><td>${esc(p.project)}</td>
        <td>${esc(p.vendor)}</td><td class="num nw">${peso(p.total)}</td><td>${badge(p.status)}</td><td>${poActions(p)}</td></tr>`),
      'No purchase orders yet. The PO Officer creates one from an approved ticket.')}</div>`;
  },

  async vendors() {
    const rows = await api('/vendors');
    $('view').innerHTML = `
      ${me.role === 'po_officer' ? `<div class="card"><h3>Add vendor</h3><div class="row">
        <div><label for="v-name">Name</label><input id="v-name"></div><div><label for="v-contact">Contact</label><input id="v-contact"></div>
        <div><label for="v-tin">TIN</label><input id="v-tin"></div>
        <div style="flex:0"><button class="btn accent" onclick="actions.addVendor()">Save</button></div></div></div>` : ''}
      <div class="card">${table(['Vendor', 'Contact', 'TIN'], rows.map((v) =>
        `<tr><td>${esc(v.name)}</td><td>${esc(v.contact)}</td><td>${'tin' in v ? esc(v.tin) : '<span class="restricted">Restricted</span>'}</td></tr>`),
        'No vendors yet. The PO Officer adds them here.')}</div>`;
  },

  async inventory() {
    const [stock, log] = await Promise.all([api('/inventory'), api('/inventory/log')]);
    const canMove = me.role === 'inventory';
    inventoryItems = stock;
    $('view').innerHTML = `
      ${canMove ? '<div class="acts" style="margin-bottom:16px"><button class="btn" onclick="actions.stockModal(\'in\')">Stock in</button><button class="btn no" onclick="actions.stockModal(\'out\')">Stock out</button></div>' : ''}
      <div class="card"><h3>Stock on hand</h3>${table(['Item', 'Unit', 'Qty#', ...(canMove ? [''] : [])], stock.map((i) =>
        `<tr><td>${esc(i.item_name)}</td><td>${esc(i.unit)}</td><td class="num">${i.qty_on_hand}</td>${canMove
          ? `<td><div class="acts"><button class="btn ghost sm" onclick="actions.stockModal('in', ${i.id})">In</button><button class="btn ghost sm" onclick="actions.stockModal('out', ${i.id})">Out</button></div></td>` : ''}</tr>`),
        'No items in stock yet. Receive a purchase order or use Stock in.')}</div>
      <div class="card"><h3>Movement log</h3>${table(['When', 'Item', 'Type', 'Change#', 'Project', 'Reason', 'By'], log.map((l) =>
        `<tr><td>${esc(l.created_at)}</td><td>${esc(l.item_name)}</td>
          <td>${l.change_qty < 0 ? '<span class="badge bad">Out</span>' : '<span class="badge good">In</span>'}</td>
          <td class="num">${l.change_qty > 0 ? '+' : ''}${l.change_qty}</td><td>${esc(l.project || '')}</td><td>${esc(l.reason)}</td><td>${esc(l.by_user)}</td></tr>`),
        'No stock movements yet.')}</div>`;
  },

  async expenses() {
    $('view').innerHTML = `
      <div class="card"><h3>General expenses by project</h3>
        <div class="row"><div><label for="ex-from">From</label><input type="date" id="ex-from" value="2026-03-01"></div>
        <div><label for="ex-to">To</label><input type="date" id="ex-to" value="2026-03-31"></div>
        <div style="flex:0"><button class="btn accent" onclick="actions.runExpenses()">Run report</button></div></div></div>
      <div id="ex-out"></div>`;
    await actions.runExpenses();
  },

  async activity() {
    const rows = await api('/reports/activity');
    const users = [...new Set(rows.map((r) => r.user))].sort();
    const actionCodes = [...new Set(rows.map((r) => r.action))].sort();
    $('view').innerHTML = `<div class="card">
      <div class="row" style="margin-bottom:12px">
        <div><label for="af-user">User</label><select id="af-user"><option value="">Everyone</option>${users.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select></div>
        <div><label for="af-action">Action</label><select id="af-action"><option value="">All actions</option>${actionCodes.map((c) => `<option value="${esc(c)}">${esc(humanize(c))}</option>`).join('')}</select></div>
      </div>
      <div id="af-out"></div><p class="muted" id="af-count" style="margin-top:10px"></p></div>`;
    const draw = () => {
      const u = $('af-user').value, a = $('af-action').value;
      const shown = rows.filter((r) => (!u || r.user === u) && (!a || r.action === a));
      $('af-out').innerHTML = table(['When', 'User', 'Action', 'Detail'], activityRows(shown),
        rows.length ? 'No actions match these filters.' : 'No activity recorded yet. Every approval, payment and stock movement is logged here.');
      $('af-count').textContent = `Showing ${shown.length} of the latest ${rows.length} actions`;
    };
    $('af-user').onchange = draw; $('af-action').onchange = draw;
    draw();
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
      <div><label for="tk-pm">Project manager</label><input id="tk-pm" value="${esc(me.name)}" readonly></div>
      <div><label for="tk-project">Project</label><select id="tk-project"><option value="">Select a project...</option>
        ${projects.map((p) => `<option value="${p.id}"${t && t.project_id === p.id ? ' selected' : ''}>${esc(p.name)} (${esc(p.company)})</option>`).join('')}</select></div>
      <div><label for="tk-needed">Date needed on site</label><input type="date" id="tk-needed" value="${t ? esc(day(t.date_needed)) : ''}"></div>
    </div>
    <label class="check"><input type="checkbox" id="tk-urgent"${t && t.urgency === 'urgent' ? ' checked' : ''}> Mark as urgent</label>
    <label>Materials</label><div id="mat-entries"></div>
    <button class="btn ghost sm" type="button" onclick="addMatRow()">Add material</button>
    <label for="tk-remarks">Remarks (optional)</label><input id="tk-remarks" maxlength="500" placeholder="Additional notes" value="${t ? esc(t.remarks) : ''}">
    <div class="err" id="tk-err" role="alert"></div>
    <div class="acts" style="margin-top:12px"><button class="btn ghost" onclick="actions.closeTicketForm()">Cancel</button>
      <button class="btn accent" onclick="actions.previewTicket()">Preview</button></div></div>`;
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
  d.innerHTML = `<div style="flex:3"><label>Material name</label><input class="m-name" list="inv-names" placeholder="Type to search inventory" oninput="updateAvail(this)"></div>
    <div><label>Quantity</label><input class="m-qty" type="number" min="1" step="1" placeholder="0" oninput="updateAvail(this)"></div>
    <div><label>Unit</label><input class="m-unit" placeholder="pc, bag, kg"></div>
    <div><label>Availability</label><div class="m-av"><span class="badge">-</span></div></div>
    <button class="btn ghost sm" style="flex:0" type="button" aria-label="Remove material" onclick="this.parentElement.remove()">Remove</button>`;
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
  d.innerHTML = `<input class="i-desc" placeholder="Description" aria-label="Description" value="${esc(v.description)}" style="flex:3">
    <input class="i-qty" type="number" min="0.01" step="0.01" placeholder="Qty" aria-label="Quantity" value="${esc(v.qty)}">
    <input class="i-unit" placeholder="Unit" aria-label="Unit" value="${esc(v.unit)}">
    ${priced ? '<input class="i-price" type="number" min="0" step="0.01" placeholder="Unit price" aria-label="Unit price">' : ''}
    <button class="btn ghost sm" style="flex:0" type="button" aria-label="Remove row" onclick="this.parentElement.remove()">Remove</button>`;
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
      if (!$('ticket-form')) { location.hash = 'requests'; await go('requests'); }
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
      ${isIn ? `<div class="row"><div style="flex:3"><label for="st-name">Item (a new name creates the item)</label><input id="st-name" list="stock-names" value="${item ? esc(item.item_name) : ''}"></div>
          <div><label for="st-unit">Unit</label><input id="st-unit" value="${item ? esc(item.unit) : ''}" placeholder="pc, bag, kg"></div></div>`
        : `<label for="st-item">Item</label><select id="st-item">${inventoryItems.filter((i) => i.qty_on_hand > 0).map((i) =>
            `<option value="${i.id}"${item && item.id === i.id ? ' selected' : ''}>${esc(i.item_name)} (${i.qty_on_hand} ${esc(i.unit)} on hand)</option>`).join('')}</select>
          <label for="st-project">Project (optional)</label><select id="st-project"><option value="">No project</option>${projects.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.company)})</option>`).join('')}</select>`}
      <label for="st-qty">Quantity</label><input id="st-qty" type="number" min="0.01" step="0.01">
      <label for="st-reason">Reason</label><input id="st-reason" maxlength="200" placeholder="${isIn ? 'e.g. Returned from site' : 'e.g. Released to site'}">
      <div class="err" id="st-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="st-cancel">Cancel</button><button class="btn ${isIn ? '' : 'no'}" id="st-ok">${isIn ? 'Add to stock' : 'Release stock'}</button></div>`);
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
      <p><b>${esc(opt)}</b>${ticketDraft.urgency === 'urgent' ? ' <span class="badge bad">Urgent</span>' : ''}</p>
      <p class="muted">Manager: ${esc(me.name)} · Needed on site: ${esc(needed)}</p>
      ${ticketDraft.remarks ? `<p style="margin:8px 0">${esc(ticketDraft.remarks)}</p>` : ''}
      ${table(['Material', 'Qty#', 'Unit', 'Availability'], items.map((i) => {
        const s = stockStatus(i.description, i.qty);
        return `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td>${esc(i.unit)}</td><td><span class="badge ${s.cls}">${esc(s.text)}</span></td></tr>`;
      }))}
      <div class="err" id="tk-confirm-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="tk-edit">Edit</button><button class="btn accent" id="tk-confirm">${resubmitting ? 'Confirm &amp; Resubmit' : 'Confirm &amp; Submit'}</button></div>`);
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
    modal(`<h3>${esc(t.ticket_no)} · ${esc(t.project)}</h3><p class="muted">${esc(t.company)} · by ${esc(t.requested_by)} · ${badge(t.status)}${t.resubmit_count ? ` · resubmitted ${t.resubmit_count}x` : ''}</p>
      ${t.status === 'Rejected by Boss' ? `<div class="hint" style="margin-top:10px"><b>Rejected:</b> ${esc(t.reject_reason || 'no reason given')}</div>` : ''}
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
      <div class="row"><div><label for="po-no">P.O. number (must be unique)</label><input id="po-no" placeholder="e.g. PO-2026-0001"></div>
      <div><label for="po-vendor">Vendor</label><select id="po-vendor">${vendors.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select></div></div>
      <label>Items and prices</label><div id="po-items" class="items-edit"></div>
      <div class="err" id="po-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="po-cancel">Cancel</button><button class="btn accent" id="po-save">Save P.O.</button></div>`);
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
    const paid = ['Purchased', 'Received'].includes(p.status);
    modal(`<h3>${esc(p.po_no)} · ${esc(p.vendor)}</h3><p class="muted">${esc(p.project)} · ${esc(p.ticket_no)} · ${badge(p.status)}</p>
      ${table(['Item', 'Qty#', 'Unit', 'Price#', 'Total#'], p.items.map((i) =>
        `<tr><td>${esc(i.description)}</td><td class="num">${i.qty}</td><td>${esc(i.unit)}</td><td class="num">${peso(i.unit_price)}</td><td class="num">${peso(i.line_total)}</td></tr>`))}
      <p class="num" style="margin-top:10px"><b>Total ${peso(p.total)}</b></p>
      ${p.payment ? `<p style="margin-top:12px">Paid ${peso(p.payment.amount)} · check no. ${p.payment.check_no === null ? '<span class="restricted">Restricted</span>' : `<b>${esc(p.payment.check_no)}</b>`} · ${esc(day(p.payment.paid_at))}</p>`
        : p.paymentRestricted && paid ? '<p style="margin-top:12px">Payment details: <span class="restricted">Restricted</span></p>' : ''}`);
  },

  async decidePO(id, decision) {
    try { await api(`/purchase-orders/${id}/decision`, 'PATCH', { decision }); toast('P.O. ' + decision + 'd', 'good'); refresh(); } catch (e) { fail(e); }
  },

  confirmPurchase(id) {
    const m = modal(`<h3>Confirm purchase</h3>
      <label for="chk">Check / reference no.</label><input id="chk">
      <div class="err" id="chk-err" role="alert"></div>
      <div class="acts"><button class="btn ghost" id="chk-cancel">Cancel</button><button class="btn" id="chk-ok">Confirm</button></div>`);
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
      lastQueryMs = null;
      const rows = await api(`/reports/expenses-summary?from=${$('ex-from').value}&to=${$('ex-to').value}`);
      $('ex-out').innerHTML = `<div class="card">${table(['Company', 'Project', 'Entries#', 'Total#'], rows.map((r) =>
        `<tr><td>${esc(r.company)}</td><td>${esc(r.project)}</td><td class="num">${r.entries}</td><td class="num">${peso(r.total)}</td></tr>`),
        'No expenses between these dates. Try a wider range.')}
        ${lastQueryMs ? `<p class="muted" style="margin-top:12px">Query time ${esc(lastQueryMs)} ms</p>` : ''}</div>`;
    } catch (e) { fail(e); }
  },
};

go(location.hash.slice(1) || 'dashboard');
loadData().catch(() => {});
