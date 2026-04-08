"use client"

import type { UseFormRegister, UseFormSetValue, FieldErrors } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface CustomerFormValues {
  fullName: string
  nin: string
  contact: string
  address: string
}

function autoCapitalize(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase())
}

interface CustomerFormFieldsProps {
  register: UseFormRegister<CustomerFormValues>
  setValue: UseFormSetValue<CustomerFormValues>
  errors: FieldErrors<CustomerFormValues>
  disabled?: boolean
  idPrefix?: string
}

export function CustomerFormFields({
  register,
  setValue,
  errors,
  disabled,
  idPrefix = "",
}: CustomerFormFieldsProps) {
  const id = (name: string) => idPrefix ? `${idPrefix}-${name}` : name

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor={id("fullName")}>Full Name</Label>
        <Input
          id={id("fullName")}
          type="text"
          placeholder="e.g. John Doe"
          disabled={disabled}
          maxLength={100}
          {...register("fullName", {
            required: "Full name is required",
            validate: {
              notEmpty: v => v.trim() !== "" || "Full name is required",
              twoWords: v => v.trim().split(/\s+/).length >= 2 || "Enter both first and last name",
              minLength: v => v.trim().length >= 3 || "Name is too short",
              maxLength: v => v.trim().length <= 100 || "Name is too long (max 100 characters)",
            },
            onChange: (e) => setValue("fullName", autoCapitalize(e.target.value)),
          })}
        />
        {errors.fullName && (
          <p className="text-sm text-destructive">{errors.fullName.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={id("nin")}>NIN (National ID Number)</Label>
        <Input
          id={id("nin")}
          type="text"
          placeholder="e.g. CM97027102X4CU"
          maxLength={14}
          disabled={disabled}
          {...register("nin", {
            required: "NIN is required",
            validate: {
              format: v => /^[CA][MF]\d{8}[A-Z0-9]{4}$/.test(v.trim().toUpperCase())
                || "Must be 14 characters: C/A, M/F, 8 digits, 4 alphanumeric (e.g. CM97027102X4CU)",
            },
            onChange: (e) => setValue("nin", e.target.value.toUpperCase()),
          })}
        />
        <p className="text-xs text-muted-foreground">
          Format: C/A (citizen/alien) + M/F (gender) + 8 digits + 4 alphanumeric
        </p>
        {errors.nin && (
          <p className="text-sm text-destructive">{errors.nin.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={id("contact")}>Contact</Label>
        <Input
          id={id("contact")}
          type="text"
          placeholder="e.g. 0771234567"
          maxLength={15}
          disabled={disabled}
          {...register("contact", {
            required: "Contact is required",
            validate: {
              notEmpty: v => v.trim() !== "" || "Contact is required",
              phone: v => /^(07\d{8}|\+2567\d{8})$/.test(v.trim().replace(/\s/g, ""))
                || "Enter a valid Ugandan mobile number (e.g. 0771234567 or +256771234567)",
            },
          })}
        />
        {errors.contact && (
          <p className="text-sm text-destructive">{errors.contact.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={id("address")}>Physical Address</Label>
        <Input
          id={id("address")}
          type="text"
          placeholder="e.g. Kampala, Uganda"
          maxLength={200}
          disabled={disabled}
          {...register("address", {
            required: "Address is required",
            validate: {
              notEmpty: v => v.trim() !== "" || "Address is required",
              minLength: v => v.trim().length >= 5 || "Address is too short (minimum 5 characters)",
              maxLength: v => v.trim().length <= 200 || "Address is too long (max 200 characters)",
            },
            onChange: (e) => setValue("address", autoCapitalize(e.target.value)),
          })}
        />
        {errors.address && (
          <p className="text-sm text-destructive">{errors.address.message}</p>
        )}
      </div>
    </>
  )
}
