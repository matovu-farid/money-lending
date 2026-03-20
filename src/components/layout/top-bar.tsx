import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TopBarProps {
  onMenuClick?: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="h-14 border-b bg-background flex items-center px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-3 flex-1">
        {onMenuClick && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <span className="font-semibold text-lg tracking-tight">Lending Manager</span>
      </div>
    </header>
  )
}
