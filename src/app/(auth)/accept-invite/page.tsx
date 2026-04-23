"use client"

import { useState, useEffect, useTransition, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { signIn } from "@/lib/auth-client"
import { getInviteDetails, acceptInviteAndCreateAccount } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const ROLE_LABELS: Record<string, string> = {
  loanOfficer: "Loan Officer",
  supervisor: "Supervisor",
  admin: "Admin",
  superAdmin: "Super Admin",
}

interface SetPasswordForm {
  password: string
  confirmPassword: string
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </CardContent>
      </Card>
    }>
      <AcceptInviteContent />
    </Suspense>
  )
}

function AcceptInviteContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token") ?? ""

  const [inviteData, setInviteData] = useState<{ name: string; email: string; role: string } | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SetPasswordForm>({
    defaultValues: { password: "", confirmPassword: "" },
  })

  useEffect(() => {
    if (!token) {
      setPageError("No invitation token provided")
      setLoading(false)
      return
    }

    getInviteDetails(token).then((result) => {
      if ("error" in result) {
        setPageError(result.error!)
      } else {
        setInviteData(result.data)
      }
      setLoading(false)
    })
  }, [token])

  function onSubmit(data: SetPasswordForm) {
    if (data.password !== data.confirmPassword) {
      setError("confirmPassword", { message: "Passwords do not match." })
      return
    }

    startTransition(async () => {
      const result = await acceptInviteAndCreateAccount(token, data.password)

      if ("error" in result) {
        setError("root", { message: result.error })
        return
      }

      // Sign in with the new credentials
      const signInResult = await signIn.email({
        email: inviteData!.email,
        password: data.password,
      })

      if (signInResult.error) {
        setError("root", { message: "Account created but sign-in failed. Please go to the login page." })
        return
      }

      document.cookie = "has_account=1; path=/; max-age=315360000; SameSite=Lax"
      router.push("/")
      router.refresh()
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin h-6 w-6 text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (pageError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invitation Invalid</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{pageError}</p>
          <p className="text-sm text-muted-foreground mt-4">
            Contact your administrator for a new invitation.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome, {inviteData!.name}</CardTitle>
        <CardDescription>
          Set your password to join as {ROLE_LABELS[inviteData!.role] ?? inviteData!.role}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={inviteData!.email} disabled />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10 placeholder:text-2xl placeholder:leading-[0] focus:placeholder:text-transparent"
                disabled={isPending}
                {...register("password", {
                  required: "Password is required",
                  minLength: { value: 8, message: "Password must be at least 8 characters" },
                  maxLength: { value: 128, message: "Password is too long (max 128 characters)" },
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="new-password"
                className="pr-10 placeholder:text-2xl placeholder:leading-[0] focus:placeholder:text-transparent"
                disabled={isPending}
                {...register("confirmPassword", {
                  required: "Please confirm your password",
                })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          {errors.root && (
            <div className="text-sm rounded-md px-3 py-2 bg-destructive/10 text-destructive">
              <p>{errors.root.message}</p>
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Setting up your account...
              </>
            ) : (
              "Set Password & Join"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
