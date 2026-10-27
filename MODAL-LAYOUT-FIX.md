# Modal layout fix

## What was wrong
The entrance animation used `transform: translate3d(0, 0, 0)` and `filter: blur(0)` as its final keyframe while using `animation-fill-mode: both`. Even after the animation finished, the page wrapper remained a containing block for `position: fixed` children. Card entrance animations also left `transform: translateY(0)` in place. Since customer package dialogs and active meeting-session dialogs are rendered within page cards, the overlay was positioned/clipped relative to the card instead of the browser viewport.

## Fix
The entrance keyframes now finish with `transform: none` and `filter: none`. The entry movement/blur animation is still visible while playing, but the finished page/card no longer contains fixed dialogs. This applies across the app, including customer dialogs and meeting-room session dialogs. No schema, database URL, Google Calendar mapping, booking, or billing logic was changed.

## Install
Copy `src/app/globals.css` into the same path in the current project and overwrite the old file. Or use the included full project bundle. Keep your existing `.env.local` unchanged. Then run:

```cmd
npm run build
npm start
```

Open the customer page and click `Packages & hours`; also test `Add food & drinks` / session dialogs on Meeting Rooms. The modal should cover the full viewport, center correctly and scroll internally on shorter screens.
