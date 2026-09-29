import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: Db) {
  const current = Number((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (current > MIGRATIONS.length) {
    throw new Error(`Database schema version ${current} is newer than this server (${MIGRATIONS.length}).`)
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.transaction(() => {
      db.raw.exec(MIGRATIONS[version])
      db.raw.exec(`PRAGMA user_version = ${version + 1}`)
    })
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
