"use client"

import { useForm } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { useCreateCustomer } from "@/hooks/use-create-customer"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"

function autoCapitalize(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

interface CustomerFormValues {
  fullName: string
  nin: string
  contact: string
  address: string
}

export default function NewCustomerPage() {
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CustomerFormValues>({
    defaultValues: { fullName: "", nin: "", contact: "", address: "" },
  })

  const mutation = useCreateCustomer()

  function onSubmit(data: CustomerFormValues) {
    mutation.mutate({
      fullName: data.fullName.trim(),
      nin: data.nin.trim(),
      contact: data.contact.trim(),
      address: data.address.trim(),
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-lg">
      <PageHeader
        title="Register Customer"
        subtitle="Add a new customer to the system."
        className="mb-6"
      />

      <Card>
        <CardHeader>
          <CardTitle>Customer Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="e.g. John Doe"
                disabled={mutation.isPending}
                {...register("fullName", {
                  required: "Full name is required",
                  validate: v => v.trim() !== "" || "Full name is required",
                  onChange: (e) => setValue("fullName", autoCapitalize(e.target.value)),
                })}
              />
              {errors.fullName && (
                <p className="text-sm text-destructive">{errors.fullName.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="nin">NIN (National ID Number)</Label>
              <Input
                id="nin"
                type="text"
                placeholder="e.g. CM12345678ABCDE"
                disabled={mutation.isPending}
                {...register("nin", {
                  required: "NIN is required",
                  validate: v => v.trim() !== "" || "NIN is required",
                })}
              />
              {errors.nin && (
                <p className="text-sm text-destructive">{errors.nin.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="contact">Contact</Label>
              <Input
                id="contact"
                type="text"
                placeholder="Phone number or email"
                disabled={mutation.isPending}
                {...register("contact", { required: "Contact is required", validate: v => v.trim() !== "" || "Contact is required" })}
              />
              {errors.contact && (
                <p className="text-sm text-destructive">{errors.contact.message}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="address">Physical Address</Label>
              <Input
                id="address"
                type="text"
                placeholder="e.g. Kampala, Uganda"
                disabled={mutation.isPending}
                {...register("address", {
                  required: "Address is required",
                  validate: v => v.trim() !== "" || "Address is required",
                  onChange: (e) => setValue("address", autoCapitalize(e.target.value)),
                })}
              />
              {errors.address && (
                <p className="text-sm text-destructive">{errors.address.message}</p>
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
