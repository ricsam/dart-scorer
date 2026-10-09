# Oche — Dart Scorer

A responsive darts scorer and online darts game, with two independent editions:

- **[Standalone](https://ricsam.github.io/dart-scorer/)** — frontend-only GitHub Pages app for 2–8 players. No account, backend or database required. Scores stay on the device for the current game.
- **[Online](https://darts-v7rm7qivt07h.r5d.app/)** — the same scorer plus Google accounts: solo practice with progress tracking, lobbies with chat for friends and strangers, leagues with their own leaderboards, ranked games with a global rating, house bots and a training arena. Signed-out visitors can still keep score with the standalone scorer.

## Scoring

101 / 301 / 501 / 701, independent single/double-in and single/double-out rules, checkout suggestions and easier routes, dart-by-dart keyboard entry, misses, busts, Undo, restart confirmation, leg history and visit rewind. Light and dark themes, compact phone/landscape layouts and a full desktop keypad.

Type `T20`, `D18`, `25`, `BULL` or `MISS`; separate darts with spaces. Numeric shorthand such as `36` counts as one dart (use `D18` when the ring matters). Empty Enter adds a miss. Recorded matches reject impossible single-dart scores; casual standalone parsing remains unchanged.

## Online edition

- Google sign-in using authorization code + PKCE; no Google access/refresh tokens retained.
- Change your profile picture from **Account menu → Change profile picture** or **My stats**. Upload a JPEG, PNG or WebP (up to 10 MiB), preview the square crop, then save; remove it to use your initials. Your choice stays saved across Google sign-ins without changing your Google profile.
- Choose a dart nickname from **Account menu → Edit dart nickname** (also on **My stats**). Names are 1–24 characters and stay saved across sign-ins without changing your Google account. Lobbies, leagues, rankings and new matches use your nickname; existing matches keep the name recorded when they started.

### Play & lobbies

- **Play** (`/play`) opens your lobby, creating one with your last format if you are not in one. You sit in one lobby at a time.
- The **lobby leader** sets the game (101/301/501/701, single/double in and out, first to 1–11 legs; solo games play that many legs), the number of seats (1–8), **private** or **public**, and **ranked** or **unranked**, then starts whenever they like — alone, with house bots, with **local players** scored on the leader’s device, or with friends on their own phones. Players are pulled into the match automatically. The first thrower rotates each game; the leader can reorder or shuffle seats.
- **Private** lobbies are joined with the invite link/QR code (rotatable) or a **direct invite** to league members and people you have played with; invites arrive live with a Join toast and a header bell. **Public** lobbies are listed on **Global** (`/global`) while the leader is online; anyone signed in can take a free seat. Removed players cannot rejoin by link until the leader invites them again. Idle, empty lobbies close automatically.
- **Chat** in every lobby continues into its games (drawer with unread badge and message preview, quick messages, system messages for joins, settings, starts and results). League matches have their own chat for league members. Messages are 1–280 characters, rate limited, and the latest 200 per conversation are kept.
- **Ranked** lobbies are between 2–8 account players only (no bots or local players) and update a **global Elo rating** (K=32 from 1000), shown in the **global rankings** with provisional marks under five games. Unranked games against people count as competition (W/L, averages) but never change a rating.
- **Fair play between devices:** in lobby games each player enters and undoes only their own darts; restarting a leg or rewinding needs control of every human slot. Players can **concede**, or **claim** the match when the account opponent at the oche has made no entry for three minutes. The forfeiting slot places last and the result is rated like any other. Ranked games cannot be abandoned; unranked ones can be abandoned by the leader. Decided lobby games are **saved automatically** after two minutes.
- Anyone signed in may watch live games from public lobbies (listed under **Live now**); lobby chat stays private to its players.

### Leagues

- Create persistent leagues (formerly “rooms”; old `/rooms/:id` links redirect), share an invite link or QR code, rotate invite links, rename leagues, remove members or leave.
- Invite visitors can **Join as a guest** with a display name or connect to an existing unclaimed guest slot. League members can add the same kind of guest from Members or New match for shared-device play; guests persist in the league roster and are always unranked.
- Select league players, choose throw order, format and first-to-1–11 legs. A guest on their own device can score when selected, just like an account player.
- Guest identities are scoped to one league and kept by a browser session cookie. Claimed slots cannot be taken over by name, including after sign-out or expiry. Signing in starts a separate account identity; it does not merge or retroactively rank guest matches. Share invites only with trusted players: invite holders can see and claim unclaimed guest names.
- Score from a shared device or follow live from another phone. In league matches the players, the match creator and the league host can score any player; other league members can watch.
- Save the result after the final leg to update the leaderboard; Undo is available before saving. Saved matches are immutable; hosts can delete erroneous results and ratings are recalculated.
- Per-league Elo ratings, win/loss records, form, 3-dart averages, first-nine averages, checkout rates, 180s, high checkouts, best legs, player rating history and head-to-head records. All-time / 30-day / 7-day stats, sortable leaderboards, match history and rematches.

### Practice, bots & stats

- Solo games and every game with a **house bot** are **training**: full statistics, never wins, losses, form, head-to-head or ratings (including historical bot games). Six fictional bots, from Rookie Rue (novice) to The Maximum (pro-level), throw automatically one dart at a time with distinct accuracy and checkout skills; add them to a lobby or a league match.
- **My stats** has **All games**, **Competition** (games against people) and **Training** (solo and bot games) views. Choose a statistic to chart: 3-dart average, first-nine average, checkout rate, highest checkout, best leg, 180s, 140+ or 100+ visits. Each view shows its latest 50 games with a rolling five-game line, plus monthly progress and exact result tables. Averages are dart-weighted; checkout rates divide total finishes by total attempts (no attempts is **—**, not 0%). Records use the best value, scoring counts use totals. Global rating, rank and rating history remain separate.
- **Training arena** at `/training`: **Around the clock** (hit 1–20 in order, any ring, within 60 darts) and **Nine-dart challenge** (highest score from nine darts), privately solo or with 1–8 league players/guests. Three-dart turns, live undo, server-validated entries, automatic saving, reload recovery and cross-device refresh with version conflict protection. Challenge personal bests, monthly averages and session history are separate per mode and never mixed with x01 averages or competitive results. The arena summarizes the latest 100 accessible challenge sessions.
- Live matches persist after reload and server restart. Conflicting entries from two devices are rejected rather than silently overwriting each other.
- Public **About & scoring** guide at `/about`, explaining the scoring rules, statistics, online rules, Elo formulas and leaderboard filters with worked examples.

These are **casual, self-reported leaderboards and ratings**, not verified competition results. League ratings only compare registered players in the same league; the global rating only uses ranked lobby games. Guests and local players are never rated opponents, and matches containing bots never change ratings. Game formats share a leaderboard, so agree on a format for a league. K=32, initial rating=1000, multiplayer results compare every ranked pair with simultaneous updates. Checkout rate measures darts thrown when a one-dart finish was possible, not declared intent. First-nine stats use actual darts (busts score zero); short legs use their actual dart count.

## Development

Requires **Node 24+**.

```sh
npm ci
npm run dev           # standalone, http://localhost:5173
npm run dev:online    # frontend + API, http://localhost:5173
```

The online development command explicitly enables a local-only email/name login and uses `data/oche-dev.db`. **Never expose that development server publicly.** Production ignores `DEV_LOGIN` even if accidentally set. To test real Google sign-in locally, supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and register `http://localhost:5173/auth/google/callback` in your own Google Cloud project.

```sh
npm run typecheck
npm run lint
npm test              # engine, API, OAuth, authorization, ratings, lobbies, chat, SSE tests
npx playwright install chromium
npm run test:e2e      # real browser tests, including two independent users/devices
npm run build        # dist/ — standalone only
npm run build:online # dist-online/
npm run build:server # dist-server/index.mjs
```

Playwright uses ports 4173, 4180 and 8790 and creates a unique throwaway database per run. No real Google credentials are used in automated tests.

### Source map

- `src/game/` — shared scoring reducer, entry parsing, checkout routes and statistics.
- `src/ui/` — scorer components shared by both editions.
- `src/standalone/` — casual local game.
- `src/online/` — accounts, Play/lobbies, chat, leagues, live matches, rankings and stats UI.
- `src/shared/api.ts` — typed HTTP contract; `src/shared/match-reducer.ts` — bot-aware undo shared by server and client.
- `server/` — Hono API, built-in Node SQLite, Google OAuth, SSE, lobbies, chat and ratings; see [server details](server/README.md).

## Self-hosting online

Build the Dockerfile or run the server bundle alongside `dist-online/` and production dependencies (`npm ci --omit=dev` on the target platform; Sharp is a native runtime dependency). Use **one replica**, persistent local/block storage for SQLite, and HTTPS in front. The app serves both API and frontend on the same origin; no CORS or cross-site cookies are needed.

```sh
docker build -t oche .
docker volume create oche-data
docker run --name oche -p 8080:8080 --env-file /secure/path/oche.env \
  -v oche-data:/data oche
```

Create a Google Cloud project, configure an External OAuth consent screen with basic `openid email profile` scopes, create a **Web application** client and register exactly:

```
https://YOUR-HOST/auth/google/callback
```

Publish the consent screen so invited players are not restricted to test users. Configure the homepage and `/privacy` URL; review the privacy page for your deployment.

Server environment:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | Browser-facing HTTPS origin, no path |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server-only credentials from your OAuth client |
| `DATABASE_PATH` | Defaults to `data/oche.db`; container uses `/data/oche.db` |
| `PORT` / `HOST` | Defaults 8787 / 0.0.0.0; container uses 8080 |
| `STATIC_DIR` | Built web directory; container uses `/app/dist-online` |
| `NODE_ENV` | Set to `production` |
| `TRUST_PROXY` | Set true only behind a trusted proxy with sanitized client-IP headers |

The public repository contains **no deployment credentials**. Do not put secrets in any `VITE_*` variable: those are public browser build settings. `.env`, databases and generated assets are ignored. Account deletion currently requires an operator; there is no self-service account deletion or export UI yet.

## Deployment boundaries

- `deploy-pages.yml` continues to publish `dist/` on pushes to `main`. `VITE_ONLINE_URL` adds a sign-in link without including online code or making API calls from Pages.
- `publish-online.yml` manually publishes the online image to GHCR. It does not automatically redeploy the server.
- `deploy/kubernetes.yaml` describes the hosted installation. Pin an immutable image digest before applying. Provision OAuth credentials in the `oche-google` Kubernetes Secret, not in source. Keep the existing `oche-data` PVC and one-replica Recreate strategy.
- [Operations and backup notes](deploy/README.md).

The source is public for inspection and contribution. A distribution license has not yet been selected by the owner; no third-party or project license is implied by public visibility.
