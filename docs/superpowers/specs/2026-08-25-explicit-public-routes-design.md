# Explicit Public Routes Design

## Goal

Keep `/` as the application’s smart entry point while making explicit visits to `/home` and `/request-access` render those public pages directly.

## Route contract

| Request | Expected behavior |
| --- | --- |
| `/` without a session or account marker | Redirect to `/home` |
| `/` with `has_account` but no valid session | Redirect to `/login` |
| `/` with a valid assigned session | Redirect to `/dashboard` |
| `/home` | Render the public landing page regardless of cookies/session state |
| `/request-access` | Render the public request-access form regardless of cookies/session state |
| `/home/anything` | Use the normal auth gate |
| `/request-access/anything` | Use the normal auth gate |

The public-route exception applies to exact paths only. It does not make similarly named child paths public.

## Architecture

`src/proxy.ts` will define an exact-match public route allowlist and return `NextResponse.next()` before session-cookie inspection for those routes. `/` keeps its existing cookie-aware redirect branch. The generic `AUTH_PAGES` list remains responsible for login and account-flow routes; `/home` and `/request-access` are not treated as auth pages because authenticated visitors must also be able to open them directly.

## Testing

Cypress will cover the route matrix through browser-visible behavior:

- root routing for first-time, returning, and authenticated visitors;
- explicit `/home` with and without `has_account`;
- explicit `/request-access` with and without `has_account`;
- authenticated visitors opening both public routes;
- child paths remaining behind the auth gate.

The existing request-access form and landing-page assertions remain in place. Tests will not rely only on the proxy implementation or on URL absence; they will assert the expected page content.

## Scope

This change only updates proxy routing and route-level Cypress coverage. It does not change authentication, cookies, page content, server actions, or request-access submission behavior.
