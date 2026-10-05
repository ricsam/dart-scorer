/** Guards against unbounded growth (e.g. endless busts) of a stored match. */
export const MAX_STATE_BYTES = 8 * 1024 * 1024

/** In lobby matches between accounts, the active player can be claimed after this long without any change. */
export const CLAIM_AFTER_MS = 3 * 60 * 1000

/** Lobby matches whose final leg is won are saved automatically after this long. */
export const AUTO_SAVE_AFTER_MS = 2 * 60 * 1000

/** Open lobbies nobody is connected to are closed after this long without changes. */
export const LOBBY_IDLE_MS = 30 * 60 * 1000

/** Direct lobby invites expire after this long. */
export const INVITE_TTL_MS = 60 * 60 * 1000
