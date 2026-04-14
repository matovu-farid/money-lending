export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
