/**
 * Minimal form layout primitives.
 * Note: This project uses controlled React state for forms (no react-hook-form).
 * This file provides structural components for consistent form layout.
 */

import * as React from "react"
import { cn } from "@/lib/utils"

function FormItem({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)} {...props} />
}

function FormLabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium", className)} {...props} />
}

function FormMessage({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-destructive text-xs", className)}
      {...props}
    />
  )
}

export { FormItem, FormLabel, FormMessage }
