export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
        <div className="h-9 w-28 rounded-md bg-muted animate-pulse" />
      </div>
      {/* Filter tabs */}
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
      {/* Table rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
