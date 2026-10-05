import { Hono } from 'hono'
import { CHAT_MAX_LENGTH, type ChatMessage, type ChatPostResponse, type ChatResponse } from '../src/shared/api'
import { requireUser } from './auth'
import { nowIso, type AppEnv, type Services } from './context'
import { buildMatchView, canChat, requireMatchRow, type MatchView } from './data'
import type { Db } from './db'
import { publishChat } from './events'
import { assertRateLimit } from './security'
import { expectObject, expectText, forbidden, notFound, readJson } from './http'
import { randomId } from './ids'
import { loadLobby } from './lobby-data'
import { toUserRef } from './users'

export const CHAT_HISTORY = 100
/** Older messages are pruned so a long-lived lobby cannot grow without bound. */
export const CHAT_RETAINED = 200

export type ChatThread = { lobbyId: string } | { matchId: string }

type MessageRow = { id: string; user_id: string; kind: 'text' | 'system'; body: string; created_at: string; name: string; avatar_url: string | null }

function toMessage(row: MessageRow): ChatMessage {
  return { id: row.id, user: toUserRef({ id: row.user_id, name: row.name, avatar_url: row.avatar_url }), kind: row.kind, body: row.body, createdAt: row.created_at }
}

const threadColumn = (thread: ChatThread) => 'lobbyId' in thread ? 'lobby_id' : 'match_id'
const threadId = (thread: ChatThread) => 'lobbyId' in thread ? thread.lobbyId : thread.matchId

export function chatMessages(db: Db, thread: ChatThread, limit = CHAT_HISTORY): ChatMessage[] {
  const column = threadColumn(thread)
  return db.all<MessageRow>(
    `SELECT c.id, c.user_id, c.kind, c.body, c.created_at, u.name, u.avatar_url
     FROM chat_messages c JOIN users u ON u.id = c.user_id
     WHERE c.${column} = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT ?`,
    threadId(thread), limit,
  ).reverse().map(toMessage)
}

/** Stores and broadcasts a message. System messages are complete sentences; `userId` caused them. */
export function addChatMessage(services: Services, thread: ChatThread, userId: string, body: string, kind: 'text' | 'system' = 'text'): ChatMessage {
  const { db } = services
  const column = threadColumn(thread)
  const id = randomId()
  const createdAt = nowIso(services)
  db.transaction(() => {
    db.run(`INSERT INTO chat_messages (id, ${column}, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`, id, threadId(thread), userId, kind, body, createdAt)
    db.run(
      `DELETE FROM chat_messages WHERE ${column} = ? AND rowid NOT IN (
         SELECT rowid FROM chat_messages WHERE ${column} = ? ORDER BY created_at DESC, rowid DESC LIMIT ${CHAT_RETAINED})`,
      threadId(thread), threadId(thread),
    )
  })
  const user = db.get<{ name: string; avatar_url: string | null }>('SELECT name, avatar_url FROM users WHERE id = ?', userId)
  const message = toMessage({ id, user_id: userId, kind, body, created_at: createdAt, name: user?.name ?? 'Player', avatar_url: user?.avatar_url ?? null })
  publishChat(services, thread, message)
  return message
}

/** Lobby chat readers: current members, and players of the lobby's live game who have since left. */
export function canUseLobbyChat(db: Db, lobbyId: string, userId: string) {
  return !!db.get('SELECT 1 FROM lobby_players WHERE lobby_id = ? AND user_id = ?', lobbyId, userId)
    || !!db.get(
      `SELECT 1 FROM match_players p JOIN matches m ON m.id = p.match_id
       WHERE m.lobby_id = ? AND m.status = 'live' AND p.user_id = ?`,
      lobbyId, userId,
    )
}

/** A lobby match shares the lobby's chat while the lobby exists; otherwise it has its own thread. */
export function matchThread(view: MatchView): ChatThread {
  return view.row.lobby_id ? { lobbyId: view.row.lobby_id } : { matchId: view.row.id }
}

export function chatRoutes(services: Services) {
  const { db } = services
  const app = new Hono<AppEnv>()

  const readBody = async (c: Parameters<typeof requireUser>[0]) => {
    const body = expectObject(await readJson(c))
    return expectText(body.body, 'Message', 1, CHAT_MAX_LENGTH)
  }

  const lobbyThread = (lobbyId: string | undefined, userId: string): ChatThread => {
    const lobby = loadLobby(db, lobbyId)
    if (!lobby || !canUseLobbyChat(db, lobby.id, userId)) throw notFound('Lobby not found.')
    return { lobbyId: lobby.id }
  }

  const matchChat = (matchId: string | undefined, userId: string) => {
    const view = buildMatchView(db, requireMatchRow(db, matchId, userId).match)
    if (!canChat(view, userId)) throw forbidden('Only players and members can chat in this match.')
    return matchThread(view)
  }

  app.get('/lobbies/:lobbyId/chat', (c) => {
    const user = requireUser(c)
    return c.json<ChatResponse>({ messages: chatMessages(db, lobbyThread(c.req.param('lobbyId'), user.id)) })
  })

  app.post('/lobbies/:lobbyId/chat', async (c) => {
    const user = requireUser(c)
    lobbyThread(c.req.param('lobbyId'), user.id)
    const body = await readBody(c)
    assertRateLimit(services.chatLimiter, user.id)
    const thread = lobbyThread(c.req.param('lobbyId'), user.id) // membership may have changed while reading
    return c.json<ChatPostResponse>({ message: addChatMessage(services, thread, user.id, body) }, 201)
  })

  app.get('/matches/:matchId/chat', (c) => {
    const user = requireUser(c)
    return c.json<ChatResponse>({ messages: chatMessages(db, matchChat(c.req.param('matchId'), user.id)) })
  })

  app.post('/matches/:matchId/chat', async (c) => {
    const user = requireUser(c)
    matchChat(c.req.param('matchId'), user.id)
    const body = await readBody(c)
    assertRateLimit(services.chatLimiter, user.id)
    const thread = matchChat(c.req.param('matchId'), user.id)
    return c.json<ChatPostResponse>({ message: addChatMessage(services, thread, user.id, body) }, 201)
  })

  return app
}
