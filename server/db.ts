import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomId } from './ids'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'

type Row = Record<string, unknown>

/**
 * Thin synchronous wrapper around `node:sqlite` with a prepared-statement cache.
 * Everything is synchronous, so a read-modify-write inside one handler cannot interleave with another request.
 */
export class Db {
  readonly raw: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()

  constructor(raw: DatabaseSync) {
    this.raw = raw
  }

  private statement(sql: string) {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.raw.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.statement(sql).get(...params) as T | undefined
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.statement(sql).all(...params) as T[]
  }

  run(sql: string, ...params: SQLInputValue[]) {
    return this.statement(sql).run(...params)
  }

  /** Runs `fn` in a write transaction (joins the current one when nested). */
  transaction<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK')
      throw error
    }
  }

  close() {
    this.statements.clear()
    if (this.raw.isOpen) this.raw.close()
  }
}

const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_expires ON sessions(expires_at);

  CREATE TABLE oauth_states (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    return_to TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX oauth_states_created ON oauth_states(created_at);

  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX rooms_owner ON rooms(owner_id);

  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );
  CREATE INDEX room_members_user ON room_members(user_id);

  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('live', 'completed')),
    settings TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX matches_room_status_completed ON matches(room_id, status, completed_at);
  CREATE INDEX matches_room_created ON matches(room_id, created_at);

  CREATE TABLE match_players (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    user_id TEXT REFERENCES users(id),
    name TEXT NOT NULL,
    PRIMARY KEY (match_id, slot)
  );
  CREATE INDEX match_players_user ON match_players(user_id);

  CREATE TABLE match_results (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    placing INTEGER NOT NULL,
    won INTEGER NOT NULL,
    legs_won INTEGER NOT NULL,
    legs_played INTEGER NOT NULL,
    darts INTEGER NOT NULL,
    points INTEGER NOT NULL,
    visits INTEGER NOT NULL,
    first9_points INTEGER NOT NULL,
    first9_darts INTEGER NOT NULL,
    scores_180 INTEGER NOT NULL,
    scores_140 INTEGER NOT NULL,
    scores_100 INTEGER NOT NULL,
    checkout_attempts INTEGER NOT NULL,
    checkouts INTEGER NOT NULL,
    highest_checkout INTEGER NOT NULL,
    best_leg_darts INTEGER,
    rating_before REAL,
    rating_after REAL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (match_id, slot)
  );
  CREATE INDEX match_results_room_completed ON match_results(room_id, completed_at, match_id);
  CREATE INDEX match_results_room_user ON match_results(room_id, user_id, completed_at);
  CREATE INDEX match_results_user ON match_results(user_id, completed_at);
  `,
  // 2 — room-scoped guests; historical results and game state are left untouched.
  `
  ALTER TABLE users ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN guest_room_id TEXT;
  ALTER TABLE users ADD COLUMN guest_name_key TEXT;
  ALTER TABLE users ADD COLUMN claimed INTEGER NOT NULL DEFAULT 1;
  CREATE UNIQUE INDEX users_guest_name ON users(guest_room_id, guest_name_key) WHERE is_guest = 1;
  ALTER TABLE match_players ADD COLUMN guest_id TEXT REFERENCES users(id);
  CREATE INDEX match_players_guest ON match_players(guest_id);
  `,
  // 3 — bots are match participants, never users or claimable guests.
  `
  ALTER TABLE match_players ADD COLUMN bot_id TEXT
    CHECK (bot_id IS NULL OR (user_id IS NULL AND guest_id IS NULL));
  `,
  // 4 — training is deliberately isolated from match results and ratings.
  `
  CREATE TABLE training_sessions (
    id TEXT PRIMARY KEY,
    room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL CHECK (mode IN ('around-clock', 'nine-dart')),
    status TEXT NOT NULL CHECK (status IN ('live', 'completed')),
    players TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX training_created ON training_sessions(created_at);
  CREATE INDEX training_creator_status ON training_sessions(created_by, status);
  `,
  // 5 — rooms become leagues; matches may belong to a lobby instead of a league; lobbies and chat.
  // matches/match_results are rebuilt (SQLite cannot drop NOT NULL) with foreign keys disabled,
  // so dropping the old tables never cascades into players, results or other dependants.
  `
  ALTER TABLE rooms RENAME TO leagues;
  ALTER TABLE room_members RENAME TO league_members;
  ALTER TABLE league_members RENAME COLUMN room_id TO league_id;
  ALTER TABLE users RENAME COLUMN guest_room_id TO guest_league_id;
  ALTER TABLE training_sessions RENAME COLUMN room_id TO league_id;
  DROP INDEX rooms_owner;
  CREATE INDEX leagues_owner ON leagues(owner_id);
  DROP INDEX room_members_user;
  CREATE INDEX league_members_user ON league_members(user_id);
  ALTER TABLE users ADD COLUMN play_settings TEXT;

  CREATE TABLE matches_v5 (
    id TEXT PRIMARY KEY,
    league_id TEXT REFERENCES leagues(id) ON DELETE CASCADE,
    lobby_id TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL CHECK (status IN ('live', 'completed')),
    ranked INTEGER NOT NULL DEFAULT 0 CHECK (ranked IN (0, 1)),
    practice INTEGER NOT NULL DEFAULT 0 CHECK (practice IN (0, 1)),
    forfeit_slot INTEGER,
    settings TEXT NOT NULL,
    state TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    CHECK (league_id IS NOT NULL OR lobby_id IS NOT NULL)
  );
  INSERT INTO matches_v5 (id, league_id, lobby_id, created_by, status, ranked, practice, forfeit_slot, settings, state, version, created_at, updated_at, completed_at)
    SELECT m.id, m.room_id, NULL, m.created_by, m.status, 0,
      EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id AND p.bot_id IS NOT NULL),
      NULL, m.settings, m.state, m.version, m.created_at, m.updated_at, m.completed_at
    FROM matches m;
  DROP TABLE matches;
  ALTER TABLE matches_v5 RENAME TO matches;
  CREATE INDEX matches_league_status_completed ON matches(league_id, status, completed_at);
  CREATE INDEX matches_league_created ON matches(league_id, created_at);
  CREATE INDEX matches_lobby ON matches(lobby_id);
  CREATE INDEX matches_status_updated ON matches(status, updated_at);

  CREATE TABLE match_results_v5 (
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    league_id TEXT REFERENCES leagues(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    placing INTEGER NOT NULL,
    won INTEGER NOT NULL,
    legs_won INTEGER NOT NULL,
    legs_played INTEGER NOT NULL,
    darts INTEGER NOT NULL,
    points INTEGER NOT NULL,
    visits INTEGER NOT NULL,
    first9_points INTEGER NOT NULL,
    first9_darts INTEGER NOT NULL,
    scores_180 INTEGER NOT NULL,
    scores_140 INTEGER NOT NULL,
    scores_100 INTEGER NOT NULL,
    checkout_attempts INTEGER NOT NULL,
    checkouts INTEGER NOT NULL,
    highest_checkout INTEGER NOT NULL,
    best_leg_darts INTEGER,
    rating_before REAL,
    rating_after REAL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (match_id, slot)
  );
  INSERT INTO match_results_v5 (match_id, slot, league_id, user_id, placing, won, legs_won, legs_played, darts, points, visits,
      first9_points, first9_darts, scores_180, scores_140, scores_100, checkout_attempts, checkouts, highest_checkout,
      best_leg_darts, rating_before, rating_after, completed_at)
    SELECT match_id, slot, room_id, user_id, placing, won, legs_won, legs_played, darts, points, visits,
      first9_points, first9_darts, scores_180, scores_140, scores_100, checkout_attempts, checkouts, highest_checkout,
      best_leg_darts, rating_before, rating_after, completed_at
    FROM match_results;
  DROP TABLE match_results;
  ALTER TABLE match_results_v5 RENAME TO match_results;
  CREATE INDEX match_results_league_completed ON match_results(league_id, completed_at, match_id);
  CREATE INDEX match_results_league_user ON match_results(league_id, user_id, completed_at);
  CREATE INDEX match_results_user ON match_results(user_id, completed_at);
  CREATE INDEX match_results_completed ON match_results(completed_at, match_id);

  CREATE TABLE lobbies (
    id TEXT PRIMARY KEY,
    leader_id TEXT NOT NULL REFERENCES users(id),
    visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
    ranked INTEGER NOT NULL CHECK (ranked IN (0, 1)),
    capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 8),
    settings TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    match_id TEXT,
    last_match_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX lobbies_listing ON lobbies(visibility, updated_at);

  -- One seat per account across all lobbies: a player is in at most one lobby at a time.
  CREATE TABLE lobby_players (
    id TEXT PRIMARY KEY,
    lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT,
    local_name TEXT,
    joined_at TEXT NOT NULL,
    CHECK ((user_id IS NOT NULL) + (bot_id IS NOT NULL) + (local_name IS NOT NULL) = 1)
  );
  CREATE UNIQUE INDEX lobby_players_user ON lobby_players(user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX lobby_players_bot ON lobby_players(lobby_id, bot_id) WHERE bot_id IS NOT NULL;
  CREATE INDEX lobby_players_lobby ON lobby_players(lobby_id, position);

  CREATE TABLE lobby_invites (
    lobby_id TEXT NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (lobby_id, user_id)
  );
  CREATE INDEX lobby_invites_user ON lobby_invites(user_id, created_at);

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    lobby_id TEXT REFERENCES lobbies(id) ON DELETE CASCADE,
    match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('text', 'system')),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((lobby_id IS NULL) <> (match_id IS NULL))
  );
  CREATE INDEX chat_lobby ON chat_messages(lobby_id, created_at);
  CREATE INDEX chat_match ON chat_messages(match_id, created_at);
  `,
]

/** Migrations that rebuild tables run with foreign keys disabled (SQLite's documented procedure). */
const REBUILDS = new Set([4])

export const SCHEMA_VERSION = MIGRATIONS.length

/** Migrates to `target` (default: the latest schema). Each step is one transaction. */
export function migrate(db: Db, target = MIGRATIONS.length) {
  const current = Number((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema version ${current} is newer than this server (${MIGRATIONS.length}).`)
  }
  for (let version = current; version < Math.min(target, MIGRATIONS.length); version += 1) {
    const rebuild = REBUILDS.has(version)
    // `PRAGMA foreign_keys` cannot change inside a transaction, so toggle it around the step.
    const foreignKeys = Number((db.raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys)
    if (rebuild && foreignKeys) db.raw.exec('PRAGMA foreign_keys = OFF')
    try {
      db.transaction(() => {
        db.raw.exec(MIGRATIONS[version])
        if (version === 1) migrateLegacyGuests(db)
        if (rebuild && db.all('PRAGMA foreign_key_check').length) throw new Error(`Migration ${version + 1} left dangling references.`)
        db.raw.exec(`PRAGMA user_version = ${version + 1}`)
      })
    } finally {
      if (rebuild && foreignKeys) db.raw.exec('PRAGMA foreign_keys = ON')
    }
  }
}

function migrateLegacyGuests(db: Db) {
  const rows = db.all<{ match_id: string; slot: number; name: string; room_id: string; created_at: string }>(
    'SELECT p.match_id, p.slot, p.name, m.room_id, m.created_at FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id IS NULL ORDER BY m.created_at, p.match_id, p.slot',
  )
  for (const row of rows) {
    const key = row.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
    if (!key) continue
    let guest = db.get<{ id: string }>('SELECT id FROM users WHERE is_guest = 1 AND guest_room_id = ? AND guest_name_key = ?', row.room_id, key)
    // Ambiguous same-name slots in one legacy match remain anonymous rather than merging players.
    if (guest && db.get('SELECT 1 FROM match_players WHERE match_id = ? AND guest_id = ?', row.match_id, guest.id)) continue
    if (!guest) {
      const members = db.all<{ name: string }>('SELECT u.name FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ?', row.room_id)
      if (members.length >= 100 || members.some((member) => member.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() === key)) continue
      const id = randomId()
      db.run("INSERT INTO users (id, google_sub, email, name, created_at, last_login_at, is_guest, guest_room_id, guest_name_key, claimed) VALUES (?, ?, '', ?, ?, ?, 1, ?, ?, 0)", id, `guest:${id}`, row.name, row.created_at, row.created_at, row.room_id, key)
      db.run("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)", row.room_id, id, row.created_at)
      guest = { id }
    }
    db.run('UPDATE match_players SET guest_id = ? WHERE match_id = ? AND slot = ?', guest.id, row.match_id, row.slot)
  }
}

/** Opens (creating directories as needed) and migrates the database. `:memory:` is supported. */
export function openDatabase(path: string): Db {
  if (path !== ':memory:' && !path.startsWith('file:')) mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA busy_timeout = 5000')
  raw.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') {
    raw.exec('PRAGMA journal_mode = WAL')
    raw.exec('PRAGMA synchronous = NORMAL')
  }
  const db = new Db(raw)
  migrate(db)
  return db
}
