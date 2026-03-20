"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { createCustomerAction } from "@/actions/customer.actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function NewCustomerPage() {
  const router = useRouter()
  const [fullName, setFullName] = useState("")
  const [contact, setContact] = useState("")
  const [address, setAddress] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Client-side required-field checks — no Zod
    const errors: Record<string, string> = {}
    if (!fullName.trim()) errors.fullName = "Full name is required"
    if (!contact.trim()) errors.contact = "Contact is required"
    if (!address.trim()) errors.address = "Address is required"

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})
    setSubmitting(true)

    const result = await createCustomerAction({
      fullName: fullName.trim(),
      contact: contact.trim(),
      address: address.trim(),
    })

    setSubmitting(false)

    if ("error" in result) {
      toast.error(result.error)
      return
    }

    router.push(`/customers/${result.data.id}`)
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Register Customer</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Add a new customer to the system.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Doe"
                disabled={submitting}
              />
              {fieldErrors.fullName && (
                <p className="text-destructive text-xs">{fieldErrors.fullName}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="contact">Contact</Label>
              <Input
                id="contact"
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Phone number or email"
                disabled={submitting}
              />
              {fieldErrors.contact && (
                <p className="text-destructive text-xs">{fieldErrors.contact}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="address">Physical Address</Label>
              <Input
                id="address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Kampala, Uganda"
                disabled={submitting}
              />
              {fieldErrors.address && (
                <p className="text-destructive text-xs">{fieldErrors.address}</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? "Registering..." : "Register Customer"}
              </Button>
              <Link
                href="/customers"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
