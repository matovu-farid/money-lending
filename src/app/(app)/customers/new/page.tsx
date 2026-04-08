"use client"

import { useForm } from "react-hook-form"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { useCreateCustomer } from "@/hooks/use-create-customer"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { CustomerFormFields, type CustomerFormValues } from "@/components/customers/customer-form-fields"

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
            <CustomerFormFields
              register={register}
              setValue={setValue}
              errors={errors}
              disabled={mutation.isPending}
            />

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
