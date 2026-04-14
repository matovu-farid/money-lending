export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-8 w-36 rounded-lg bg-muted animate-pulse" />
        <div className="h-9 w-32 rounded-md bg-muted animate-pulse" />
      </div>
      <div className="h-10 w-64 rounded-md bg-muted animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded bg-muted animate-pulse" />
        ))}
      </div>
    </div>
  )
}
