# WorkSpace Hub — Customer Detail & Flexible Meeting Packages Update

## Customer page

- Adds summary cards for the customer count in the current view, visits, hours, booking spend, wallet balance, and active meeting-room packages.
- Search now includes customer name, phone, email, and notes.
- Customer rows display phone/email/notes, registration date, visits, hours used, last visit, meeting package count/value, booking spend, and current balance.
- Meeting-room package counts and sale value are read from purchase records; cancelled packages are excluded from the sold-value figure.
- Renames the customer action to **Packages & hours** and explains how to assign packages from the customer screen.

## Flexible meeting-room packages

- Create any package name and any positive whole number of hours; packages are no longer restricted to 10, 20, and 40 hours.
- Set any selling price.
- Discount is optional and defaults to `0%`; there is no fixed 8% / 12% / 18% discount requirement.
- Validity days remain optional; description remains optional.
- Multiple package definitions may use the same number of hours with different names or prices.
- Managers can edit hours, discount, price, validity, description, and activation status.
- Existing package definitions are preserved. Existing customer purchases retain their historical snapshots; no purchased package is silently repriced.

## How to create and assign a package

1. Open **Settings → Meeting Room Packages**.
2. Click **Add package**, set its name, hours, price, optional discount (leave `0` for no discount), and optional validity days, then create it.
3. Open **Customers** and click **Packages & hours** beside the intended customer.
4. Choose **Meeting room hours**, pick the active package, select the payment method/date, and click **Register package**.
5. The customer modal shows packages already owned and remaining / total hours. The purchase uses the existing API, shift, payment, balance, and snapshot flow.

## Sidebar

- Replaces the bright royal-blue active navigation treatment with a muted sage / slate-teal accent while keeping the dark premium sidebar.
- The change is CSS-only and does not affect route access, role permissions, shift gates, or main content styling.

## Database and safety

- No SQL migration is needed: the current `meeting_room_packages` schema already stores `total_hours`, `price`, `discount_percent`, `validity_days`, `description`, and status.
- Use the existing Neon `DATABASE_URL`; do not create a new database or change environment settings.
- `.env.local`, `node_modules`, and `.next` are not included in the archive.

## Validation

- TypeScript/TSX syntax transpilation passed for all 154 source files.
- A complete Next.js production build was not verified in this packaging environment because the available dependency cache is incomplete. Run `npm ci` and `npm run build` locally before deploying.
