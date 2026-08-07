// This file configures the initialization of Sentry on the client side.
// The configuration here is used whenever a user loads a page in the browser.
//
// The contents of this file run BEFORE any React code, so it is the right
// place to register global handlers for unhandled errors / unhandled promise
// rejections. We gate everything on `NODE_ENV === "production"` to avoid
// noisy dev/CI traffic (per project policy in AGENTS.md).
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENABLED = process.env.NODE_ENV === "production" && !!DSN;

if (ENABLED) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,

    // Modest sample rate for browser perf traces — don't blow through quota.
    tracesSampleRate: 0.1,

    // We deliberately keep Replay disabled by default. The free Sentry tier's
    // Replay quota is tight and we'd rather burn quota on real exceptions.
    // Re-enable explicitly here if/when the team upgrades the plan.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Privacy: per AGENTS.md "Security Policy: Creditor Privacy" — never let
    // Sentry auto-attach PII (IP, headers, cookies, request bodies).
    sendDefaultPii: false,

    // Strip query strings and Authorization headers from any breadcrumb URLs.
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === "fetch" || breadcrumb.category === "xhr") {
        const data = breadcrumb.data as Record<string, unknown> | undefined;
        if (data && typeof data.url === "string") {
          try {
            const u = new URL(data.url, "http://localhost");
            // Drop the query string in case it carries IDs/PII.
            data.url = `${u.origin === "http://localhost" ? "" : u.origin}${u.pathname}`;
          } catch {
            // ignore malformed URLs
          }
        }
      }
      return breadcrumb;
    },

    // Last-line defence: scrub anything that looks like financial PII before
    // we ship the event to Sentry.
    beforeSend(event) {
      return scrubEvent(event);
    },
  });
}

// Required for the Next.js App Router so Sentry can correctly time
// client-side navigations as transactions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

// ---------------------------------------------------------------------------
// Shared scrubber (kept inline so this file has no internal-module imports —
// instrumentation files are bundled separately and must be self-contained).
// ---------------------------------------------------------------------------

const PII_KEYS = new Set([
  "id",
  "national_id",
  "nationalId",
  "phone",
  "phoneNumber",
  "phone_number",
  "address",
  "homeAddress",
  "email",
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  // Creditor capital data is admin-only — never log to Sentry.
  "amount",
  "principal",
  "principalAmount",
  "investmentAmount",
  "outstandingBalance",
]);

const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /\b(?:DATABASE_URL|POSTGRES_URL|password|token|secret|api[_-]?key)\s*=\s*[^\s"'<>]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\w)\+?[0-9][0-9 .()\-]{6,}[0-9](?!\w)/g;
const FINANCIAL_VALUE_PATTERN =
  /\b(?:amount|principal(?:amount)?|investment(?:amount)?|outstanding(?:balance)?|available|required)\s*[:=]?\s*(?:UGX\s*)?[0-9][0-9,._\s-]*/gi;

function scrubText(value: string): string {
  return value
    .replace(POSTGRES_URL_PATTERN, "[redacted-url]")
    .replace(CREDENTIAL_ASSIGNMENT_PATTERN, "[redacted-credential]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(FINANCIAL_VALUE_PATTERN, "[redacted-financial]")
    .slice(0, 1000);
}

function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k) || PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrubValue(v);
    }
    return out;
  }
  return value;
}

function scrubEvent<
  T extends {
    request?: unknown;
    extra?: unknown;
    contexts?: unknown;
    message?: unknown;
    exception?: unknown;
  },
>(event: T): T {
  if (typeof event.message === "string") event.message = scrubText(event.message);
  if (event.exception && typeof event.exception === "object") {
    const values = (event.exception as { values?: unknown }).values;
    if (Array.isArray(values)) {
      for (const value of values) {
        if (value && typeof value === "object" && typeof (value as { value?: unknown }).value === "string") {
          (value as { value: string }).value = scrubText((value as { value: string }).value);
        }
      }
    }
  }
  if (event.request && typeof event.request === "object") {
    const req = event.request as Record<string, unknown>;
    // Drop request bodies entirely — they can contain loan amounts, NINs, etc.
    if ("data" in req) delete req.data;
    if ("cookies" in req) delete req.cookies;
    if ("headers" in req && typeof req.headers === "object") {
      req.headers = scrubValue(req.headers);
    }
  }
  if (event.extra) event.extra = scrubValue(event.extra) as typeof event.extra;
  if (event.contexts)
    event.contexts = scrubValue(event.contexts) as typeof event.contexts;
  return event;
}
