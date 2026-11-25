# Optional feature migrations (NOT applied automatically)

Everything here is additive: new tables only, no change to existing tables or data.
Each feature is OFF until you turn it on in Settings, so the app behaves exactly
as before until then.

IMPORTANT: back up the database first. These files were written and tested only
against a local scratch database, never against production.

How to apply: either run `npx drizzle-kit push` (the tables are also declared in
src/db/schema.ts) or run the .sql files with psql, in order.

| File | Feature | Settings key to turn on |
|------|---------|--------------------------|
| 001_memberships.sql | Monthly memberships | feature_memberships = 1 |
| 002_membership_room_credits.sql | Meeting-room hours included in a membership (tracked by hand, not linked to reservations) | same switch as memberships |
