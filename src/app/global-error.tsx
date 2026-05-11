"use client"

// Top-level Next.js App Router error boundary. This catches errors thrown
// from the root layout or any other layout/page that does not have its own
// `error.tsx`. The framework only renders this in production builds.
//
// Sentry-forwarding lives here (in addition to the segment-level error
// boundary at src/app/(app)/error.tsx) because the segment boundary does
// NOT fire when the root layout itself throws.
import * as Sentry from "@sentry/nextjs"
import NextError from "next/error"
import { useEffect } from "react"

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  )
}
