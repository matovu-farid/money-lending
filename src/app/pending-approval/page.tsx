"use client"

import Link from "next/link"
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

export default function PendingApprovalPage() {
  async function handleSignOut() {
    await signOut()
    window.location.href = "/login"
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Account Pending Approval</CardTitle>
            <CardDescription>
              Your account has been created successfully
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-foreground">
              An administrator will assign your role shortly. You&apos;ll be able to
              access the system once your role is confirmed.
            </p>
            <p className="text-sm text-muted-foreground">
              Questions? Contact your system administrator.
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSignOut}
            >
              Sign out
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Already been assigned a role?{" "}
              <Link
                href="/login"
                className="text-foreground underline-offset-4 hover:underline"
              >
                Sign in again
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
