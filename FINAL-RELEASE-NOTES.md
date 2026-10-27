# WorkSpace Hub — Premium Meeting Calendar + Customer & Packages Release

This release builds on the meeting booking calendar update and includes customer management improvements, flexible meeting-room package definitions, and a softer sidebar accent.

## Included

- Premium meeting-room calendar with Day, Week, Room Grid, Month, and Agenda views.
- Existing Meeting Rooms active-session PostgreSQL `42803` fix (device count correlates using the grouped reservation booking id).
- Manual F&B ordering from active meeting rooms and existing meeting-room package purchase flow.
- Customer overview with contact details, notes, registration date, visits, hours, booking spend, wallet balance, and meeting-room package ownership totals.
- Customer search by name, phone, email, and notes.
- Clear **Packages & hours** action on the customer list to assign desk or meeting-room packages to a customer.
- Custom meeting-room package name, any positive whole number of hours, custom price, optional 0–100% discount (default 0), optional validity days and description. No forced 10/20/40-hour or 8/12/18% rules. Multiple packages can share the same hours.
- Existing sold package snapshots remain unchanged; changing a package definition does not reprice historical customer purchases.
- Sidebar active color softened to muted sage / slate-teal.
- Existing F&B, expenses, shift settlement, customer balance, room booking, and Google Calendar flows retained.

## How to assign a meeting-room package

1. Create a package in **Settings → Meeting Room Packages**.
2. Open **Customers → Packages & hours** for the target customer.
3. Select **Meeting room hours**, choose a package, choose payment method/date, and register the purchase.
4. Review remaining hours in the same customer package modal.

## Run locally against the existing Neon database

1. Extract this project into a new folder, leaving the current project as a backup.
2. Copy the existing `.env.local` into the project folder. Keep its `DATABASE_URL` as-is; it is intentionally excluded from this ZIP.
3. Run `npm ci`, then `npm run build`.
4. If the build succeeds, run `npm start` and open `http://localhost:3000`.
5. Test customer package creation/assignment, package hours remaining, package-based meeting booking, direct booking, customer balance/payment method flows, meeting calendar, and manual F&B before deploying to Railway.

## Database changes

No schema migration is required for this update. The existing package definition/purchase tables already store the needed custom hours, price, discount snapshot, validity and description. Do not run an unrelated SQL migration for these UI/API changes.

## Validation status

TypeScript/TSX syntax transpilation passed for all 154 source files. A complete production build was not verified in the packaging environment because the available dependency cache was incomplete. Run `npm ci` and `npm run build` on the Windows development machine before deployment.
