"""Builds IT_EL5_Manuscript.pdf in the layout of the IT EL 5 Manuscript Template (Letter, Arial, 1" margins)."""
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, Preformatted, KeepTogether, ListFlowable, ListItem)

F = 'C:/Windows/Fonts/'
for n, f in [('Arial', 'arial'), ('Arial-Bold', 'arialbd'), ('Arial-Italic', 'ariali'),
             ('Arial-BoldItalic', 'arialbi'), ('Courier', 'cour')]:
    pdfmetrics.registerFont(TTFont(n, F + f + '.ttf'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-BoldItalic')

IND = 18
base = ParagraphStyle('base', fontName='Arial', fontSize=11, leading=14.5, alignment=0, leftIndent=IND, spaceAfter=6)
h1 = ParagraphStyle('h1', parent=base, fontName='Arial-Bold', alignment=0, leftIndent=0, spaceBefore=14, spaceAfter=8, keepWithNext=1)
h2 = ParagraphStyle('h2', parent=base, fontName='Arial-Bold', alignment=0, spaceBefore=6, spaceAfter=4, keepWithNext=1)
cell = ParagraphStyle('cell', parent=base, fontSize=8.5, leading=10.5, alignment=0, leftIndent=0, spaceAfter=0)
cellh = ParagraphStyle('cellh', parent=cell, fontName='Arial-Bold')
code = ParagraphStyle('code', fontName='Courier', fontSize=8, leading=9.6, leftIndent=IND + 6, spaceAfter=8, spaceBefore=2,
                      backColor=colors.Color(.95, .95, .95), borderPadding=4)
note = ParagraphStyle('note', parent=base, fontName='Arial-Italic', textColor=colors.Color(.35, .35, .35))
cov = ParagraphStyle('cov', fontName='Arial', fontSize=11, leading=22.5, alignment=TA_CENTER)
covb = ParagraphStyle('covb', parent=cov, fontName='Arial-Bold')


def md(t):
    """`code` -> Courier, *italic* -> <i>, with XML escaping."""
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'`([^`]+)`', r'<font name="Courier" size="9.5">\1</font>', t)
    return re.sub(r'\*([^*]+)\*', r'<i>\1</i>', t)


story = []
P = lambda t, s=base: story.append(Paragraph(md(t), s))
H1 = lambda t: story.append(Paragraph(t, h1))
H2 = lambda t: story.append(Paragraph(t, h2))
CODE = lambda t: story.append(Preformatted(t.strip('\n'), code))
NOTE = lambda t: P(t, note)
SHOTS = 'docs/screenshots/'


def IMG(name, caption, maxh=300):
    from reportlab.platypus import Image
    from reportlab.lib.utils import ImageReader
    import os
    path = SHOTS + name + ('.png' if os.path.exists(SHOTS + name + '.png') else '.jpg')
    iw, ih = ImageReader(path).getSize()
    w = 468 - IND
    h = w * ih / iw
    if h > maxh:
        w, h = w * maxh / h, maxh
    img = Image(path, width=w, height=h)
    img.hAlign = 'RIGHT'
    cap = Paragraph(md(caption), ParagraphStyle('cap', parent=note, fontSize=9, leading=11, spaceBefore=3, spaceAfter=10))
    story.append(KeepTogether([img, cap]))



def BUL(items, ordered=False):
    story.append(ListFlowable([ListItem(Paragraph(md(i), ParagraphStyle('li', parent=base, leftIndent=0, spaceAfter=3)))
                               for i in items],
                              bulletType='1' if ordered else 'bullet', start='1' if ordered else '\u2022',
                              bulletFontName='Arial', bulletFontSize=10, leftIndent=IND + 16, bulletDedent=16))
    story.append(Spacer(1, 4))


def TBL(rows, widths):
    data = [[Paragraph(md(c).replace('size="9.5"', 'size="7.5"'), cellh if i == 0 else cell) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='RIGHT')
    t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), .5, colors.Color(.55, .55, .55)),
                           ('BACKGROUND', (0, 0), (-1, 0), colors.Color(.9, .9, .9)),
                           ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
    story.extend([t, Spacer(1, 10)])


W = 612 - 144 - IND  # usable width right of the indent

# ---------------- cover ----------------
story += [Spacer(1, 32), Paragraph('IT EL 5 \u2013 ADVANCED INFORMATION MANAGEMENT', covb), Spacer(1, 70),
          Paragraph('Development of an Integrated Materials and Inventory Ticketing System<br/>for Rivera Sarvida Construction Inc.', cov), Spacer(1, 66),
          Paragraph('by', cov),
          Paragraph('Josef Kristian T. Asuncion', cov),
          Paragraph('Kim Ralfonzo D.F. Diwa', cov),
          Paragraph('John Andrew M. Manota', cov),
          Paragraph('Renz Lindonne J. Rulona', cov),
          Paragraph('BSIT 3-6', cov), PageBreak()]

# ---------------- 1 ----------------
H1('1.&nbsp;&nbsp;&nbsp;Project Context')
H2('Project Background')
P('The RSCI Operations System moves a construction material request from the site engineer to stock in the warehouse inside one '
  'MySQL database. Rivera-Sarvida Construction Inc. (RSCI) currently tracks this with QuickBooks and paper. The prototype is a '
  'scaled-down rebuild of RSCI\'s live procurement ticketing website, which runs on Firebase. It uses MySQL, a plain '
  'HTML/JavaScript front end and a small Express API. No Firebase is involved.')
P('The prototype leaves out the billing and variation-order cascade, subcontractors, notifications, photo attachments and Excel '
  'export. The case study focuses on what a relational database must guarantee for a procurement workflow: integrity, atomic '
  'updates, protected data, limited access and fast reports.')
H2('Objectives')
BUL(['Give every request one traceable pipeline from filing to stock.',
     'Prevent double approvals and double payments.',
     'Protect sensitive supplier and payment data (supplier TIN, check numbers, staff phone numbers, passwords).',
     'Limit each staff role to what its job needs, enforced by the database and not only by the application.',
     'Keep expense reports fast on a large ledger (seeded with 100,000 rows).'])
H2('Users')
TBL([['Role', 'What the role does', 'Database account'],
     ['Engineer', 'Files material requests (tickets); edits and resubmits a rejected ticket', '`rsci_engineer`'],
     ['Boss', 'Approves or rejects tickets and purchase orders', '`rsci_boss`'],
     ['Office Manager (OM)', 'Approves or rejects purchase orders; read-only elsewhere', '`rsci_om`'],
     ['P.O. Officer', 'Creates purchase orders and vendors', '`rsci_po_officer`'],
     ['Accountant', 'Records the payment and posts it to expenses', '`rsci_accountant`'],
     ['Inventory', 'Receives delivered goods; stocks items in and out', '`rsci_inventory`'],
     ['Administrator', 'Read-only oversight of every action; cannot act or see secrets', '`rsci_admin`']],
    [W * .22, W * .53, W * .25])
P('A separate `rsci_auth` account exists only for the login lookup.')
H2('Business Processes')
BUL(['The engineer files a request. It starts as *Pending Boss Approval*.',
     'The Boss approves it (*Approved for PO*) or rejects it with a reason. The submitter can edit and resubmit a rejected ticket.',
     'The P.O. Officer creates a purchase order with a unique P.O. number. The ticket becomes *PO Created*.',
     'The Boss or the OM approves the P.O.; either sign-off alone is enough.',
     'The Accountant records the payment (check number encrypted) and posts it to Expenses. The P.O. becomes *Purchased*.',
     'Inventory receives the goods into stock. The P.O. becomes *Received* and the ticket becomes *Completed*.'], ordered=True)
H2('Database Requirements and Design')
P('The database `rsci_sql` is in third normal form on InnoDB with utf8mb4. Requirements and how the schema meets them:')
BUL(['**Relational integrity:** foreign keys between all linked tables, `UNIQUE` P.O. numbers, and `CHECK` constraints on quantities, prices and stock.'.replace('**', ''),
     'Atomic multi-table updates: InnoDB transactions (Section 2).',
     'Encrypted sensitive fields: `VARBINARY` columns `tin_enc`, `check_no_enc` and `phone_enc` (Section 3).',
     'Per-role privileges: one MySQL account per role with column-level grants (Section 4).',
     'Fast reports on a large ledger: a covering index on `expenses` (Section 5).'])
TBL([['Table', 'Purpose', 'Key relationships'],
     ['`users`', 'Staff accounts; bcrypt password hash, encrypted phone', 'Referenced by tickets, P.O.s, payments, logs'],
     ['`projects`', 'Company and project names, unique together', 'Referenced by tickets, expenses, inventory log'],
     ['`vendors`', 'Suppliers; encrypted TIN', 'Referenced by purchase orders'],
     ['`tickets`', 'Material requests and their status', '`projects`, `users` (requester, decider)'],
     ['`ticket_items`', 'Line items of a request', '`tickets` (cascade delete)'],
     ['`purchase_orders`', 'P.O. with unique `po_no`, status and total', '`tickets`, `vendors`, `users`'],
     ['`po_items`', 'P.O. lines with quantity and unit price', '`purchase_orders` (cascade delete)'],
     ['`payments`', 'One payment per P.O.; encrypted check number', '`purchase_orders` (unique), `users`'],
     ['`expenses`', 'General Expenses ledger (100,000 seeded rows)', '`projects`, `purchase_orders`, `users`'],
     ['`inventory`', 'Stock on hand per item and unit', 'Referenced by `inventory_log`'],
     ['`inventory_log`', 'Every stock movement', '`inventory`, `purchase_orders`, `projects`, `users`'],
     ['`activity_log`', 'Append-only audit trail', '`users`']],
    [W * .22, W * .43, W * .35])
P('The schema is in `sql/01_schema.sql`.')
IMG('erd', 'Figure 1. Entity relationship diagram of the `rsci_sql` database.', 330)
IMG('tables', 'Figure 2. The 12 tables of `rsci_sql` in phpMyAdmin (InnoDB, utf8mb4).', 300)

# ---------------- 2 ----------------
H1('2.&nbsp;&nbsp;&nbsp;Transaction Management')
P('Every step that changes more than one table runs inside one InnoDB transaction, so it either completes entirely (COMMIT) or '
  'leaves no trace (ROLLBACK). The helper `withTransaction` in `server/db.js` opens the transaction, runs the steps, commits, and '
  'rolls back on any error.')
CODE("""START TRANSACTION;
  UPDATE tickets SET status = 'PO Created' WHERE id = 3 AND status = 'Approved for PO';
  INSERT INTO purchase_orders (po_no, ticket_id, vendor_id, created_by, total)
    VALUES ('PO-DEMO-001', 3, 1, 4, 1500.00);
  SET @po := LAST_INSERT_ID();
  INSERT INTO po_items (po_id, description, qty, unit, unit_price)
    VALUES (@po, 'Cement 40kg', 10, 'bag', 150.00);
COMMIT;""")
H2('Transactions in the System')
TBL([['Business action', 'Steps that succeed or fail together', 'Where'],
     ['Create a P.O.', 'Flip the ticket to *PO Created*; insert the P.O.; insert its items; write the activity log', '`server/routes/purchaseOrders.js`'],
     ['Confirm purchase (Accountant)', 'Move the P.O. to *Purchased*; insert the payment with encrypted check number; post to expenses; write the log', '`server/routes/purchaseOrders.js`'],
     ['Receive goods (Inventory)', 'Add items to stock; write the stock movement log; close the P.O. and its ticket', '`server/routes/purchaseOrders.js`'],
     ['Stock out', 'Reduce stock only if enough is on hand; write the movement log', '`sql/03_transactions_demo.sql`'],
     ['Edit and resubmit a rejected ticket', 'Check the owner and status; replace the items; reset the status', '`resubmit_ticket` procedure']],
    [W * .24, W * .46, W * .30])
H2('ACID Properties')
BUL(['Atomicity. A duplicate P.O. number raises error 1062 on the insert. The earlier ticket status change is rolled back, so ticket 4 stays '
     '*Approved for PO*. The interface also has a *Simulate failure before COMMIT* switch that throws an error after every statement '
     'succeeded, to show that ROLLBACK undoes all of them.',
     'Consistency. Foreign keys, `UNIQUE` P.O. numbers and `CHECK` constraints (quantity above zero, stock not below zero) reject any state that breaks the rules.',
     'Isolation. Status changes are guarded updates such as `UPDATE ... SET status = \'Approved\' WHERE id = 1 AND status = \'Pending Approval\'`. '
     'The first session takes the row lock. A second approver waits, then sees 0 rows affected, and the API returns HTTP 409. '
     'A P.O. therefore cannot be approved twice or paid twice.',
     'Durability. InnoDB writes committed changes to its redo log, so they survive a server restart.'])
H2('Stock Cannot Go Below Zero')
P('The guard sits in the `WHERE` clause. Releasing 30 bags of cement affects 1 row and is committed. Releasing 99,999 bags affects 0 rows, '
  'is rolled back, and writes no log row.')
CODE("""UPDATE inventory SET qty_on_hand = qty_on_hand - 99999
 WHERE id = 1 AND qty_on_hand >= 99999;   -- 0 rows affected""")
IMG('rollback', 'Figure 3. Creating a P.O. with *Simulate failure before COMMIT* on: the app reports ROLLED BACK, and ticket 3 stays *Approved for PO* with no P.O. row saved.', 250)

# ---------------- 3 ----------------
H1('3.&nbsp;&nbsp;&nbsp;Database Encryption')
P('Four kinds of sensitive data are protected at rest, with the method chosen to fit how each is used.')
TBL([['Data', 'Column', 'Method', 'Reversible'],
     ['Supplier tax ID (TIN)', '`vendors.tin_enc`', 'AES encryption', 'Yes, with the key'],
     ['Check / reference number', '`payments.check_no_enc`', 'AES encryption', 'Yes, with the key'],
     ['Staff phone number', '`users.phone_enc`', 'AES encryption', 'Yes, with the key'],
     ['Login password', '`users.password_hash`', 'bcrypt hash', 'No']],
    [W * .28, W * .30, W * .22, W * .20])
H2('How It Works')
P('The encrypted columns are `VARBINARY(255)`, so the database stores raw ciphertext. The cipher is MySQL\'s default AES (128-bit, ECB mode). '
  'The application encrypts on write and decrypts on read with MySQL\'s own functions. The key is `SHA2(ENC_KEY, 256)`.')
CODE("""-- write (server/db.js encrypt)
INSERT INTO payments (po_id, amount, check_no_enc, recorded_by)
VALUES (?, ?, AES_ENCRYPT('CHK-0001', SHA2('<ENC_KEY>', 256)), ?);

-- read (server/db.js decrypt)
SELECT CAST(AES_DECRYPT(check_no_enc, SHA2('<ENC_KEY>', 256)) AS CHAR) FROM payments;""")
BUL(['The key is not in the database. `ENC_KEY` lives in the server\'s `.env` file. Someone who copies the database or a backup sees only ciphertext.',
     'Passwords are hashed, not encrypted. bcrypt is one-way, so nobody can recover a password, including the administrator.',
     'Access control backs this up. Only the roles that need a secret can read its column (Section 4). The Engineer, OM and Inventory accounts cannot even select `tin_enc`.'])
H2('Demonstration')
P('`sql/06_encryption_demo.sql` shows four results side by side:')
BUL(['The stored hex value next to the decrypted value for vendor TIN, check numbers and phone numbers.',
     'A query with the wrong key, which returns `NULL`.',
     'The `users` table showing only bcrypt hashes.',
     'The phone column stored as hex.'], ordered=True)
IMG('encryption', 'Figure 4. Vendor TIN stored as ciphertext (`stored`), decrypted with the right key, and returning NULL with a wrong key.', 260)

# ---------------- 4 ----------------
H1('4.&nbsp;&nbsp;&nbsp;Database Authorization and Privileges')
P('MySQL itself enforces who can do what. The API opens a connection as a different MySQL user for each application role (`poolFor` in '
  '`server/db.js`), so a bug in the application cannot give a role more access than its grants allow. All accounts and grants are in `sql/02_roles.sql`.')
H2('Privilege Matrix')
TBL([['Role', 'Can write', 'Can read', 'Cannot see'],
     ['`rsci_auth`', 'Nothing', '`users` login columns, including `password_hash`', 'Everything else'],
     ['`rsci_engineer`', 'Insert tickets and items', 'Projects, inventory, vendor name and contact', '`tin_enc`, payments, expenses'],
     ['`rsci_boss`', 'Insert projects, tickets; update ticket `status`, `decided_by`, `reject_reason`; update P.O. `status`, `decided_by`', 'All financial tables, including payments', 'Nothing hidden from the owner'],
     ['`rsci_om`', 'Update P.O. `status`, `decided_by`', 'P.O.s, expenses, inventory, activity log', '`tin_enc`, payments'],
     ['`rsci_po_officer`', 'Insert vendors, P.O.s and items; update ticket `status`', 'Projects, inventory, vendors', 'Payments, expenses'],
     ['`rsci_accountant`', 'Insert payments and expenses; update P.O. `status`', 'P.O.s, vendors, payments, expenses', 'Approval columns'],
     ['`rsci_inventory`', 'Insert and update stock; insert stock log; update P.O. and ticket `status`', 'P.O.s, vendor name and contact', '`tin_enc`, payments'],
     ['`rsci_admin`', 'Nothing', 'Every table for oversight', '`password_hash`, `phone_enc`, `tin_enc`, `check_no_enc`']],
    [W * .21, W * .31, W * .27, W * .21])
H2('Principles Applied')
BUL(['Least privilege. Each account gets only the statements and tables its job needs.',
     'Column-level grants. `GRANT SELECT (id, name, contact) ON vendors` hides the encrypted TIN from roles that do not need it. '
     '`GRANT UPDATE (status, decided_by) ON purchase_orders` lets an approver change two columns and nothing else.',
     'No `DELETE` for any role. Records are never removed. A submitter edits a rejected ticket only through the `resubmit_ticket` stored procedure, '
     'which runs as `SQL SECURITY DEFINER` and checks inside that the caller owns the ticket and that it is in *Rejected by Boss*. Any other caller gets error 1644.',
     'Append-only audit trail. Most roles have only `INSERT` on `activity_log`, so nobody can alter or erase their own actions.',
     'Separation of duties. The Boss approves but does not pay. The Accountant pays but does not approve. The Administrator sees everything but changes nothing.'])
H2('REVOKE Demonstration')
P('`sql/05_revoke_demo.sql` is run as root while the OM is logged in to the application:')
CODE("""SHOW GRANTS FOR 'rsci_om'@'%';
REVOKE SELECT ON rsci_sql.activity_log FROM 'rsci_om'@'%';
-- The OM's Activity Log page now fails: SELECT command denied
GRANT SELECT ON rsci_sql.activity_log TO 'rsci_om'@'%';
-- Access is restored""")
IMG('grants', 'Figure 5. `SHOW GRANTS FOR rsci_om` in phpMyAdmin: SELECT only on most tables, column-level grants on users and vendors, UPDATE limited to `status` and `decided_by`.', 300)
IMG('revoke_denied', 'Figure 6. After `REVOKE SELECT ON activity_log` from `rsci_om`, the OM Activity Log page fails with "SELECT command denied". The grant was restored afterwards.', 250)

# ---------------- 5 ----------------
H1('5.&nbsp;&nbsp;&nbsp;Query Optimization')
P('The General Expenses report totals spending per project for a date range. It is used by the Boss and the Accountant, and it runs against the '
  '100,000-row `expenses` table. A covering composite index lets MySQL answer it from the index alone. The script is `sql/04_optimization.sql`.')
CODE("""SELECT project_id, COUNT(*) AS entries, SUM(amount) AS total
FROM expenses
WHERE expense_date BETWEEN '2026-03-01' AND '2026-03-31'
GROUP BY project_id;""")
H2('Before and After')
TBL([['', 'Before the index', 'After the index'],
     ['Index available', 'Only the foreign-key indexes; none on `expense_date`', '`idx_expenses_date_proj_amt (expense_date, project_id, amount)`'],
     ['`type`', '`index` (scans the whole foreign-key index `fk_e_project`)', '`range`'],
     ['`Extra`', '`Using where`', '`Using where; Using index` (covering), plus `Using temporary; Using filesort` for the GROUP BY'],
     ['Rows examined', '99,730', '4,840 (about 5%)']],
    [W * .22, W * .38, W * .40])
P('The figures above come from `EXPLAIN` run in phpMyAdmin on the seeded database (Figures 7 and 8).')
CODE("CREATE INDEX idx_expenses_date_proj_amt ON expenses (expense_date, project_id, amount);")
H2('Why This Index')
BUL(['Range column first. `expense_date` leads, so the `BETWEEN` filter becomes a range scan over only the matching entries.',
     'Covering. `project_id` (grouped) and `amount` (summed) are in the index, so MySQL never reads the table rows.',
     'One index serves the report. It replaces a scan of the whole ledger with a read of about one twentieth of it.'])
H2('The Anti-Pattern')
P('Wrapping the indexed column in a function defeats the index, because MySQL must compute the function for every row:')
CODE("WHERE YEAR(expense_date) = 2026 AND MONTH(expense_date) = 3   -- not sargable")
P('The script runs this form too, so the plan can be compared with the range form. The index can be dropped with '
  '`DROP INDEX idx_expenses_date_proj_amt ON expenses;` to repeat the demonstration.')
IMG('explain_before', 'Figure 7. EXPLAIN before the index: `type = index`, 99,730 rows examined.', 200)
IMG('explain_after', 'Figure 8. EXPLAIN after the index: `type = range`, key `idx_expenses_date_proj_amt`, 4,840 rows examined.', 200)


def header(c, d):
    c.saveState()
    for y, txt, font in [(748, 'PAMANTASAN NG LUNGSOD NG VALENZUELA', 'Arial'),
                         (738, 'College of Engineering and Information Technology', 'Arial'),
                         (727, 'INFORMATION TECHNOLOGY DEPARTMENT', 'Arial-Bold')]:
        c.setFont(font, 9)
        c.drawString(72, y, txt)
    c.setFont('Arial', 9)
    if d.page > 1:
        c.drawCentredString(306, 40, str(d.page - 1))
    c.restoreState()


doc = BaseDocTemplate('IT_EL5_Manuscript.pdf', pagesize=letter, leftMargin=72, rightMargin=72, topMargin=96, bottomMargin=72,
                      title='Development of an Integrated Materials and Inventory Ticketing System for Rivera Sarvida Construction Inc.', author='IT EL 5')
doc.addPageTemplates([PageTemplate(id='p', frames=[Frame(72, 72, 468, 624, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)],
                                   onPage=header)])
doc.build(story)
print('ok')
