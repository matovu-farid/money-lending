export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-24 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
