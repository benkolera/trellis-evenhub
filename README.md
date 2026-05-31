# trellis-evenhub

[Trellis] on [Even Realities G2] smart glasses, delivered as an
[Even Hub] plugin. Surfaces the user's now / next planner entry, a
live focus countdown, and today's habit nudges on the HUD.

[Trellis]: https://github.com/benkolera/electricbrain
[Even Realities G2]: https://www.evenrealities.com
[Even Hub]: https://hub.evenrealities.com

## How it fits

```
glasses (BLE)
  ↑
Even companion app  ←   this plugin (JS/TS, runs phone-side)
                            │
                            │ HTTPS, Bearer <token>
                            ▼
                     Trellis backend (electricbrain repo)
                       /api/g2/pair
                       /api/g2/state
                       /api/g2/touch
                       /api/g2/pairing
```

Trellis exposes the API; this plugin polls it and renders to the HUD
via the [Even Hub SDK]. There is no server-side SDK and no persistent
phone↔backend connection — just `fetch`.

[Even Hub SDK]: https://hub.evenrealities.com/docs

## Pairing

1. In Trellis: **Settings → Even Hub glasses → Pair Even Hub plugin**.
   A 6-character code appears (10-min TTL).
2. Open this plugin in the Even companion app. Enter the code (UI
   wiring TBD — see "Status" below).
3. The plugin posts to `/api/g2/pair`, receives a long-lived bearer
   token, stores it in `localStorage`, and never asks again.

Trellis stores only a SHA-256 hash of the token; the cleartext is
shown to the plugin exactly once.

## Screens

| Screen | Trigger | Source |
|---|---|---|
| **Home** (default) | swipe back to it | `src/screens/home.ts` |
| **Focus** | swipe / always when a session is live | `src/screens/focus.ts` |
| **Habits** | swipe | `src/screens/habits.ts` |
| **Pair** | no token in storage | `src/screens/pair.ts` |

Input mapping (`src/glasses.ts → onInput`):

- **swipe up / down** — cycle Home ↔ Focus ↔ Habits
- **double-press** — force-poll
- **press** — reserved per-screen

## Polling

`src/main.ts` polls `/api/g2/state` every **30 s normally** and
**5 s when a focus session is active**. Between polls, a local
`Ticker` decrements `ends_in_s` / `starts_in_s` each second.

## Project layout

```
src/
  main.ts          state machine: screen + poll + ticker + input
  api.ts           Trellis HTTP client (fetch, bearer auth)
  storage.ts       localStorage wrappers — base URL + token
  timer.ts         Ticker class + mm:ss / hh:mm formatters
  glasses.ts       SDK abstraction — the only file that imports the SDK
  types.ts         JSON contract for /api/g2/state
  screens/
    pair.ts        6-char code entry
    home.ts        Now / Next
    focus.ts       large mm:ss countdown
    habits.ts      today's nudges (scrollable list)
```

## Dev workflow

```
npm install
npx evenhub login          # one-time
npx evenhub init           # generates app.json
npm run dev                # vite dev server (for phone-side previews)
npx evenhub qr             # show QR for hot-reload on the companion app
npm run pack               # produce a .ehpk for distribution
```

Set `TRELLIS_BASE_URL` (or call `setBaseUrl()` from a dev console) to
point at a local Trellis (`http://localhost:4000`) instead of prod.

## Status

This is a **v0 scaffold**, not yet flown on hardware. Specifically:

- [ ] `src/glasses.ts` import path + `render()` body need to be
  reconciled with the actual `@evenrealities/even_hub_sdk` once
  installed. Search for `TODO(SDK)` to find every spot. The other
  modules should not need changes.
- [ ] `app.json` manifest not committed — run `npx evenhub init` to
  generate it locally.
- [ ] Pair screen's 6-char input UX needs to land on whatever the
  companion app exposes (typed in the phone UI, not on the HUD —
  the glasses don't have alphanumeric input).
- [ ] No unit tests yet. The screens are pure functions over
  `TrellisState`, so they're trivial to test once a runner is wired.

The Trellis backend (electricbrain repo, commit `81260ba`) is already
shipped with the matching `/api/g2/*` endpoints and Settings UI.
