import type { LobbyDetail, LobbySeat, LobbySummary, LobbyVisibility, MatchSettings } from '../src/shared/api'
import { getBot } from '../src/shared/bots'
import type { Services } from './context'
import { buildMatchView, matchSummary, userRef, type MatchRow } from './data'
import type { Db } from './db'
import { INVITE_TTL_MS } from './match-limits'
import { displayRating, globalRatingsFor, INITIAL_RATING } from './ratings'

export type LobbyRow = {
  id: string
  leader_id: string
  visibility: LobbyVisibility
  ranked: number
  capacity: number
  settings: string
  invite_code: string
  created_at: string
  updated_at: string
}

export type SeatRow = {
  id: string
  lobby_id: string
  position: number
  user_id: string | null
  bot_id: string | null
  local_name: string | null
  joined_at: string
  /** Account name and avatar (null for bots and local players). */
  user_name: string | null
  avatar_url: string | null
  is_guest: number | null
}

export const MAX_LOBBY_SEATS = 8

export function loadLobby(db: Db, lobbyId: string | undefined) {
  return lobbyId ? db.get<LobbyRow>('SELECT * FROM lobbies WHERE id = ?', lobbyId) : undefined
}

export function lobbySeats(db: Db, lobbyId: string) {
  return db.all<SeatRow>(
    `SELECT s.*, u.name AS user_name, u.avatar_url, u.is_guest FROM lobby_players s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.lobby_id = ? ORDER BY s.position, s.joined_at, s.id`,
    lobbyId,
  )
}

export const seatName = (seat: SeatRow) => seat.user_name ?? (seat.bot_id ? getBot(seat.bot_id)?.name ?? 'Bot' : seat.local_name ?? 'Player')

/** The lobby the user currently sits in (a player is in at most one lobby). */
export function currentLobbyFor(db: Db, userId: string) {
  return db.get<LobbyRow>('SELECT l.* FROM lobby_players s JOIN lobbies l ON l.id = s.lobby_id WHERE s.user_id = ?', userId)
}

export function liveLobbyMatch(db: Db, lobbyId: string) {
  return db.get<MatchRow>("SELECT * FROM matches WHERE lobby_id = ? AND status = 'live' ORDER BY created_at DESC, id DESC LIMIT 1", lobbyId)
}

export function lastLobbyMatch(db: Db, lobbyId: string) {
  return db.get<MatchRow>("SELECT * FROM matches WHERE lobby_id = ? AND status = 'completed' ORDER BY completed_at DESC, id DESC LIMIT 1", lobbyId)
}

export function lobbySettings(lobby: LobbyRow) {
  return JSON.parse(lobby.settings) as MatchSettings
}

export function hasInvite(db: Db, lobbyId: string, userId: string, now: Date) {
  return !!db.get('SELECT 1 FROM lobby_invites WHERE lobby_id = ? AND user_id = ? AND created_at > ?', lobbyId, userId, new Date(now.getTime() - INVITE_TTL_MS).toISOString())
}

/**
 * Whether a non-member may take a seat. Public lobbies and holders of the invite code or a
 * direct invite may join while there is room; removed players need a fresh direct invite.
 */
export function joinCheck(services: Services, lobby: LobbyRow, userId: string, code?: string | null): { canJoin: boolean; reason: string | null } {
  const { db } = services
  const seats = lobbySeats(db, lobby.id)
  if (seats.some((seat) => seat.user_id === userId)) return { canJoin: false, reason: null }
  const user = db.get<{ is_guest: number }>('SELECT is_guest FROM users WHERE id = ?', userId)
  if (!user || user.is_guest) return { canJoin: false, reason: 'Sign in with Google to play in lobbies.' }
  const invited = hasInvite(db, lobby.id, userId, services.now())
  if (!invited && db.get('SELECT 1 FROM lobby_bans WHERE lobby_id = ? AND user_id = ?', lobby.id, userId)) {
    return { canJoin: false, reason: 'The leader removed you from this lobby.' }
  }
  if (lobby.visibility === 'private' && !invited && code !== lobby.invite_code) {
    return { canJoin: false, reason: 'This lobby is private. Ask the leader for an invite link.' }
  }
  if (seats.length >= lobby.capacity) return { canJoin: false, reason: 'This lobby is full.' }
  return { canJoin: true, reason: null }
}

export function lobbySeatViews(services: Services, lobby: LobbyRow, seats = lobbySeats(services.db, lobby.id)): LobbySeat[] {
  const ratings = globalRatingsFor(services.db, seats.flatMap((seat) => seat.user_id ? [seat.user_id] : []))
  return seats.map((seat): LobbySeat => {
    const rating = seat.user_id ? ratings.get(seat.user_id) : undefined
    return {
      id: seat.id,
      kind: seat.user_id ? 'user' : seat.bot_id ? 'bot' : 'local',
      userId: seat.user_id,
      botId: seat.bot_id,
      name: seatName(seat),
      avatarUrl: seat.avatar_url,
      leader: seat.user_id === lobby.leader_id,
      online: seat.user_id ? services.hub.isOnline(seat.user_id) : true,
      rating: seat.user_id ? displayRating(rating?.rating ?? INITIAL_RATING) : null,
      rankedMatches: rating?.matches ?? 0,
    }
  })
}

export function lobbyDetail(services: Services, lobby: LobbyRow, viewerId: string, code?: string | null): LobbyDetail {
  const { db } = services
  const seats = lobbySeats(db, lobby.id)
  const member = seats.some((seat) => seat.user_id === viewerId)
  const leader = lobby.leader_id === viewerId
  const join = member ? { canJoin: false, reason: null } : joinCheck(services, lobby, viewerId, code)
  const live = liveLobbyMatch(db, lobby.id)
  const last = lastLobbyMatch(db, lobby.id)
  const invited = leader
    ? db.all<{ user_id: string }>('SELECT user_id FROM lobby_invites WHERE lobby_id = ? AND created_at > ? ORDER BY created_at', lobby.id,
      new Date(services.now().getTime() - INVITE_TTL_MS).toISOString()).map((row) => userRef(db, row.user_id))
    : []
  return {
    id: lobby.id,
    leader: userRef(db, lobby.leader_id),
    visibility: lobby.visibility,
    ranked: lobby.ranked === 1,
    capacity: lobby.capacity,
    settings: lobbySettings(lobby),
    seats: lobbySeatViews(services, lobby, seats),
    role: leader ? 'leader' : member ? 'member' : 'visitor',
    canJoin: join.canJoin,
    joinBlockedReason: join.reason,
    inviteCode: member ? lobby.invite_code : null,
    invited,
    match: live ? matchSummary(buildMatchView(db, live)) : null,
    lastMatch: last ? matchSummary(buildMatchView(db, last)) : null,
    createdAt: lobby.created_at,
    updatedAt: lobby.updated_at,
  }
}

export function lobbySummary(services: Services, lobby: LobbyRow): LobbySummary {
  const { db } = services
  const seats = lobbySeats(db, lobby.id)
  const leaderRating = globalRatingsFor(db, [lobby.leader_id]).get(lobby.leader_id)
  return {
    id: lobby.id,
    leader: { ...userRef(db, lobby.leader_id), rating: displayRating(leaderRating?.rating ?? INITIAL_RATING) },
    visibility: lobby.visibility,
    ranked: lobby.ranked === 1,
    capacity: lobby.capacity,
    settings: lobbySettings(lobby),
    seats: seats.map((seat) => ({ name: seatName(seat), avatarUrl: seat.avatar_url, userId: seat.user_id, botId: seat.bot_id })),
    playing: liveLobbyMatch(db, lobby.id) !== undefined,
    createdAt: lobby.created_at,
    updatedAt: lobby.updated_at,
  }
}
