"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "./button-variants"

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <Loader2 className="animate-spin" aria-hidden="true" />
      )}
      <span className={cn("inline-flex items-center gap-1.5", loading && "opacity-70")}>{children}</span>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
