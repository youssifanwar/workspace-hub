# Meeting-room manual F&B orders

## What changed

Active meeting-room cards now include **Add food & drinks**. The modal lists active products and categories from the existing Menu & F&B data and supports search/category filtering. Staff can add products directly to the active meeting-room booking without asking the customer to scan the QR menu.

The implementation uses the existing `POST /api/bookings/[id]/items` endpoint, just like the normal active-session screen. Added items use the current product name/price snapshot, appear under the meeting session's F&B Orders, and are included in its current checkout totals. No database migration is required.

## Files changed

- `src/app/(app)/meeting-rooms/page.tsx` — loads product/category data and passes it to the client.
- `src/app/(app)/meeting-rooms/MeetingRoomsHub.tsx` — threads those props into active meeting rooms.
- `src/app/(app)/meeting-rooms/ActiveMeetingRooms.tsx` — adds the staff ordering button and searchable menu modal.

## Apply to the current project

Extract `workspace-hub-meeting-room-manual-fnb-patch.zip` directly into the project root and allow the three existing source files to be overwritten. Keep your existing `.env.local` as-is.

Then run:

```cmd
npm run build
npm start
```

Open `/meeting-rooms`, find an active session, click **Add food & drinks**, and tap `+ Add 1` on a product. The item's F&B total should refresh on the session card.

## Validation note

The three modified TSX files passed TypeScript transpilation/syntax checks. A full Next.js build was not run in this environment because project dependencies (`node_modules`) are not installed here.
