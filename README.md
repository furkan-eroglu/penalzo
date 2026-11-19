<p align="center">
  <img src="docs/banner.png" alt="Penalzo - 3D penalty duel for two players" width="100%" />
</p>

<p align="center">
  <b>A real-time 3D penalty shoot-out you play with a friend to settle any argument.</b><br/>
  Mobile-first (Android / iOS / browser) &middot; authoritative Node.js server &middot; Three.js
</p>

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A5%2022.13-5fa04e?logo=node.js&logoColor=white" />
  <img alt="Three.js" src="https://img.shields.io/badge/Three.js-r170-000000?logo=three.js&logoColor=white" />
  <img alt="WebSocket" src="https://img.shields.io/badge/realtime-WebSocket-0b7285" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?logo=sqlite&logoColor=white" />
  <img alt="Capacitor" src="https://img.shields.io/badge/mobile-Capacitor-119eff?logo=capacitor&logoColor=white" />
</p>

> Turkish version: [README.tr.md](README.tr.md)

## What is it?

Friends who can't agree on what to do usually flip a coin or play rock-paper-scissors.
**Penalzo** replaces that with a penalty duel: one player shoots, the other keeps goal, then they swap - five kicks each.
Both players secretly pick one of three zones (left / middle / right) within 5 seconds. Same zone = save, different zone = goal.
The rules are intentionally minimal; the outcome depends on anticipating the opponent's choice.

## Demo

<table>
  <tr>
    <td align="center"><img src="docs/media/goal.gif" width="230" alt="Goal" /><br/><sub>Goal in the top corner</sub></td>
    <td align="center"><img src="docs/media/save.gif" width="230" alt="Save" /><br/><sub>Keeper dives and saves</sub></td>
    <td align="center"><img src="docs/media/trophy.gif" width="230" alt="Winner" /><br/><sub>Winner with the trophy, loser dejected</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/menu.jpg" width="170" alt="Main menu" /><br/><sub>Main menu</sub></td>
    <td align="center"><img src="docs/screenshots/editor.jpg" width="170" alt="Kit editor" /><br/><sub>Kit editor</sub></td>
    <td align="center"><img src="docs/screenshots/hair.jpg" width="170" alt="Hair styles" /><br/><sub>10 hair styles</sub></td>
    <td align="center"><img src="docs/screenshots/room.jpg" width="170" alt="Private room" /><br/><sub>Private room</sub></td>
    <td align="center"><img src="docs/screenshots/friends.jpg" width="170" alt="Friends" /><br/><sub>Friends &amp; presence</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/pick.jpg" width="170" alt="Keeper picks a zone" /><br/><sub>Keeper picks a zone</sub></td>
    <td align="center"><img src="docs/screenshots/dive.jpg" width="170" alt="Dive" /><br/><sub>Dive</sub></td>
    <td align="center"><img src="docs/screenshots/goal.jpg" width="170" alt="Goal banner" /><br/><sub>Goal</sub></td>
    <td align="center"><img src="docs/screenshots/end.jpg" width="170" alt="Result screen" /><br/><sub>Result screen</sub></td>
    <td></td>
  </tr>
</table>

The in-game UI is currently in Turkish.

## Download (Android)

[**Releases**](https://github.com/furkan-eroglu/penalzo/releases) contains `Penalzo-v0.1.0-offline.apk`, an Android build you can install and play right away.

- **Offline build:** practice against the bot and the character editor work without any server. Multiplayer (rooms, friends, invites) needs a deployed server, which this build does not connect to.
- **Debug-signed:** Android will ask you to allow installation from unknown sources.
- Checked on an Android 17 emulator (API 37): launch, menu, editor, a full touch-controlled match.

## Features

- **Duel rules** - 5 kicks each, alternating. Ends as soon as the result is mathematically decided; a tie goes to sudden death (one kick each until someone leads).
- **Multiplayer** - private rooms with a 5-character code, or invite a friend straight from your friends list (accept / decline pop-up).
- **Accounts** - register / log in, or play as a guest (guests cannot add friends or invite).
- **Friends** - friend requests, accept / decline, live online and in-game status.
- **Practice mode** - play against a bot with a random kit. It runs entirely on the device, so it works without a server (see [Download](#download-android)).
- **Character editor** - shirt, shorts, socks, boots, goalkeeper gloves, 10 hair styles + hair colour, shirt number 1-99 (numeric keypad on phones). The shirt back shows your in-game name and number.
- **Everything is generated in code** - characters, hair, stadium, crowd, ball, trophy, all animation (procedural pose blending), textures (canvas) and sound (Web Audio). There are no 3D model, texture or audio files in the repo.

## Backend

A single Node.js process serves the REST endpoints, the WebSocket game protocol and the built client.

```mermaid
flowchart LR
  subgraph Client["Client (Three.js + vanilla JS)"]
    UI["UI / Stage / Audio"]
  end
  subgraph Server["Node.js server"]
    HTTP["HTTP: /api/register /login /guest /logout"]
    WS["WebSocket /ws"]
    Rooms["In-memory rooms + match state machines"]
    DB[("SQLite: users, sessions, friends")]
  end
  UI -- "fetch (auth)" --> HTTP
  UI <-- "JSON messages" --> WS
  HTTP --> DB
  WS --> Rooms
  WS --> DB
```

### The server is authoritative

Clients only ever send *intent* (which zone they picked). The server decides everything else:

```mermaid
sequenceDiagram
  participant S as Shooter
  participant R as Server (room)
  participant K as Keeper
  R->>S: round {k, shooterId, keeperId, pickMs: 5000}
  R->>K: round {k, shooterId, keeperId, pickMs: 5000}
  S->>R: pick {k, zone}
  K->>R: pick {k, zone}
  Note over R: both locked (or 5 s + grace elapsed)<br/>no pick = middle
  R-->>S: result {shot, dive, goal, rx, ry, kicks}
  R-->>K: result {shot, dive, goal, rx, ry, kicks}
  Note over S,K: both clients play the same animation<br/>from the server's outcome
```

- A pick is never forwarded to the opponent before the round resolves; the picker only gets a private acknowledgement.
- The round index is part of every `pick`, a player can pick once per round, and zones are validated (`-1 | 0 | 1`).
- The server also generates the random ball target (`rx`, `ry`) so both screens render an identical shot.
- Match flow is an explicit state machine per room:

```mermaid
stateDiagram-v2
  [*] --> Lobby
  Lobby --> Intro: host starts, 2 players
  Intro --> Pick
  Pick --> Resolve: both picked (+0.65 s) or timeout
  Resolve --> Animating: broadcast result
  Animating --> Pick: next kick
  Animating --> Lobby: decided
  Pick --> Lobby: opponent left (forfeit)
```

### Shared rules

Match rules and timings live in `shared/rules.js` (goal rule, who shoots when, early finish, sudden death, pick and result durations). The multiplayer server and the on-device practice engine (`client/src/practice.js`) both import it, so the two modes cannot drift apart. The practice engine emits the same messages the server sends, so the screens do not know which one they are talking to.

### Protocol

| Direction | Messages |
|---|---|
| Client -> server | `auth` `setName` `setLook` `createRoom` `joinRoom` `leaveRoom` `start` `pick` `practice` `invite` `inviteDecline` `friendAdd` `friendRespond` `friendRemove` |
| Server -> client | `me` `friends` `room` `roomLeft` `matchStart` `round` `picked` `result` `matchEnd` `invited` `info` `error` `kicked` `authFail` |
| HTTP | `POST /api/register` `/login` `/guest` `/logout` |

### Security and robustness

- Passwords hashed with **scrypt** and a per-user salt, compared in constant time.
- Session tokens are 256-bit random values; **only their SHA-256 hash is stored**.
- One active session per account (a new login kicks the old connection).
- Room codes come from a CSPRNG over an unambiguous 32-character alphabet.
- All input is validated server-side: username / display-name patterns, hex colours, number and hair ranges (the look schema in `shared/look.js` is shared by client and server), 16 KB WebSocket payload cap.
- Per-IP rate limiting on the auth endpoints; heartbeat ping every 20 s terminates dead sockets.
- Leaving a running match forfeits it to the opponent; presence changes are pushed to friends.

### Tests

`npm test` runs an end-to-end script (28 assertions) against a running server with real WebSocket clients: registration and login validation, duplicate / wrong credentials, friend request flow and presence, room creation, invite delivery, guest restrictions, full-room rejection, and a complete match checking the goal rule, "no pick = middle", alternating shooters, that the match ends *exactly* when the result is decided (and goes to sudden death on a tie), forfeit on leave, and presence after disconnect.

`npm run test:unit` (Node's built-in test runner, no server needed) covers the shared rules and the practice engine:

- The early-finish rule is checked against brute force: for every possible sequence of kicks, the match must end at the first kick after which no completion of the remaining kicks can change the winner, and never earlier or later.
- The practice engine is played to the end many times and checked against the protocol: round order, goal rule, "no pick = middle", ignored duplicate / stale / invalid picks, copied kick lists, correct winner, and no messages after `stop()`.

The game has also been played manually in a desktop browser (mobile viewport) and on an Android phone using a debug build.

### Known limitations

- Rooms and running matches live in memory: a server restart drops live games (accounts and friends are persisted). One node only; scaling out would need shared room state (e.g. Redis) or sticky routing.
- No reconnect grace period yet: a dropped connection during a match currently forfeits it.
- No per-message rate limit on the WebSocket, and the HTTP limiter reads `X-Forwarded-For`, so it expects to run behind a reverse proxy.
- No push notifications, password reset, or in-app account deletion yet.

## Run it locally

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`).

```bash
npm install
npm run server   # API + WebSocket on http://localhost:3000
npm run client   # game on http://localhost:5173 (proxies to the server)
```

Open the game in two tabs to play against yourself - the second tab as `http://localhost:5173/?p=2` keeps a separate login.

```bash
npm run test:unit   # rules and practice engine, no server needed (~25 s)
npm test            # end-to-end server test (~1.5 min), server must be running
```

### Production

```bash
npm run build    # bundles the client into dist/
PORT=3000 npm start
```

The server then serves the game and the API on one port. Put a TLS-terminating reverse proxy in front (Caddy shown; WebSockets work out of the box):

```
penalzo.example.com {
  reverse_proxy localhost:3000
}
```

Environment: `PORT` (default 3000), `DATA_DIR` (SQLite location, default `./data`).

### Mobile (Capacitor)

The native shell loads the bundled client, so the server address is baked in at build time:

```bash
echo "VITE_SERVER_URL=https://penalzo.example.com" > .env.production
npm run android   # build, sync, open Android Studio
npm run android:offline   # offline-only build (no server needed), then run `./gradlew assembleDebug` in android/
npm run ios       # macOS only (run `npx cap add ios` first)
```

Release builds expect an HTTPS/WSS server. To try a debug build against a plain-HTTP server on your LAN, temporarily add `"server": { "androidScheme": "http", "cleartext": true }` to `capacitor.config.json` and `android:usesCleartextTraffic="true"` to the `<application>` tag of `AndroidManifest.xml`. These settings are for local debug builds only and must not be used in a release build.

## Project structure

```
server/   index.js (HTTP + WebSocket + match engine), db.js (SQLite, auth, friends)
shared/   look.js (character schema + validation), rules.js (match rules and timings, used by server and client)
client/   src/main.js (UI + flow), net.js, audio.js, practice.js (on-device bot match engine)
          src/three/ stage.js, character.js, hair.js, anim.js, env.js, thumbs.js
scripts/  e2e.mjs (server end-to-end), rules.test.mjs and practice.test.mjs (unit tests)
android/  Capacitor Android project
docs/     banner and screenshots used in this README
```

## How it was built

Designed and directed by [Furkan Eroğlu](https://github.com/furkan-eroglu), implemented in pair-programming with [Claude Code](https://claude.com/claude-code).
