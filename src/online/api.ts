import type {
  ApiError,
  CareerStatsResponse,
  CreateMatchRequest,
  DevLoginRequest,
  InviteCodeResponse,
  InvitePreview,
  JoinResponse,
  LeaderboardPeriod,
  LeaderboardResponse,
  MatchActionRequest,
  MatchesResponse,
  MatchResponse,
  MeResponse,
  PlayerRoomStatsResponse,
  RoomResponse,
  RoomsResponse,
  UpdateMeResponse,
  User,
} from '../shared/api'

export class ApiRequestError extends Error {
  readonly status: number
  readonly body: (ApiError & Record<string, unknown>) | null

  constructor(status: number, body: (ApiError & Record<string, unknown>) | null) {
    super(body?.message ?? (status === 0 ? 'Could not reach the server. Check your connection.' : `Request failed (${status})`))
    this.status = status
    this.body = body
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Explicit JSON also for bodyless mutations: some proxies expose an empty chunked body.
  const payload = body === undefined && !['GET', 'HEAD'].includes(method) ? {} : body
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: payload === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
  } catch {
    throw new ApiRequestError(0, null)
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new ApiRequestError(response.status, data && typeof data === 'object' && 'message' in data ? data as ApiError & Record<string, unknown> : null)
  return data as T
}

const encode = encodeURIComponent

export const api = {
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (name: string) => request<UpdateMeResponse>('PATCH', '/api/me', { name }),
  myStats: () => request<CareerStatsResponse>('GET', '/api/me/stats'),
  logout: () => request<void>('POST', '/auth/logout'),
  devLogin: (body: DevLoginRequest) => request<{ user: User }>('POST', '/auth/dev-login', body),

  rooms: () => request<RoomsResponse>('GET', '/api/rooms'),
  createRoom: (name: string) => request<RoomResponse>('POST', '/api/rooms', { name }),
  room: (roomId: string) => request<RoomResponse>('GET', `/api/rooms/${encode(roomId)}`),
  renameRoom: (roomId: string, name: string) => request<RoomResponse>('PATCH', `/api/rooms/${encode(roomId)}`, { name }),
  deleteRoom: (roomId: string) => request<void>('DELETE', `/api/rooms/${encode(roomId)}`),
  regenerateInvite: (roomId: string) => request<InviteCodeResponse>('POST', `/api/rooms/${encode(roomId)}/invite`),
  removeMember: (roomId: string, userId: string) => request<void>('DELETE', `/api/rooms/${encode(roomId)}/members/${encode(userId)}`),
  leaderboard: (roomId: string, period: LeaderboardPeriod) => request<LeaderboardResponse>('GET', `/api/rooms/${encode(roomId)}/leaderboard?period=${period}`),
  playerStats: (roomId: string, userId: string) => request<PlayerRoomStatsResponse>('GET', `/api/rooms/${encode(roomId)}/players/${encode(userId)}`),
  roomMatches: (roomId: string, before?: string, limit = 20) =>
    request<MatchesResponse>('GET', `/api/rooms/${encode(roomId)}/matches?limit=${limit}${before ? `&before=${encode(before)}` : ''}`),
  createMatch: (roomId: string, body: CreateMatchRequest) => request<MatchResponse>('POST', `/api/rooms/${encode(roomId)}/matches`, body),

  invite: (code: string) => request<InvitePreview>('GET', `/api/invites/${encode(code)}`),
  join: (code: string) => request<JoinResponse>('POST', `/api/invites/${encode(code)}/join`),

  match: (matchId: string) => request<MatchResponse>('GET', `/api/matches/${encode(matchId)}`),
  matchAction: (matchId: string, body: MatchActionRequest) => request<MatchResponse>('POST', `/api/matches/${encode(matchId)}/actions`, body),
  finishMatch: (matchId: string, baseVersion: number) => request<MatchResponse>('POST', `/api/matches/${encode(matchId)}/finish`, { baseVersion }),
  deleteMatch: (matchId: string) => request<void>('DELETE', `/api/matches/${encode(matchId)}`),
}

export const googleSignInUrl = (returnTo = '/') => `/auth/google?returnTo=${encode(returnTo)}`

export function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
