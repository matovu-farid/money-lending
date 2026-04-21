import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const skeletonVariants = cva(
  "relative overflow-hidden bg-muted animate-shimmer",
  {
    variants: {
      variant: {
        rectangular: "rounded-md",
        text: "rounded-sm w-full",
        circular: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "rectangular",
    },
  }
)

function Skeleton({
  className,
  variant = "rectangular",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(skeletonVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Skeleton, skeletonVariants }
