"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createCustomerAction } from "@/actions/customer.actions"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function NewCustomerPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState("")
  const [contact, setContact] = useState("")
  const [address, setAddress] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: (input: { fullName: string; contact: string; address: string }) =>
      createCustomerAction(input),
    onMutate: async (input) => {
      const tempId = crypto.randomUUID()
      const optimisticCustomer = {
        id: tempId,
        fullName: input.fullName,
        contact: input.contact,
        address: input.address,
        status: "active" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      queryClient.setQueryData(["customer", tempId], optimisticCustomer)
      router.push(`/customers/${tempId}`)
      return { tempId }
    },
    onSuccess: (result, _input, context) => {
      if (!context) return
      if ("error" in result) {
        queryClient.removeQueries({ queryKey: ["customer", context.tempId] })
        router.push("/customers/new")
        toast.error(result.error)
        return
      }
      queryClient.removeQueries({ queryKey: ["customer", context.tempId] })
      queryClient.setQueryData(["customer", result.data.id], result.data)
      router.replace(`/customers/${result.data.id}`)
    },
    onError: (_error, _input, context) => {
      if (!context) return
      queryClient.removeQueries({ queryKey: ["customer", context.tempId] })
      router.push("/customers/new")
      toast.error("Failed to create customer")
    },
  })

  function handleSubmit(e: React.FormEvent) {
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
    mutation.mutate({
      fullName: fullName.trim(),
      contact: contact.trim(),
      address: address.trim(),
    })
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Register Customer</h1>
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
                disabled={mutation.isPending}
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
                disabled={mutation.isPending}
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
                disabled={mutation.isPending}
              />
              {fieldErrors.address && (
                <p className="text-destructive text-xs">{fieldErrors.address}</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Registering...
                  </>
                ) : (
                  "Register Customer"
                )}
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
