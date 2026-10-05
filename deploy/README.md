# Hosted online edition

Host: https://darts-v7rm7qivt07h.r5d.app — Cloudflare → Traefik → Oche.
Namespace: `dart-scorer`; workload/service/ingress: `oche`; data PVC: `oche-data` (`rook-ceph-block`, RWO, 2 GiB).

The application is a single Node 24 process, on `hetzner-kata-2`, UID 1000, read-only root filesystem. The SQLite database and WAL live on `/data`. Do not scale above one replica: SSE and rate limits are process-local. Never delete/recreate the PVC on upgrades.

OAuth credentials are in Secret `oche-google` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). It is intentionally absent from source. Registry credentials are supplied by the existing `ghcr-registry` reflection. No CI cluster credentials or widened RBAC are needed.

## Image publishing access

The private `ghcr.io/ricsam/dart-scorer` package grants **Write** to `ricsam/dart-scorer` under **Package settings → Manage Actions access**. This lets the manual publishing workflow use its existing `GITHUB_TOKEN` with `packages: write`. If publishing fails with `permission_denied: read_package`, check this package-level repository grant; do not make the package public, grant Admin, or add a long-lived CI token to work around it. Package access does not grant cluster access or automatically deploy an image.

## Updates

1. Run lint, typecheck, unit/API tests and Playwright locally.
2. Build/publish an immutable image (the manual `Publish online image` workflow publishes a SHA tag).
3. Review the live deployment and a scoped server dry-run/diff. Substitute the image digest in the manifest; apply only this application's resources.
4. Wait for rollout, check `/readyz` and `/api/me` (`auth.google=true`, `auth.dev=false`), and check a league from an existing signed-in session.

Use `kubectl --context ricsam` with the existing account credential. The account gateway profile has owner-approved cluster access; pinned SSH to `hetzner` and `k3s kubectl` remains an independent administrative route. Do not broaden workflow trust or RBAC merely to deploy.

## Backups

**Ceph persistence is not a backup.** No scheduled off-host database backup is installed by this change. Before a schema upgrade, take a consistent SQLite backup with the Node `node:sqlite` `backup()` API (or SQLite's online backup command) and copy it to protected off-host storage. Do not copy only `oche.db` while WAL writes are running; that can omit committed transactions. Backups contain account data and session hashes; restrict access and do not commit them. Keep both source and destination until a restore has been verified in a separate throwaway environment.

For a stopped, quiescent application, copying the entire data directory including WAL is another option. A rollback of code must not roll back authoritative user data. Migrations use `PRAGMA user_version`; an older server refuses a newer schema.

## Security / limitations

- Google authentication requests basic identity only; no access/refresh tokens are retained. Sessions are random opaque HttpOnly/SameSite cookies whose hashes are stored in SQLite.
- League/match reads are membership-scoped. Invite links are bearer capabilities to join; hosts can rotate them.
- Changes require same-origin JSON and use per-user limits. Proxy IP headers must be trustworthy when `TRUST_PROXY=true`.
- Recorded matches are self-reported. This is not an anti-cheat or tournament certification service.
- Account erasure is currently an operator operation: account references in leagues/matches must be handled deliberately, not by blindly deleting a user row. No automatic retention/erasure policy is implemented.
- Google may show the authorized domain (`r5d.app`) rather than the app name on its consent screen until branding verification is completed. Basic sign-in works without sensitive scopes.
