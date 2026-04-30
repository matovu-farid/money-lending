"use client"

import { useEffect, useState } from "react"
import { signOut } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function AccessBlockedPage() {
  const [ip, setIp] = useState<string | null>(null)

  useEffect(() => {
    // Best-effort: fetch the user's current IP for support diagnostics.
    // Uses a public lookup; failure is silent.
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((j) => setIp(j.ip ?? null))
      .catch(() => setIp(null))
  }, [])

  async function handleSignOut() {
    await signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Access Blocked</CardTitle>
            <CardDescription>
              This device or network isn&apos;t recognized
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground">
              Your administrator has restricted access to trusted networks.
              Sign in from a known location, or ask an administrator to log in
              here so this network becomes trusted.
            </p>
            {ip && (
              <p className="text-xs text-muted-foreground font-mono">
                Your current IP: {ip}
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
