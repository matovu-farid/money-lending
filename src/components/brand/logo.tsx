import { cn } from "@/lib/utils"

interface LogoMarkProps {
  className?: string
  size?: number
  title?: string
}

export function LogoMark({ className, size = 24, title = "Kaks Credit" }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      <rect width="240" height="240" rx="56" fill="#0a0a0a" />
      <rect
        x="2"
        y="2"
        width="236"
        height="236"
        rx="54"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.08"
        strokeWidth="2"
      />
      <line
        x1="48"
        y1="200"
        x2="192"
        y2="200"
        stroke="#ffffff"
        strokeOpacity="0.18"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <polyline
        points="60,176 100,148 140,120 180,80"
        fill="none"
        stroke="#ffffff"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="60" cy="176" r="10" fill="#ffffff" />
      <circle cx="100" cy="148" r="10" fill="#ffffff" />
      <circle cx="140" cy="120" r="10" fill="#ffffff" />
      <circle cx="180" cy="80" r="18" fill="#f59e0b" />
    </svg>
  )
}

interface LogoProps {
  className?: string
  size?: number
  showWordmark?: boolean
}

export function Logo({ className, size = 28, showWordmark = true }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="font-semibold text-lg tracking-tight">Kaks Credit</span>
      )}
    </span>
  )
}
