"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { signIn } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface LoginFormValues {
  email: string
  password: string
}

export default function LoginPage() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues>({
    defaultValues: { email: "", password: "" },
  })

  function onSubmit(data: LoginFormValues) {
    startTransition(async () => {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      })

      if (result.error) {
        setError("root", {
          message: result.error.message ?? "Invalid email or password. Please try again.",
        })
        return
      }

      // Mark that this browser has logged in before (survives logout)
      document.cookie = "has_account=1; path=/; max-age=315360000; SameSite=Lax"

      // Successful sign-in — proxy.ts will redirect based on role
      router.push("/dashboard")
      router.refresh()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Sign in to Lending Manager</CardTitle>
        <CardDescription>Enter your email and password to continue</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              disabled={isPending}
              {...register("email", { required: "Email is required" })}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
              >
                Forgot your password?
              </Link>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                className="pr-10 placeholder:text-2xl placeholder:leading-[0] focus:placeholder:text-transparent"
                disabled={isPending}
                {...register("password", { required: "Password is required" })}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((prev) => !prev)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          {errors.root && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {errors.root.message}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Register
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
