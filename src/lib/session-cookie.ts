/** Session cookie identity — kept free of node: imports so the edge
 * middleware can import it without pulling the whole session module. */
export const SESSION_COOKIE = "mb_token";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
