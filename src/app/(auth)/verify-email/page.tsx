"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function VerifyEmailPage() {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function handleResend() {
    setResending(true)
    await authClient.sendVerificationEmail({
      email: "", // Better Auth uses the current session's email
      callbackURL: "/login",
    })
    setResent(true)
    setResending(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Check your email</CardTitle>
        <CardDescription>
          We sent a verification link to your email address.
          Please click the link to verify your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted px-4 py-3 text-sm text-foreground">
          Once verified, you can sign in to continue.
        </div>

        {resent ? (
          <p className="text-sm text-muted-foreground">
            Verification email resent. Check your inbox and spam folder.
          </p>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            disabled={resending}
          >
            {resending ? "Sending..." : "Resend verification email"}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
