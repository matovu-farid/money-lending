export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
