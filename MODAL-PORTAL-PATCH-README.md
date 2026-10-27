# WorkSpace Hub — Modal Portal Fix

## Why this fixes the clipping

Modal overlays were rendered inside animated page/card containers. Any ancestor with a transform/filter can become the containing block for `position: fixed`, so the backdrop appeared as a short strip over the customer table instead of covering the viewport.

This patch adds `src/app/(app)/_components/ModalPortal.tsx` and renders modal overlay roots through `createPortal(..., document.body)`. It is applied to customer dialogs, meeting-room active-session dialogs, booking dialogs, package dialogs, and other operational modals.

## Install into the existing project

1. Stop the dev/server process with `Ctrl+C`.
2. Extract `workspace-hub-modal-portal-patch.zip` into the project root (for example, `test2`) and allow the files under `src/` to merge/overwrite.
3. Do not replace `.env.local`; it keeps your current Neon connection.
4. Run:

```cmd
npm run build
```

5. If the build succeeds, run:

```cmd
npm start
```

Then open Customers → **Packages & hours**, and Meeting Rooms → open a session, add F&B, or open checkout. The overlay should cover the full viewport, and tall dialog content should scroll inside the dialog rather than being clipped by a parent card.

No database migration is required. No booking, payment, or Google Calendar logic is intentionally changed.
