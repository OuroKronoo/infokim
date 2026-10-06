"""Draws docs/screenshots/erd.png from the foreign keys in sql/01_schema.sql."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

T = {  # name: (x, y, [columns])  PK first; * = encrypted column
    'roles':           (0.2, 9.4, ['code PK', 'label', 'description', 'self_register', 'sort_order']),
    'users':           (0.2, 7.0, ['id PK', 'name', 'email', 'password_hash', 'role FK', 'phone_enc *']),
    'projects':        (4.2, 7.9, ['id PK', 'company', 'name']),
    'vendors':         (8.2, 7.9, ['id PK', 'name', 'contact', 'tin_enc *']),
    'tickets':         (4.2, 5.0, ['id PK', 'project_id FK', 'requested_by FK', 'decided_by FK', 'status', 'urgency']),
    'ticket_items':    (0.2, 3.6, ['id PK', 'ticket_id FK', 'description', 'qty', 'unit']),
    'purchase_orders': (8.2, 5.0, ['id PK', 'po_no UNIQUE', 'ticket_id FK', 'vendor_id FK', 'created_by FK', 'status', 'total']),
    'po_items':        (12.2, 5.4, ['id PK', 'po_id FK', 'description', 'qty', 'unit_price']),
    'payments':        (12.2, 2.4, ['id PK', 'po_id FK UNIQUE', 'amount', 'check_no_enc *', 'recorded_by FK']),
    'expenses':        (8.2, 1.7, ['id PK', 'project_id FK', 'po_id FK', 'category', 'amount', 'expense_date', 'created_by FK']),
    'inventory':       (0.2, 1.4, ['id PK', 'item_name', 'unit', 'qty_on_hand']),
    'inventory_log':   (4.2, 1.2, ['id PK', 'inventory_id FK', 'po_id FK', 'project_id FK', 'change_qty', 'created_by FK']),
    'activity_log':    (12.2, 8.0, ['id PK', 'user_id FK', 'action', 'entity', 'created_at']),
}
FK = [('users', 'roles'), ('tickets', 'projects'), ('tickets', 'users'), ('ticket_items', 'tickets'), ('purchase_orders', 'tickets'),
      ('purchase_orders', 'vendors'), ('po_items', 'purchase_orders'), ('payments', 'purchase_orders'),
      ('expenses', 'projects'), ('expenses', 'purchase_orders'), ('inventory_log', 'inventory'),
      ('inventory_log', 'purchase_orders'), ('inventory_log', 'projects'), ('activity_log', 'users'),
      ('payments', 'users'), ('purchase_orders', 'users')]
W, RH = 3.1, 0.3

fig, ax = plt.subplots(figsize=(15, 10.5))
box = {}
for n, (x, y, cols) in T.items():
    h = RH * (len(cols) + 1)
    box[n] = (x, y, W, h)
    ax.add_patch(Rectangle((x, y - h), W, h, fc='white', ec='#0f2557', lw=1.4, zorder=3))
    ax.add_patch(Rectangle((x, y - RH), W, RH, fc='#0f2557', ec='#0f2557', zorder=4))
    ax.text(x + W / 2, y - RH / 2, n, color='white', ha='center', va='center', fontsize=10, fontweight='bold', zorder=5)
    for i, c in enumerate(cols):
        enc = c.endswith('*')
        ax.text(x + 0.1, y - RH * (i + 1.5), c, fontsize=8.5, va='center', zorder=5, family='DejaVu Sans',
                color='#a8006f' if enc else ('#0f2557' if 'PK' in c else '#222'), fontweight='bold' if 'PK' in c or enc else 'normal')


def mid(n, side):
    x, y, w, h = box[n]
    return {'l': (x, y - h / 2), 'r': (x + w, y - h / 2), 't': (x + w / 2, y), 'b': (x + w / 2, y - h)}[side]


def side(a, b):
    ax_, ay, aw, ah = box[a]
    bx, by, bw, bh = box[b]
    if ax_ + aw <= bx:
        return 'r', 'l'
    if bx + bw <= ax_:
        return 'l', 'r'
    return ('b', 't') if ay - ah > by else ('t', 'b')


for a, b in FK:
    sa, sb = side(a, b)
    (x1, y1), (x2, y2) = mid(a, sa), mid(b, sb)
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1), zorder=2,
                arrowprops=dict(arrowstyle='-|>', color='#6b7280', lw=1, shrinkA=0, shrinkB=0, connectionstyle='arc3,rad=0.08'))
ax.text(0.2, -1.2, 'Arrow = foreign key (child -> parent).   Magenta * = encrypted column (AES).', fontsize=9, color='#444')
ax.set_xlim(0, 15.6)
ax.set_ylim(-1.5, 9.6)
ax.axis('off')
fig.savefig('docs/screenshots/erd.png', dpi=130, bbox_inches='tight', facecolor='white')
print('ok')
