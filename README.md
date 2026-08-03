# party-games

Party games for people in the same room, with **no server of any kind**. Static files are
served once from GitHub Pages; after that every phone talks directly to the others over the
local network. No matchmaking service, no signaling service, and no game state anywhere but
on the players' own phones.

Live at <https://farrellm.github.io/party-games/>. The full design is in [DESIGN.md](DESIGN.md).

## How a game starts

The host picks a game and shows a QR code. Each player scans it and shows one back. That is
the entire handshake — the QR exchange *is* the WebRTC signaling channel, because there is
no server to be one.

```
   HOST                                  PLAYER
   ────                                  ──────
1. picks a game
2. shows QR(offer)     ──── scan ───▶  3. builds answer
                                       4. shows QR(answer)
5. scans answer        ◀─── scan ─────
6. connection opens; the code rotates automatically
```

Every screen that shows a code also exposes it as text, and every screen that scans also
accepts pasted text. That is how you develop on a laptop with no webcam.

## Running it

```sh
npm install
npm run dev          # http://localhost:5173/party-games/
```

**Multi-tab dev mode.** Playing a real game normally needs several phones and a camera.
`?transport=broadcast` swaps in a BroadcastChannel transport and skips the handshake, and
`?as=Name` gives each tab its own identity:

```
#/host/liars-dice?transport=broadcast&as=Host
#/join?transport=broadcast&as=Ann
#/join?transport=broadcast&as=Bo
```

Open those in three tabs of one window and you have a game.

## Checks

```sh
npm run typecheck
npm test             # unit and integration; add -- --run for one pass
npm run e2e          # Chromium and Firefox
npm run e2e:all      # adds WebKit; needs Ubuntu system libraries
npm run build
```

`npm run e2e` drives the dev server so the specs can import the real source modules. The
most important one is `e2e/handshake.spec.ts`, which negotiates a live WebRTC connection
between two browser contexts using nothing but the two ~200-character strings the QR codes
carry. DESIGN.md §13.1 calls that the highest-risk assumption in the design; this is what
holds it honest.

WebKit runs in CI, where the system libraries its Linux build needs exist. Real iOS Safari
and real multi-device WiFi still have to be tested by hand.

## Adding a game

A game is a pure reducer, a projection, and a component — see `src/game/types.ts`. The
shell already owns the roster, the connections, the cross-game scoreboard, and the flow
between games, so a new game implements only its own rules:

1. Write a `GameDefinition` under `src/game/<your-game>/`.
2. Declare a `hue`. The shell is deliberately colourless; that one value is what lights
   your game's surface and its row on the home screen.
3. Add it to `GAMES` in `src/game/registry.ts`.

`view(state, viewer)` is the projection, and it is the only thing standing between hidden
information and everyone at the table seeing it. The host computes one view per player and
sends each only to its owner. If your game has secrets, copy the secrecy test in
`src/game/liars-dice/liars-dice.test.ts` — it walks every reachable state and asserts no
player's private data appears in anyone else's projection.

## Deploying

Pushing to `main` builds and publishes to Pages. One-time repository setup:
**Settings → Pages → Source → GitHub Actions**.

`base`, `start_url` and `scope` all have to agree on `/party-games/`; getting them out of
sync is the classic GitHub Pages PWA failure.

## Two things worth knowing before a party

- **The first load needs internet.** Open the link before you leave the house. After that
  it runs with no connection at all — everything, including the QR decoder and the
  typeface, is precached.
- **Guest WiFi with AP isolation blocks this outright**, and there is no workaround without
  a relay server, which the design rules out. Use a phone hotspot.
