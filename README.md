# Oche — Dart Scorer

A responsive darts scorer for 2–8 players, with two independent editions:

- **[Standalone](https://ricsam.github.io/dart-scorer/)** — frontend-only GitHub Pages app. No account, backend or database required. Scores stay on the device for the current game.
- **[Online](https://darts-v7rm7qivt07h.r5d.app/)** — the same scorer plus Google accounts, persistent rooms, invites, live scoring and room leaderboards. Signed-out visitors can still play the standalone game; signed-in users can use **Quick game** without recording a result.

## Scoring

101 / 301 / 501 / 701, independent single/double-in and single/double-out rules, checkout suggestions and easier routes, dart-by-dart keyboard entry, misses, busts, Undo, restart confirmation, leg history and visit rewind. Light and dark themes, compact phone/landscape layouts and a full desktop keypad.

Type `T20`, `D18`, `25`, `BULL` or `MISS`; separate darts with spaces. Numeric shorthand such as `36` counts as one dart (use `D18` when the ring matters). Empty Enter adds a miss. Recorded matches reject impossible single-dart scores; casual standalone parsing remains unchanged.

## Online edition

- Google sign-in using authorization code + PKCE; no Google access/refresh tokens retained.
- Choose a dart nickname from **Account menu → Edit dart nickname** (also on **My stats**). Names are 1–24 characters and stay saved across sign-ins without changing your Google account. Rooms, leaderboards and new matches use your nickname; existing matches keep the name recorded when they started.
- Create persistent rooms, share an invite link or QR code, rotate invite links, rename rooms, remove members or leave.
- Invite visitors can **Join as a guest** with a display name or connect to an existing unclaimed guest slot. Room members can add the same kind of guest from Members or New match for shared-device play; guests persist in the room roster and are always unranked.
- Select room players, choose throw order, format and first-to-1–11 legs. A guest on their own device can score when selected, just like an account player.
- Guest identities are scoped to one room and kept by a browser session cookie. Claimed slots cannot be taken over by name, including after sign-out or expiry. Signing in starts a separate account identity; it does not merge or retroactively rank guest matches. Share invites only with trusted players: invite holders can see and claim unclaimed guest names.
- Score from a shared device or follow live from another phone. Players, the match creator and the room host can score; other room members can watch.
- Live matches persist after reload and server restart. Conflicting entries from two devices are rejected rather than silently overwriting each other.
- Save the result after the final leg to update the leaderboard; Undo is available before saving. Saved matches are immutable; hosts can delete erroneous results and ratings are recalculated.
- Per-room Elo ratings, win/loss records, form, 3-dart averages, first-nine averages, checkout rates, 180s, high checkouts, best legs, player rating history and head-to-head records.
- All-time / 30-day / 7-day stats, sortable leaderboards, match history, rematches and a personal career page.

These are **casual, self-reported room leaderboards**, not verified competition results. Ratings only compare registered players in the same room; guests do not affect ratings. Game formats share the room leaderboard, so agree on a format for a league. K=32, initial rating=1000, multiplayer results compare every ranked pair with simultaneous updates. Checkout rate measures darts thrown when a one-dart finish was possible, not declared intent. First-nine stats use actual darts (busts score zero); short legs use their actual dart count.

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
npm test              # engine, API, OAuth, authorization, ratings, SSE tests
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
- `src/online/` — rooms, accounts, live matches and leaderboard UI.
- `src/shared/api.ts` — typed HTTP contract.
- `server/` — Hono API, built-in Node SQLite, Google OAuth and SSE; see [server details](server/README.md).

## Self-hosting online

Build the Dockerfile or run the server bundle alongside `dist-online/`. Use **one replica**, persistent local/block storage for SQLite, and HTTPS in front. The app serves both API and frontend on the same origin; no CORS or cross-site cookies are needed.

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
