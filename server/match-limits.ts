/** Guards against unbounded growth (e.g. endless busts) of a stored match. */
export const MAX_STATE_BYTES = 8 * 1024 * 1024
