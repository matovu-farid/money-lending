/**
 * Absolute URL helper for emails and other contexts that need a fully
 * qualified link back into the app. Reads env config used by Better Auth /
 * Next public env first; falls back to localhost for local dev.
 */
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  )
}

/** Build an absolute deep link from a path that starts with "/". */
export function absoluteUrl(path: string): string {
  const base = getBaseUrl().replace(/\/+$/, "")
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${base}${suffix}`
}
