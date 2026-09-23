// Cookies are scoped to localhost rather than its port. Give this app its own
// namespace so signing in to another local Better Auth app cannot replace its session.
export const AUTH_COOKIE_PREFIX = "kaks-credit"
