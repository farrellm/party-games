# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Party games for people in the same room, with **no server of any kind**. Static files ship
from GitHub Pages; after that every phone talks directly to the others over WebRTC on the
local network. No matchmaking, no signaling service, no game state off the players' phones.

`DESIGN.md` is the specification and it is authoritative. Comments throughout the source
cite it by section (`§3.1`, `§13.1`); when changing something that carries such a citation,
read that section first. `README.md` covers running, deploying, and adding a game.

## Commands

```sh
npm run dev            # http://localhost:5173/party-games/ — binds all interfaces
npm run typecheck      # tsc --noEmit
npm test               # vitest watch; add -- --run for one pass
npm run e2e            # Playwright, chromium + firefox
npm run e2e:all        # adds webkit — needs Ubuntu system libs, so really CI-only
npm run build
```

Single test / single spec:

```sh
npm test -- --run src/game/liars-dice/liars-dice.test.ts
npm test -- --run -t 'never shows one player another'
npx playwright test --project=chromium e2e/handshake.spec.ts
npx playwright test --project=chromium e2e/play.spec.ts -g 'liar'
```

CI runs `typecheck`, `test --run`, `build`, and `e2e:all`. Playwright starts its own dev
server on port 5199 (not 5173) via `webServer`, and drives the **dev server**, not a preview
build, so specs can `import('/party-games/src/...')` and exercise real modules.

## Multi-tab dev mode

A real game needs several phones and a camera. Two query params replace both. They are real
query params, so they go **before** the `#`:

```
http://localhost:5173/party-games/?transport=broadcast&as=Host#/host/liars-dice
http://localhost:5173/party-games/?transport=broadcast&as=Ann#/join
http://localhost:5173/party-games/?transport=broadcast&as=Bo#/join
```

`?transport=broadcast` swaps in `BroadcastChannelTransport` and skips the QR handshake
entirely. `?as=Name` gives each tab its own `playerId` (`src/identity.ts` derives a stable
UUID from the alias) — without it, tabs share localStorage and seat the same player
repeatedly. BroadcastChannel only reaches ordinary tabs in one profile.

## Architecture

### Host-authoritative, with a per-player projection

Deliberately **not** a replicated state machine. `MatchHost` (`src/match/host.ts`) is the
only place game state exists. After every accepted action it calls `game.view(state, viewer)`
once per seat and sends each player **only their own** projection — never a broadcast of
state, because a broadcast would by definition contain someone else's secrets.
`MatchClient` (`src/match/client.ts`) holds nothing but the last `ClientState` it received
and never mutates locally. That is what makes the secrecy invariant hold end-to-end.

Whole-state sync, not diffs (`src/match/protocol.ts`): state is a few hundred bytes, and a
client that can only ever be one message behind cannot desynchronise.

A *match* is a sequence of games over a stable roster. The shell owns the roster, the
cross-game scoreboard, and `LOBBY → PLAYING → RESULTS` flow, so no game reimplements them.

### The transport seam

`Transport` (`src/net/transport.ts`) is six members wide — `self`, `send`, `onMessage`,
`onPeersChanged`, `peers`, `close`. Nothing above it knows about WebRTC. Three
implementations:

| impl | used for |
|---|---|
| `WebRtcHostTransport` / `WebRtcPlayerTransport` | production; star topology, host relays |
| `BroadcastChannelTransport` | `?transport=broadcast` multi-tab dev |
| `MemoryNetwork` / `MemoryTransport` | in-process tests — full host/projection/action loop, no browser |

Keeping that seam narrow is what lets `src/match/integration.test.ts` run the whole match
loop under Node. Do not let WebRTC types leak upward past it.

### QR *is* the signaling channel

There is no server to be one, so the two QR codes carry the SDP exchange
(`README.md` has the sequence diagram). Three pieces make that work:

- **`src/net/sdp-codec.ts`** — the load-bearing module. A gathered offer is 1–2 KB, which
  is a version-40 QR nobody can scan across a dim room. So SDP is never transmitted: only
  the fields that vary are packed into a binary frame, base45-encoded (`src/net/base45.ts`),
  and the rest is rebuilt from a template on the far side. Reconstructed SDP only ever goes
  to `setRemoteDescription`; a peer's *own* local description is always the real one its
  engine produced. `DESIGN.md §13.1` calls this the highest-risk assumption in the design.
- **`src/net/offer-pool.ts`** — an `RTCPeerConnection` accepts exactly one answer and its
  ICE credentials cannot be reused, so a host cannot show one static QR to a crowd. The pool
  keeps offers pre-gathered and swaps instantly when an answer lands. Note the `consumed`
  set is keyed on answer *text*, not nonce: a camera re-reading a code still on screen is a
  `duplicate` (say nothing), while two different players on one nonce is `stale` (§3.1).
- **Paste-code fallback** — every screen that shows a code exposes it as text, and every
  screen that scans accepts pasted text. This is how you develop without a webcam, and it
  must be preserved on any new handshake screen.

### Session, routing, screens

`src/session.ts` owns both halves — `useHostSession` and `usePlayerSession` — including
transport construction, the offer pool, and the join state machine
(`scanning → showing → in`). `src/App.tsx` is a thin dispatcher over route × phase.
Hash routing (`src/router.ts`) so Pages needs no rewrite rules; only entry points are
routed, and the session lives *above* the router because a navigation must never drop a
connection. Use `href()` to build links — it preserves `?transport=broadcast` across hash
navigations — and `appUrl()` for the app's own address, never `location.href`.

## Invariants

These are enforced, or should be. Breaking one is usually silent.

1. **Nothing is fetched at runtime.** No CDN, no Google Fonts, no analytics; the typeface
   and the QR/WASM decoder are vendored. `src/no-network.test.ts` scans every source file
   for remote URLs and fails the build. One stray `<script src="https://…">` breaks the
   whole premise, and would keep working right up until the one party with no data.
2. **Games hand out indices, not text.** Bundle content as a module under the game's
   directory and put integers on the wire and in snapshots — `src/game/cards-against-humanity/deck.ts`
   is the worked example. A hand of ten cards must not become a paragraph on every sync.
3. **`view(state, viewer)` is the only thing between hidden information and the table.**
   New games with secrets must copy the secrecy walk in
   `src/game/liars-dice/liars-dice.test.ts`, which enumerates reachable states and asserts
   no player's private data appears in anyone else's projection.
4. **`base`, `start_url` and `scope` all agree on `/party-games/`** (`vite.config.ts`).
   Disagreement is the classic Pages-PWA failure.
5. **`reduce` is pure and RNG is seeded.** Randomness goes through `src/game/rng.ts`; the
   host snapshots `RngState` alongside state so a reload resumes the same match
   (`src/match/snapshot.ts`, IndexedDB, failures deliberately swallowed).

## Gotchas

- **The camera needs a secure context.** `getUserMedia` (`src/qr/Scanner.tsx`) is only
  exposed on HTTPS or `localhost`. Reaching the dev server from a phone at a raw LAN IP
  over `http://` gives you the whole app with no camera and no error worth reading — use
  the paste-code fallback, or serve it over TLS under a name listed in `allowedHosts`
  (`vite.config.ts`). Playwright is unaffected: it drives `localhost`.
- **A fresh clone needs `npx playwright install`** before any `e2e` command.
- **QR decoding prefers native `BarcodeDetector`** and falls back to `zxing-wasm`
  (`src/qr/scanner.ts`). The wasm is bundled through Vite's `?url`, not fetched — see
  invariant 1. Safari can't be relied on for the native path.

## Adding a game

A `GameDefinition` (`src/game/types.ts`) is a pure reducer, a projection, and a component:
`init` / `validate` (returns a human-readable reason or `null`) / `reduce` (host only) /
`view` / `result`, plus a `hue`. Write it under `src/game/<id>/`, then add it to `GAMES` in
`src/game/registry.ts` — that list and the interface are the only things the shell reads.
The shell is deliberately colourless; `hue` is what lights the game's surface and its
home-screen row.

Optional `options` / `summary` let the host settle something in the lobby first (CAH's deck
and end condition are the worked example). An option names a key on the game's config and
the values it can take; the lobby renders it knowing nothing else, collapsed behind
`summary`. **The choice reaches `init` and stops there** — it is not on the wire and not in
the snapshot, so anything `view` needs must be copied into game state by `init`.

## Conventions

- TypeScript is strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals/Parameters`, `verbatimModuleSyntax`. Imports carry the `.ts`/`.tsx`
  extension.
- Comments explain *why*, and cite `DESIGN.md` sections. Match that density — this codebase
  documents decisions, not mechanics.
- CSS is hand-written custom properties in `src/ui/tokens.css` ("Table & Light": fixed quiet
  shell, one luminous game surface). No CSS framework.
- Commit subjects are lowercase conventional-commit prose, often a full clause:
  `fix(lobby): a re-scan of the answer we just took is not a stale code`.
- Work goes on a branch as several coherent commits and lands via PR — never one big commit.
