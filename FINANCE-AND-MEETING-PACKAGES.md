# Finance reconciliation and meeting-room package improvements

This build keeps the existing Claude changes and the premium UI layer, and adds:

- Direct F&B / walk-up sales in dashboard and report revenue, payment breakdowns, and daily trend charts.
- Desk package sales, meeting-room package sales and recorded manual income in matching finance totals and payment-method breakdowns.
- Cash drawer calculations that subtract only cash-paid expenses; non-cash expenses still count as expenses for operating results.
- Cash balance top-ups shown separately from revenue because they add money to the drawer but are not sales.
- An inline meeting-room package sale panel in both **Start now** and **Reservation** flows after selecting an existing customer or typing a phone number that resolves to an existing customer. The sale is posted through the existing package API, appears against the active shift, and is selected for use in the booking.
- Unified indigo/violet/cyan styling across inner pages and forms.

## Database migration — required before testing the app

1. Open the existing Neon project and its SQL Editor.
2. Open `database-migrations/2026-10-24-finance-and-menu.sql` from this project.
3. Run the entire SQL file once. It is safe to re-run and does not delete existing rows.
4. Make sure the local `.env.local` points at the same database used by the current app.
5. Run `npm ci`, then `npm run build`, then test locally before deploying.

The migration adds `products.order_enabled` (for direct ordering/menu) and `expenses.payment_method` (required for accurate cash drawer reconciliation). Existing historical expenses are assigned `cash` so the new column has a consistent value.

## Important finance definitions

- **Revenue**: closed booking totals + direct F&B sales + non-cancelled desk packages + non-cancelled meeting-room packages + manual income entries.
- **Payment method reports** use the same sources as revenue.
- **Cash drawer**: opening cash + cash revenue + cash customer-balance top-ups − cash-paid expenses − deposits to bank + withdrawals from bank.
- Customer-balance top-ups are not revenue; package purchases paid from balance remain revenue, but are not cash-in-drawer.
- Do not record income here for a session, order or package already recorded elsewhere or it will be double-counted.
- Dashboard and report date windows now use the configured workspace timezone rather than the hosting server's default timezone. This matters for late-night Cairo sales and prevents direct POS transactions around midnight from being assigned to the wrong day.
- The Direct POS amount is called out within F&B totals on the dashboard, reports and shift screens so staff can verify that standalone sales are included.

## Smoke-test checklist before Railway deployment

- **Direct POS:** make a small Direct F&B Sale during the current shift. Confirm the sale appears in the dashboard's Direct POS sub-label, the combined F&B total, and the active shift's payment breakdown.
- **Expenses:** add one cash expense and one Visa/InstaPay expense. Both should count as expenses, but only the cash expense should lower expected cash in the drawer.
- **Meeting package:** resolve an existing customer by search/phone, sell an active meeting package, confirm its payment method and price appear in the shift revenue, and confirm the new package is selected in the meeting booking dialog.
- **Existing functionality:** test login, desk sessions, room reservation/start-now, package usage, QR orders, Google Calendar sync, and shift close/handover.
