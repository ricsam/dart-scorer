import type {
  ApiError,
  AddGuestResponse,
  JoinGuestRequest,
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
  PlayerLeagueStatsResponse,
  LeagueResponse,
  LeaguesResponse,
  UpdateMeResponse,
  User,
} from '../shared/api'

import type { CreateTrainingRequest, TrainingListResponse, TrainingResponse } from '../shared/training'

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
  trainingSessions: () => request<TrainingListResponse>('GET', '/api/training'),
  createTraining: (body: CreateTrainingRequest) => request<TrainingResponse>('POST', '/api/training', body),
  trainingSession: (id: string) => request<TrainingResponse>('GET', `/api/training/${encode(id)}`),
  trainingAction: (id: string, baseVersion: number, action: { type: 'submit'; entry: string } | { type: 'undo' }) =>
    request<TrainingResponse>('POST', `/api/training/${encode(id)}/actions`, { baseVersion, action }),
  deleteTraining: (id: string) => request<void>('DELETE', `/api/training/${encode(id)}`),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (name: string) => request<UpdateMeResponse>('PATCH', '/api/me', { name }),
  myStats: () => request<CareerStatsResponse>('GET', '/api/me/stats'),
  logout: () => request<void>('POST', '/auth/logout'),
  devLogin: (body: DevLoginRequest) => request<{ user: User }>('POST', '/auth/dev-login', body),

  leagues: () => request<LeaguesResponse>('GET', '/api/leagues'),
  createLeague: (name: string) => request<LeagueResponse>('POST', '/api/leagues', { name }),
  addGuest: (leagueId: string, name: string) => request<AddGuestResponse>('POST', `/api/leagues/${encode(leagueId)}/guests`, { name }),
  league: (leagueId: string) => request<LeagueResponse>('GET', `/api/leagues/${encode(leagueId)}`),
  renameLeague: (leagueId: string, name: string) => request<LeagueResponse>('PATCH', `/api/leagues/${encode(leagueId)}`, { name }),
  deleteLeague: (leagueId: string) => request<void>('DELETE', `/api/leagues/${encode(leagueId)}`),
  regenerateInvite: (leagueId: string) => request<InviteCodeResponse>('POST', `/api/leagues/${encode(leagueId)}/invite`),
  removeMember: (leagueId: string, userId: string) => request<void>('DELETE', `/api/leagues/${encode(leagueId)}/members/${encode(userId)}`),
  leaderboard: (leagueId: string, period: LeaderboardPeriod) => request<LeaderboardResponse>('GET', `/api/leagues/${encode(leagueId)}/leaderboard?period=${period}`),
  playerStats: (leagueId: string, userId: string) => request<PlayerLeagueStatsResponse>('GET', `/api/leagues/${encode(leagueId)}/players/${encode(userId)}`),
  leagueMatches: (leagueId: string, before?: string, limit = 20) =>
    request<MatchesResponse>('GET', `/api/leagues/${encode(leagueId)}/matches?limit=${limit}${before ? `&before=${encode(before)}` : ''}`),
  createMatch: (leagueId: string, body: CreateMatchRequest) => request<MatchResponse>('POST', `/api/leagues/${encode(leagueId)}/matches`, body),

  invite: (code: string) => request<InvitePreview>('GET', `/api/invites/${encode(code)}`),
  join: (code: string) => request<JoinResponse>('POST', `/api/invites/${encode(code)}/join`),
  joinGuest: (code: string, body: JoinGuestRequest) => request<JoinResponse>('POST', `/api/invites/${encode(code)}/guest`, body),

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
