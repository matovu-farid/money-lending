"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { generateClientId } from "@/lib/client-id"
import { customerCollection } from "@/collections/customers"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerFormFields, type CustomerFormValues } from "@/components/customers/customer-form-fields"

export default function NewCustomerPage() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CustomerFormValues>({
    defaultValues: { fullName: "", nin: "", contact: "", address: "" },
  })

  async function onSubmit(data: CustomerFormValues) {
    setIsPending(true)
    try {
      const id = generateClientId()
      const tx = customerCollection.insert({
        id,
        fullName: data.fullName.trim(),
        nin: data.nin.trim(),
        contact: data.contact.trim(),
        address: data.address.trim(),
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await tx.isPersisted.promise
      toast.success("Customer registered successfully")
      router.push(`/customers/${id}`)
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create customer")
      setIsPending(false)
    }
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
            <CustomerFormFields
              register={register}
              setValue={setValue}
              errors={errors}
              disabled={isPending}
            />

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4" />
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
