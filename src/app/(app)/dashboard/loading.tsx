export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="h-8 w-40 rounded-lg bg-muted animate-pulse" />
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
        <div className="h-64 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  )
}
