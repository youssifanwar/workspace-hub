# WorkSpace Hub — Premium UI + finance reconciliation update

This package is based on the Claude-provided `workspace-hub-fixed` project, then layers premium styling and the finance/meeting-room improvements on top. The other Claude source files and existing APIs remain in the project; no production credentials or `.env.local` are included.

## UI and interaction

- Premium responsive sidebar/topbar, current-route treatment, mobile navigation, soft transitions and reduced-motion support.
- Consistent indigo/violet/cyan accents, card shadows, clearer controls, focus states, tables, and form styling across inner pages.
- Dashboard and F&B/finance views now call out direct POS revenue so it is visible rather than hidden in a combined total.

## Finance updates

- Dashboard and reports include direct walk-in/POS sales from `fnb_sales` in revenue, daily trend and payment-method breakdowns.
- Shift pages and close/handover reconciliation include cash direct F&B, package sales and manual income.
- Expenses record their payment method; only cash-paid expenses reduce the physical cash drawer, while all eligible expenses still reduce operating results.
- Customer balance top-ups are cash-drawer inflows but are not counted as revenue; spending customer balance on an actual package/session is still revenue.
- Dashboard/report day boundaries follow the configured workspace timezone (e.g. Africa/Cairo), instead of assuming the deployment host is in the same timezone.

## Meeting-room packages

A sell-package panel is available inside both meeting-room **Start now** and **Reservation** customer flows after an existing customer is resolved. It allows staff to select an active meeting package and payment method, records the sale against the active shift through the existing API, refreshes the customer's owned meeting packages and preselects the purchased package for the booking.

## Required database migration before testing

1. Open the existing Neon project and its SQL Editor.
2. Run the full file `database-migrations/2026-10-24-finance-and-menu.sql`.
3. Make sure local `.env.local` points to the same database as the current app. Do not add credentials to this ZIP or share them in chat.
4. On Windows, run `npm ci`, `npm run build`, then `npm start` to smoke-test production behavior locally before deploying.

The migration is re-runnable and deletes no rows. It ensures `products.order_enabled` exists for menu ordering and adds `expenses.payment_method`. Existing historical expenses are classified as cash so their previous cash-drawer treatment remains consistent.

## Verification status

Touched TypeScript/TSX files were syntax-parsed successfully. A full `next build` could not be run in this environment because npm dependency downloads failed with a registry DNS error; run the build on the local machine before deploying.
