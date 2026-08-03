# party-games — Design

A Progressive Web App for in-person party games with **no server of any kind**. Static
files are served once from GitHub Pages; after that every device talks directly to the
others over the local network. There is no matchmaking service, no signaling service, and
no game state anywhere but on the players' own phones.

Deployed at `https://farrellm.github.io/party-games/`.

---

## 1. Goals and non-goals

**Goals**

- No server at any point in the lifecycle. Matchmaking, signaling, and game state are all
  peer-to-peer.
- Works with zero internet access after the first load. Everyone on the same WiFi, or on
  one person's iPhone Personal Hotspot, is enough.
- Joining a game takes two QR scans and no confirmation taps.
- Supports stateful games: multiple rounds, hidden information, scores that persist across
  a session.
- Installable to the home screen and fully offline-capable.

**Non-goals**

- **Anti-cheat.** Every player is trusted. One device holds hidden information on behalf
  of everyone, and a determined host can read it. This is a game you play with friends in
  the same room; the social layer is the enforcement layer.
- **Remote play.** Both the QR handshake and the LAN transport assume everyone is
  physically present.
- **Host migration.** If the host's phone dies, the match dies. See §13.
- **Spectators, persistent accounts, cross-session history.**

---

## 2. Architecture overview

A **star topology**. The host is the hub; every player holds exactly one connection, to
the host. Players never connect to each other.

```
              ┌────────┐
              │ Player │
              └───┬────┘
                  │
   ┌────────┐   ┌─┴────┐   ┌────────┐
   │ Player ├───┤ HOST ├───┤ Player │
   └────────┘   └─┬────┘   └────────┘
                  │
              ┌───┴────┐
              │ Player │
              └────────┘
```

A full mesh was rejected: pairwise QR signaling would need N² scans, which is absurd past
three people. The star costs one hop of latency on player→player traffic, which no party
game will notice.

**Where state lives.** The host runs the authoritative reducer and holds the complete
game state, including every player's secrets. It sends each player a *projection* of that
state containing only what that player is allowed to see (§5). Players send actions; they
never mutate state locally.

The join handshake, end to end:

```
   HOST                                  PLAYER
   ────                                  ──────
1. picks a game
2. shows QR(offer #1)  ──── scan ───▶  3. builds answer
                                       4. shows QR(answer)
5. scans answer  ◀───── scan ─────────
6. connection opens; player is in
7. QR swaps to offer #2 automatically
                    …repeat per player…
8. host taps "Start"
```

---

## 3. Signaling over QR

This is the load-bearing part of the design. Everything else is ordinary application
code; this section is why the project is possible at all.

Browsers cannot open raw sockets or listen for inbound connections, so **WebRTC is the
only peer-to-peer transport available**. WebRTC ordinarily requires a signaling server to
exchange SDP between peers. We have no server. **The QR exchange is the signaling
channel** — the offer travels host→player as photons, and the answer travels back the
same way.

Two consequences fall out of this, and they shape the whole join UX.

### 3.1 An offer can be answered exactly once

An `RTCPeerConnection` accepts one remote answer. Its ICE credentials cannot be reused.
So the host **cannot** display one static QR for a crowd to scan.

The design is therefore **serialized, auto-rotating offers**:

- The host keeps a small background pool of pre-generated `RTCPeerConnection`s with fully
  gathered offers, so a fresh QR appears instantly rather than after an ICE-gathering
  pause.
- Exactly one offer is live and on screen at a time. Each carries a short random
  **nonce**.
- When the host scans a matching answer, the connection completes and the displayed QR
  immediately swaps to the next pooled offer.
- If two players happen to scan the same offer, the first answer scanned wins. The second
  carries a stale nonce; the host recognises it and shows *"stale code — ask them to
  rescan"*. That is an error message, not a confirmation prompt, and the fix is one tap
  of the camera on a refreshed player QR.

The host screen shows the live QR and the camera at the same time, so the host can stand
in one place and scan a queue of people without touching anything:

```
┌──────────────────────────┐
│   ███▀▄█▀██  scan me     │
│   ▄█▀███▄▀█              │
│   ██▄▀▄███▀              │
├──────────────────────────┤
│  ┌────────────────────┐  │
│  │   camera preview   │  │
│  └────────────────────┘  │
├──────────────────────────┤
│  In: Ann · Bo · Cy       │
│  [      Start game     ] │
└──────────────────────────┘
```

### 3.2 Raw SDP does not fit in a scannable QR

A gathered data-channel offer is 1–2 KB. Encoding that needs a version-40 QR, which is a
dense 177×177 grid that phone cameras struggle to read across a table in a dim room.

The fix: **do not transmit SDP**. Transmit only the handful of fields that actually vary,
and rebuild the SDP from a fixed template on the far side.

Everything else in a data-channel-only SDP is constant for our purposes: the `v=`/`o=`/
`s=`/`t=` preamble, `a=group:BUNDLE 0`, `m=application 9 UDP/DTLS/SCTP
webrtc-datachannel`, `c=IN IP4 0.0.0.0`, `a=mid:0`, `a=sctp-port:5000`,
`a=max-message-size:262144`. Only these vary:

| Field | Size | Notes |
| --- | --- | --- |
| `version` | 1 B | codec version, for forward compatibility |
| `kind` | ½ B | offer or answer (drives `a=setup:actpass` vs `a=setup:active`) |
| `nonce` | 2 B | offer identity, for the stale-scan check in §3.1 |
| `ice-ufrag` | ≤8 B | length-prefixed |
| `ice-pwd` | 24 B | fixed length in every engine we target |
| `fingerprint` | 32 B | raw SHA-256 bytes, not the 95-char colon-hex form |
| `candidates[]` | 3–19 B each | tag byte (mDNS UUID / IPv4 / IPv6) + address + port |

Answers additionally carry the player's identity, which is how the host learns who just
joined without asking anyone to confirm anything:

| Field | Size |
| --- | --- |
| `playerId` | 16 B (UUID, persisted in `localStorage`) |
| `name` | 1 + ≤24 B, length-prefixed UTF-8 |

That totals roughly **100–150 bytes**. Encoded as **base45** — chosen because it maps
cleanly onto QR *alphanumeric* mode, the same reason the EU digital COVID certificate used
it — that becomes ~150–230 characters, which is a **version 6–8 QR**. Comfortably
scannable at arm's length in bad lighting.

The codec is one module with a strict inverse:

```
src/net/sdp-codec.ts
  encodeHandshake(h: Handshake): string     // → base45
  decodeHandshake(s: string): Handshake
  toSdp(h: Handshake): string               // rebuild from template
  fromSdp(sdp: string, kind, nonce): Handshake
```

`fromSdp ∘ toSdp` and `decodeHandshake ∘ encodeHandshake` are both round-trip tested
(§12).

### 3.3 ICE without STUN or TURN

There is no STUN or TURN server, because a public STUN server would be both a central
dependency we've forbidden and useless on a LAN with no internet. We rely entirely on
**host candidates** — which is exactly right, since every peer is on the same link.

Two facts make this work in practice:

- Chrome and Safari normally obfuscate local IPs as mDNS `*.local` candidates for privacy.
  Those still resolve **between peers on the same LAN**, so the connection succeeds
  anyway. iOS Personal Hotspot bridges its clients at layer 2, so Bonjour works there too.
- Better still, **camera permission lifts the obfuscation**: once a page has been granted
  camera access, Chrome exposes real local IP candidates. Both the host and every player
  have already granted the camera in order to scan. So in the common case we get plain
  IPv4 host candidates, and mDNS is the fallback rather than the norm.

ICE gathering is **non-trickle** — the offer isn't encoded until gathering completes,
since there is no channel to trickle over. A gathering timeout (~2 s) caps the wait and
encodes whatever candidates arrived.

### 3.4 Paste-code fallback

Every screen that shows a QR also exposes the same base45 string as selectable text, and
every screen that scans also accepts pasted text. This makes desktop development possible
without a webcam, makes remote debugging possible over any chat app, and gives a rescue
path if someone's camera is broken. It is deliberately not prominent.

---

## 4. Transport layer

One reliable, ordered `RTCDataChannel` per connection, negotiated in-band as `"party"`.

**Envelope.** Every message on the wire:

```ts
type Envelope = {
  v: 1;
  from: PlayerId;
  to: PlayerId | '*';     // '*' = broadcast
  seq: number;            // per-sender, monotonic
  type: string;
  payload: unknown;
};
```

JSON-encoded. Party-game payloads are tiny and human-debuggable beats compact here.

**Relay.** The host forwards any envelope whose `to` is not the host. Liar's dice never
needs this, but it means a future game can do player→player messaging without touching
the transport.

**Liveness.** Heartbeat every 3 s; a peer is marked `degraded` after 8 s of silence and
`disconnected` on `RTCPeerConnection` failure. The roster reflects this so the table can
see whose phone fell asleep.

**Reconnect.** A player's `playerId` lives in `localStorage`, so it survives a reload.
Rejoining is the ordinary two-scan flow; when the host sees an answer carrying a
`playerId` it already has a seat for, it **rebinds that seat** instead of creating a new
one, and immediately sends the current state projection. The player is back in with their
dice count intact.

**Interfaces.** The transport is behind a narrow interface so games can be tested and
developed without WebRTC at all:

```ts
interface Transport {
  send(to: PlayerId | '*', type: string, payload: unknown): void;
  onMessage(handler: (e: Envelope) => void): () => void;
  peers(): PeerStatus[];
}
```

Three implementations: `WebRtcTransport` (production), `MemoryTransport` (unit tests),
`BroadcastChannelTransport` (multi-tab dev mode, §12).

---

## 5. Game framework

A game is a pure reducer plus a projection plus a component:

```ts
interface GameDefinition<S, A, V, C> {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  defaultConfig: C;

  init(players: PlayerId[], config: C, rng: Rng): S;
  validate(state: S, actor: PlayerId, action: A): string | null;   // null = legal
  reduce(state: S, actor: PlayerId, action: A, rng: Rng): S;       // host only
  view(state: S, viewer: PlayerId): V;                             // projection
  result(state: S): { placements: PlayerId[]; points: Record<PlayerId, number> };

  Component: (props: { view: V; me: PlayerId; dispatch: (a: A) => void }) => JSX.Element;
}
```

**Host-authoritative with per-player view projection.** Not a symmetric replicated state
machine — that would require every device to hold the full state, which for liar's dice
means every device holds every player's dice. The projection is what keeps secrets secret:

```ts
view(state, viewer) => {
  myDice: number[],                                  // only the viewer's faces
  roster: { id, name, diceCount, out }[],            // counts only, never faces
  phase: 'ROLLING' | 'CALLED' | 'RESOLVED',
  ...
}
```

The host computes one view per player and sends each only to its owner. Another player's
faces are never serialized to anyone. There is a test that asserts exactly this (§12).

**Determinism.** All randomness comes from a seeded PRNG threaded through `init` and
`reduce`. Same seed plus same action sequence means same game, which makes bug reports
reproducible and reducer tests trivial.

**Durability.** The host writes a state snapshot to IndexedDB after every accepted action.
A host page reload restores the match; peers must rescan to reconnect, but nobody loses
their dice.

---

## 6. Match and scoring shell

A **match** is a sequence of game instances over a stable roster. The shell — not any
individual `GameDefinition` — owns:

- the roster and its connection state,
- the cross-game scoreboard, accumulated from each game's `result()`,
- round history, so the table can see who won what,
- the flow between games (finish a game → results screen → pick another → same roster,
  no rescanning).

This is what makes "multiple rounds, tracking scores" a property of the app rather than
something every game reimplements.

---

## 7. Screens

Hash routing (`#/host/liars-dice`), so GitHub Pages needs no SPA rewrite rules.

```
Home ─┬─▶ HostLobby ──▶ Game ──▶ Results ─┐
      │      (QR + camera + roster)        │
      └─▶ JoinScan ──▶ JoinShowAnswer ─────┘
              (camera)      (own QR)          └──▶ back to Home / next game
```

| Screen | Contents |
| --- | --- |
| **Home** | Name field (persisted), game list, "Join a game" button |
| **HostLobby** | Live offer QR, camera, joined roster, Start button |
| **JoinScan** | Full-bleed camera, "point at the host's code" |
| **JoinShowAnswer** | Your QR, large; "show this to the host"; auto-advances on connect |
| **Game** | Rendered by the active `GameDefinition.Component` |
| **Results** | Placements, running scoreboard, "play again" / "pick another game" |

**Game-screen design note.** This screen is held at arm's length, tilted away from the
neighbours, in a loud room, by someone holding a drink. So: dice render very large, `LIAR`
is the only other tappable thing on screen, the roster is small and secondary, and nothing
is placed where a thumb rests.

---

## 8. Liar's dice

The app is a **secret dice dealer and a scorekeeper. It is not a rules engine.** Bidding
happens out loud, across the table, the way it does with real dice under real cups. The
app never asks anyone to type a bid, tracks no turn order, and never tallies a challenge.

| Happens in the app | Happens at the table |
| --- | --- |
| Rolling five secret dice per player | Bidding, out loud, in turn |
| Showing you your own dice | Deciding whether ones are wild |
| The LIAR button | Physically showing phones on a challenge |
| The dice-count roster | Counting the dice to settle the call |
| Recording who lost a die | Arguing about it |

Ones are wild — but that is a rule the humans apply while counting, not something the
software computes.

### Round loop

Three phases.

**ROLLING.** The host rolls five dice for each surviving player from the seeded PRNG and
projects each player their own faces. Every screen shows: your dice, large; the `LIAR`
button; the roster of dice counts.

```
┌──────────────────────┐
│  ⚂ ⚂ ⚄ ⚀ ⚅          │
│                      │
│  ┌────────────────┐  │
│  │      LIAR      │  │
│  └────────────────┘  │
│                      │
│  Ann 5  Bo 4  Cy 2   │
└──────────────────────┘
```

**CALLED.** Any player may press `LIAR` at any moment — there is no turn to wait for,
because the app doesn't know whose turn it is. The host accepts the **first** press and
ignores the rest, so simultaneous presses resolve deterministically.

The caller's screen becomes the control surface. Their dice are spent either way, so
there is nothing left to protect:

```
   CALLER                          EVERYONE ELSE
┌──────────────────────┐        ┌──────────────────────┐
│  Who loses a die?    │        │  Bo called LIAR      │
│                      │        │  show your dice      │
│  [ Ann ]  [ Bo  ]    │        │                      │
│  [ Cy  ]  [ Dee ]    │        │  ⚂ ⚂ ⚄ ⚀ ⚅          │
└──────────────────────┘        └──────────────────────┘
```

Everyone else keeps showing their own dice, unchanged, so they can hold the phone up and
be counted. **The app never broadcasts anyone's faces.** The reveal is physical.

**RESOLVED.** The caller taps a name — possibly their own, which is the normal outcome of
a bad call, so the picker must not exclude them. The host decrements that player's dice
and every screen shows the result and who opens the next round:

```
┌──────────────────────┐
│   Cy lost a die      │
│   Cy starts          │
└──────────────────────┘
```

Then back to ROLLING. A player at zero dice is **out** but stays visible in the roster as
such. The last player with dice wins, and `result()` hands placements to the shell's
scoreboard.

### State

```ts
type LiarsDiceState = {
  phase: 'ROLLING' | 'CALLED' | 'RESOLVED';
  seats: { id: PlayerId; dice: number[]; out: boolean }[];
  caller: PlayerId | null;        // set in CALLED
  lastLoser: PlayerId | null;     // drives "X starts"
  round: number;
};

type LiarsDiceAction =
  | { t: 'CALL_LIAR' }
  | { t: 'PICK_LOSER'; loser: PlayerId };
```

`validate` enforces the only two rules the software owns: `CALL_LIAR` is legal only in
ROLLING from a player still holding dice, and `PICK_LOSER` is legal only in CALLED and
only from `caller`.

**Config flags** are reserved but off: exact / "spot on" calls, and Palifico rounds. They
would be additive — neither requires the app to start tracking bids.

---

## 9. PWA and offline

The app must run with **no internet at all**, since a party on a hotspot with no data plan
is an explicit target. Everything is precached; nothing is fetched at runtime.

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/party-games/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Party Games',
        short_name: 'Party',
        start_url: '/party-games/',
        scope: '/party-games/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 4_000_000,
        navigateFallback: '/party-games/index.html',
      },
    }),
  ],
});
```

Notes:

- `base`, `start_url`, and `scope` all agree on `/party-games/`, matching the repository
  name. Getting these out of sync is the classic GitHub Pages PWA failure.
- `wasm` is in `globPatterns` because the QR decoder fallback ships as WebAssembly (§10)
  and would otherwise be fetched on first scan — offline, that means no scanning.
- **The first load needs internet.** Tell people to open the link before they leave the
  house. The Home screen shows an "add to home screen" hint on iOS, where there is no
  `beforeinstallprompt` and the user must use the Share sheet.
- Screen wake lock is requested during a game so phones don't sleep mid-round.

---

## 10. Third-party choices

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript | Fast, first-class PWA plugin, trivial static output |
| UI | React | Familiar; the app is small enough that framework choice is not load-bearing |
| QR **decode** | `BarcodeDetector` when present, `zxing-wasm` bundled as fallback | Native is fast and free on Chrome/Android; Safari cannot be relied on for it |
| QR **encode** | A small pure-JS encoder (e.g. `qrcode-generator`) rendered to canvas | No runtime deps, no network |
| Storage | `localStorage` for identity, IndexedDB for host snapshots | — |
| Tests | Vitest | Same toolchain as the build |

**Everything is vendored into the bundle.** No CDN, no Google Fonts, no analytics — a
remote fetch would break offline use and violate the no-server rule. This is worth
enforcing in review: a single stray `<script src="https://…">` silently breaks the entire
premise of the project.

---

## 11. CI/CD

Two workflows. `ci.yml` guards pull requests; `deploy.yml` publishes `main` to Pages.

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test -- --run
      - run: npm run build
```

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

One-time setup: **Settings → Pages → Source → GitHub Actions**. Also commit an empty
`public/.nojekyll` so Jekyll doesn't eat any underscore-prefixed asset paths.

---

## 12. Testing

**Unit.**

- `sdp-codec`: round-trip `encode`/`decode` and `toSdp`/`fromSdp`, including mDNS
  candidates, IPv6, empty candidate lists, and truncated/corrupt input.
- Liar's dice reducer: the full round loop; two simultaneous `CALL_LIAR` presses (first
  wins, second is a no-op); the caller picking themselves; elimination at zero dice; the
  win condition; and `PICK_LOSER` rejected from a non-caller.
- **Secrecy test:** for every player and every reachable state, assert that
  `view(state, viewer)` contains no other player's faces. This is the one invariant whose
  violation would be invisible in normal play.

**Integration.** `MemoryTransport` wires N in-process clients to one host, so the whole
host/projection/action loop is testable with no browser and no WebRTC.

**Manual, multi-device.** The real handshake needs real hardware. `?transport=broadcast`
swaps in `BroadcastChannelTransport`, letting several tabs on one machine play a full game
with no cameras involved — good for UI work. The QR path itself must still be exercised on
Chrome/Android, Firefox, and iOS Safari, on both shared WiFi and an iPhone hotspot.

---

## 13. Risks and open questions

1. **Template-reconstructed SDP may be rejected.** This is the highest-risk item in the
   design. Browsers can be strict about SDP they did not generate themselves, and the
   three engines disagree at the margins. It must be validated on Chrome, Firefox, and iOS
   Safari early — before any game code is written — because if it fails, §3.2 needs a
   different compression strategy (deflate over the real SDP, which still fits but yields
   a denser QR).
2. **Locked-down WiFi.** Guest networks with AP isolation block peer-to-peer traffic
   outright, and some suppress mDNS. There is no workaround without a relay server, which
   we've ruled out. The failure mode should at least be legible: "couldn't reach the host
   — try a phone hotspot."
3. **Host disconnect ends the match.** Accepted for v1. The IndexedDB snapshot means a
   host *reload* is survivable; a dead battery is not.
4. **First load requires internet.** Unavoidable for a web app. Mitigated by the install
   prompt and by the fact that people generally have signal before the party starts.
5. **QR scanning in dim rooms.** Party lighting is bad. Mitigated by the small payload
   (§3.2), high error correction, and rendering QRs at maximum brightness with the screen
   forced awake.
