import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["jspdf", "jspdf-autotable"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

// Sentry build-time integration: uploads source maps so production stack
// traces resolve to real files in the Sentry UI, and adds tunnel route
// support to dodge ad-blockers.
//
// withSentryConfig is a no-op for runtime — it only touches the build. We
// still gate the *runtime* SDK behind NODE_ENV === "production" inside the
// init files (instrumentation.ts, instrumentation-client.ts), so dev builds
// neither upload maps (no SENTRY_AUTH_TOKEN locally) nor emit events.
//
// Source-map upload is skipped automatically when SENTRY_AUTH_TOKEN is
// missing, so local builds Just Work without any extra flag.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "farid-org",
  project: process.env.SENTRY_PROJECT ?? "money-lending",

  // Auth token only needed at build time for source-map upload. Set in the
  // Vercel dashboard (NOT committed) — see .env.example.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress all sentry-cli stdout except in CI so local builds stay quiet.
  silent: !process.env.CI,

  // Route browser SDK traffic through our own domain so ad-blockers don't
  // drop client-side error reports.
  tunnelRoute: "/monitoring",

  sourcemaps: {
    // Skip the source-map upload entirely when there's no auth token —
    // i.e. local builds and any deploy where the secret was forgotten.
    // Avoids "missing SENTRY_AUTH_TOKEN" warnings filling the build log.
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
