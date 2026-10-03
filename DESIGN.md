# Design direction

Source: the live RSCI site (`rsci-ticketing`: magenta, Syne + DM Sans) and the company logo
(navy + magenta on white). Nothing here is invented taste; it is the existing identity, tightened.

Design Read: internal operations tool for seven roles (engineer, boss, OM, PO officer,
accountant, inventory, and a read-only administrator), in a restrained navy-and-paper language with the RSCI magenta as the
single accent. Dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Palette (2 cores + 1 accent, plus status colors)

| Token | Value | Why |
|-------|-------|-----|
| navy | `#0f2557` | Taken from the logo. Sidebar, primary buttons, headings. |
| paper | `#f5f4f1` | Warm off-white page. Keeps long table sessions easy on the eyes. |
| magenta (accent) | `#a8006f` | Logo magenta. Only the main call to action, the focus ring, the "your queue" marker and the nav counters. |
| ok / warn / bad | `#14703a` / `#8a5200` / `#b3202a` | Status only (approved, pending, rejected). Never decoration. |

Measured contrast ratios (WCAG AA needs 4.5:1 for normal text): body text on paper 16.2:1, muted text on paper 5.9:1,
white on magenta 7.3:1, white on navy 14.8:1, sidebar text on navy 9.3:1, and the weakest pair, the green status chip, 5.4:1.
Light theme only: the live site is light and this is an office tool, so there is no reason to ship a theme toggle.

## Type

- Syne for page titles and big numbers: it is the live site's heading face, so the prototype reads as the same product.
- DM Sans for everything else: the live site's body face, good tabular figures for quantities and pesos.
- Sentence case labels, no letter-spaced uppercase.
- A monospace face appears once, for the MySQL user name in the sidebar, because it is an identifier.

## Shape

- 6px radius on controls, 8px on panels, 10px on the modal. No pills.
- No shadows on panels. The modal alone carries one, because it floats above the page.
- Panels are flat white with a 1px hairline.

## Identity motif: the pipeline rail

The real business process, in order: Request, Boss approval, Purchase order, Payment, Stock.
It appears as the numbered list on the sign-in screen and as the horizontal rail on the dashboard,
where each stage carries a real count and the stage waiting on the signed-in role is marked.

## Screens are built around a decision

- Dashboard: what is waiting on you, with the action buttons inline, then where everything sits in the pipeline.
- Tables: the deciding field first, row actions only where the role can act.
- Empty states say why they are empty and what fills them.

## Motion

Hover and focus transitions only (120ms). No loops, no entrance animation.
