"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { useForm } from "react-hook-form"
import { submitAccessRequest } from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type RequestAccessFormValues = {
  name: string
  email: string
  phone: string
  organization: string
  message: string
}

const CONTACT_ERROR = "Please provide an email address or phone/WhatsApp number."

export default function RequestAccessPage() {
  const [submittedName, setSubmittedName] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RequestAccessFormValues>({
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      organization: "",
      message: "",
    },
  })

  function onSubmit(data: RequestAccessFormValues) {
    setError("root", { message: undefined })

    if (!data.email.trim() && !data.phone.trim()) {
      setError("root", { message: CONTACT_ERROR })
      return
    }

    startTransition(async () => {
      const result = await submitAccessRequest(data)
      if ("error" in result) {
        setError(result.field === "name" ? "name" : "root", {
          message: result.error,
        })
        return
      }

      setSubmittedName(data.name.trim())
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>Request access</h1>
        </CardTitle>
        <CardDescription>
          Tell us a little about yourself and we&apos;ll get in touch to learn how we can help.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {submittedName ? (
          <div className="space-y-4 rounded-md bg-muted px-4 py-4 text-sm text-foreground">
            <p className="font-medium">Thanks, {submittedName}.</p>
            <p>
              We&apos;ve received your request and will follow up using the contact
              information you provided.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                autoComplete="name"
                maxLength={100}
                disabled={isPending}
                {...register("name", {
                  required: "Name is required.",
                  validate: (value) => value.trim() !== "" || "Name is required.",
                })}
              />
              {errors.name && (
                <p className="text-sm text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                maxLength={254}
                disabled={isPending}
                {...register("email")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone / WhatsApp</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+256 700 000000"
                autoComplete="tel"
                maxLength={50}
                disabled={isPending}
                {...register("phone")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="organization">Business or organization</Label>
              <Input
                id="organization"
                type="text"
                placeholder="Optional"
                maxLength={200}
                disabled={isPending}
                {...register("organization")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="message">How can we help?</Label>
              <Textarea
                id="message"
                placeholder="Tell us a little about what you need (optional)"
                maxLength={1000}
                disabled={isPending}
                {...register("message")}
              />
            </div>

            {errors.root?.message && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errors.root.message}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send request"
              )}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
