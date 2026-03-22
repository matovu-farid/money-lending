export default function Loading() {
  return (
    <div className="p-6 space-y-4">
      <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
      <div className="h-4 w-full rounded bg-muted animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
      <div className="h-64 w-full rounded-lg bg-muted animate-pulse mt-6" />
    </div>
  )
}
