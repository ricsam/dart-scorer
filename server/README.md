# Oche server

Node server for the signed-in ("online") edition: Google sign-in, leagues, live matches with
server-sent events, Elo ratings, leaderboards and statistics. It also serves the built SPA.
The HTTP contract lives in [`src/shared/api.ts`](../src/shared/api.ts); the darts rules are the
shared engine in [`src/game`](../src/game).

- [Hono](https://hono.dev) on `@hono/node-server`, SQLite through Node's built-in `node:sqlite`
  (Node 24+), `jose` to verify Google ID tokens, and native `sharp` to validate and resize uploaded pictures.
  Sharp is external to the server bundle: install production dependencies on the target platform (`npm ci --omit=dev`). The Dockerfile does this automatically.
- One process owns the database and the live-update hub (in-memory SSE fan-out and rate limits),
  so run a single replica.

## Running

```sh
npm run dev:online        # server (Node watch + tsx, DEV_LOGIN=true) + Vite on http://localhost:5173
npm run dev:server        # server only
npm run build:server      # bundle → dist-server/index.mjs
npm run build:online      # SPA → dist-online/
npm start                 # node dist-server/index.mjs (serves dist-online/ too)
npx vitest run            # unit + server tests (in-memory DB, fake Google)
npx tsc -p tsconfig.server.json
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address. |
| `NODE_ENV` | | `production` disables dev login. |
| `PUBLIC_URL` | `http://localhost:5173` | Browser-facing origin. Used for the OAuth redirect URI (`${PUBLIC_URL}/auth/google/callback`), the Origin check on mutations, and — when `https` — `Secure`/`__Host-` cookies and HSTS. |
| `DATABASE_PATH` | `data/oche.db` | SQLite file (parent directory is created; `:memory:` works). WAL mode. |
| `STATIC_DIR` | `dist-online` | Built SPA; empty string disables static serving. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | | Google sign-in is enabled only when both are set. Authorized redirect URI: `${PUBLIC_URL}/auth/google/callback`. |
| `DEV_LOGIN` | | `true` enables `POST /auth/dev-login` (any email, no password) — ignored when `NODE_ENV=production`. |
| `TRUST_PROXY` | | `true` takes the client IP (for rate limits) from `CF-Connecting-IP`, else the first `X-Forwarded-For` entry. Set it behind Cloudflare/Traefik, otherwise every visitor shares the proxy's IP. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `30` | Per-IP limit for `/auth/*` requests. Only raise it where many players genuinely share one address (the Playwright harness sets `1000`). |

Secrets come only from the environment; nothing secret is logged (no tokens, codes or query strings).

## Endpoints

Everything in `src/shared/api.ts` and `src/shared/training.ts`, plus:

- `GET /auth/google?returnTo=/path` → Google (PKCE S256 + state + nonce);
  `GET /auth/google/callback` → session cookie and redirect to `returnTo`, or
  `/login?error=<code>` with `access_denied`, `state_mismatch`, `state_expired`, `invalid_request`,
  `google_failed`, `email_unverified` or `google_unavailable`.
- `POST /auth/logout` (204), `POST /auth/dev-login` (`{ user }`).
- `PUT /api/me/avatar`: authenticated account only, raw JPEG/PNG/WebP body up to 10 MiB and 40 megapixels; requires a matching Origin. Returns `{ user }`. Sharp validates, strips metadata and centre-crops to 256×256 WebP. `DELETE /api/me/avatar` removes it to initials (also `{ user }`).
- `GET /api/avatars/:userId/:version.webp`: public versioned image URL, cached for one day. Replacing/removing invalidates the previous URL on the server; already cached copies may remain until expiry.
- `GET /healthz` (process up) and `GET /readyz` (database answers).
- SSE: `GET /api/matches/:id/events` (event `match`; `chat` messages for the match or its lobby;
  `lobby` `{ type: 'started', matchId }` when its lobby starts the next game; and `match-deleted`
  with `{ matchId }` just before the stream closes when the match is deleted),
  `GET /api/leagues/:id/events` (event `league`), `GET /api/lobbies/:id/events` (events `lobby` and
  `chat`; members only; a final `removed`/`closed` lobby event is delivered before the stream ends)
  and `GET /api/me/events` (event `user`: lobby invites). Streams start with `retry: 3000`, send a
  heartbeat comment every 25 s. Logout immediately closes only that session's streams (other
  sessions remain connected); removal or league deletion closes streams immediately without
  draining queued events. Session expiry/revocation and access are checked before each write and
  heartbeat. Open streams also drive presence ("online"), with a 5 s grace period between pages.

## Behaviour notes

- Sessions: 32 random bytes in `__Host-oche_session` (https) or `oche_session`, HttpOnly,
  SameSite=Lax; only the SHA-256 is stored. 60-day lifetime, renewed when under 30 days remain.
- Mutations (`POST`/`PUT`/`PATCH`/`DELETE` under `/api` and `/auth`) need a matching `Origin` (when sent)
  and `Content-Type: application/json` bodies of at most 64 KB (403 / 415 / 413).
  The avatar PUT is the only binary-body exception and requires Origin even when other requests omit it.
- Schema v6 adds `user_avatars`: one normalized image per account, or a NULL-image row marking explicit removal. Custom pictures/removal survive identity-provider sign-ins; untouched provider pictures still refresh. Avatar bytes are included in ordinary SQLite backups.
- Rate limits (in memory): 30 `/auth` requests per IP per minute, 300 mutations per user per
  minute, 60 public invite previews per IP per minute, 20 concurrent SSE streams per user.
  Each rate-limit map is capped at 10,000 keys and fails closed for new keys until expiry.
- Leagues and matches the viewer can't see are 404. Limits: league names 1–40 characters, 20 owned
  leagues per user, 100 members per league, 10 live matches per league; guest names 1–18, display
  names 1–24 characters.
- Matches: only `submit`, `undo`, `resetLeg`, `nextLeg` and `rewind` actions. Every accepted
  change (including finishing) increments `version`; a stale `baseVersion` gets 409 with the
  current match, a no-op action returns 200 with the version unchanged. Submit entries use
  `evaluateOnlineEntry` before applying the reducer: invalid or physically impossible darts
  return 400 without changing the version. Numeric shorthand such as 36 and 60 remains valid.
- Ratings: per league, Elo with K = 32 over all pairs of signed-in players (K/(n−1) scaling),
  replayed from scratch in completion order whenever a match is finished or a finished match is
  deleted. Stored at full precision; the API rounds to integers. Ranked lobby matches update the
  **global rating** instead (same formula): each saved ranked result is applied on top of
  `global_ratings`, and `recomputeGlobalRatings` can replay them all. `GET /api/rankings` lists the
  top 100 plus the viewer.
- House bots: add one of six fictional characters to a lobby or a league match. Requests accept
  `{ botId }` alongside human/guest identities, with at least one human and no duplicate bots.
  Profiles live in `src/shared/bots.ts`; accuracy and checkout-aware dart simulation live in
  `server/bot-darts.ts`. Bots are stored only in `match_players.bot_id`, not as accounts or
  claimable guests (schema v3).
- Bot turns are server-owned, one physical dart every 850 ms, with version checks and normal
  SSE broadcasts. They continue without connected viewers, stop at human turns or leg completion,
  and resume partial visits after restart. Humans still start the next leg and save results.
  Manual `submit` during a bot turn is rejected. Undo removes trailing bot darts and undoes the
  last human dart/visit in the current leg; if no human has thrown, it is a no-op. Rewind and reset
  reschedule the bot safely. Match/league deletion and server shutdown stop pending work.
- Any match containing a bot, and any solo game, is **practice** (`matches.practice`) for **all**
  participants, even with multiple registered humans. Practice results are excluded from all
  competition aggregates, W/L, form, head-to-head and recent-match statistics. Their separate
  training statistics are retained, but rating fields remain null and they are excluded from Elo
  replay and rating history. Bot difficulties are approximate 501 straight-in, double-out
  averages, not guarantees for any individual leg.
- Challenges: schema v4 adds `training_sessions`, separate from match tables. `GET/POST /api/training`,
  `GET/DELETE /api/training/:id`, `POST /api/training/:id/actions` with `{baseVersion, action}`.
  Actions are `submit` (one physical dart) and `undo` (live only). Automatic completion is immutable.
  Conflict returns 409 and latest `session`. Creator can delete; only participants score. Solo is private;
  league sessions require current membership even after body reads. Limit 10 live sessions per participant.
  The UI polls every two seconds. The list returns at most 100 latest accessible participant sessions.
- Career totals (`/api/me/stats`) include results from leagues the user has since left; recent
  matches only list leagues the user can still see, plus the user's own lobby games. The response
  also has `all` (competition + training), 50-game `trend`, `competitionTrend` and `training.trend` (limited independently), and the `global` rating. Progress points include checkout/first-nine rates, records, scoring visit counts and raw denominators for weighted rolling values. Monthly histories cover all saved results, grouped by UTC month.

## Lobbies, chat and online rules (schema v5)

- Schema v5 renames rooms to leagues (`leagues`, `league_members`, `league_id`), rebuilds
  `matches`/`match_results` with a nullable `league_id` (foreign keys off during the rebuild, then
  `foreign_key_check`), and adds `matches.lobby_id/visibility/ranked/practice/forfeit_slot`,
  `match_players.controller_id`, `lobbies`, `lobby_players` (one seat per account across all
  lobbies), `lobby_invites`, `lobby_bans`, `global_ratings` and `chat_messages`. Historical bot
  matches are marked practice. Take a consistent backup before upgrading (see deploy notes).
- Lobbies (`server/lobbies.ts`, read models in `server/lobby-data.ts`): create/current/list public,
  view (members, public, invite code or direct invite), leader-only settings, seats (bots, local
  players), order, invite code rotation, invite candidates (league co-members and earlier lobby
  opponents), invites, start. Joining or creating leaves your previous lobby; when the leader
  leaves, the longest-seated account leads and the leader's local players go too; an empty lobby
  closes. Removed players are banned until invited again. Public listings require the leader to be
  online and a free seat. Visibility is snapshotted on the match: public lobby games can be watched
  by any signed-in user; private ones by players, scorers and current lobby members.
- Lobby match rules (`authorizeAction` in `server/matches.ts`): `submit` only for the active slot
  you control (your own; the leader controls local players), `undo` only when
  `undoTargetSlot` is yours, `resetLeg`/`rewind` only when you control every human slot.
  `POST /api/matches/:id/forfeit` concedes your own slot, or claims the active account opponent
  after three minutes without any change (`claim.at`). Forfeits save immediately with the
  forfeiting slot last and others by legs. Ranked lobby games cannot be deleted.
- Results are saved by `server/results.ts` (explicit save, forfeit and the janitor). The janitor
  (`server/janitor.ts`, every 30 s from `server/index.ts`) auto-saves decided lobby games after
  two minutes, expires invites after an hour and closes lobbies idle for 30 minutes with nobody
  connected and no live game.
- Chat (`server/chat.ts`): lobby threads (members, and players of its live game) and match
  threads for league matches (league members). A lobby match uses its lobby's thread while the
  lobby exists. 1–280 characters, 20 messages per user per minute, latest 200 per thread kept.
  System messages are complete sentences. Public spectators never receive lobby chat.
