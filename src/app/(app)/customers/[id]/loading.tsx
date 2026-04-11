export default function CustomerDetailLoading() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-7 w-48 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-4 w-28 rounded bg-muted-foreground/10 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-32 rounded-md bg-muted-foreground/10 animate-pulse" />
          <div className="h-9 w-32 rounded-md bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
      {/* Basic info accordion skeleton */}
      <div className="border rounded-lg px-4 py-3 space-y-3">
        <div className="h-5 w-36 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
          <div className="h-4 w-40 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
          <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
        </div>
      </div>
      {/* Status card skeleton */}
      <div className="border rounded-lg p-6 space-y-2">
        <div className="h-5 w-16 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="h-9 w-[200px] rounded-md bg-muted-foreground/10 animate-pulse" />
      </div>
      {/* Loan history skeleton */}
      <div className="space-y-4">
        <div className="h-6 w-28 rounded bg-muted-foreground/10 animate-pulse" />
        <div className="border rounded-lg p-6 space-y-3">
          <div className="flex justify-between">
            <div className="h-4 w-32 rounded bg-muted-foreground/10 animate-pulse" />
            <div className="h-5 w-16 rounded-full bg-muted-foreground/10 animate-pulse" />
          </div>
          <div className="h-8 w-28 rounded bg-muted-foreground/10 animate-pulse" />
          <div className="h-4 w-24 rounded bg-muted-foreground/8 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
