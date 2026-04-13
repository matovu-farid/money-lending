const STEP_LABELS = ["Loan Details", "Collateral", "Review & Confirm"] as const

interface StepIndicatorProps {
  currentStep: number
}

export function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {([1, 2, 3] as const).map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium border ${
              currentStep === s
                ? "bg-primary text-primary-foreground border-primary"
                : currentStep > s
                ? "bg-primary/20 text-primary border-primary/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            {s}
          </div>
          <span
            className={`text-sm ${
              currentStep === s ? "font-medium" : "text-muted-foreground"
            }`}
          >
            {STEP_LABELS[s - 1]}
          </span>
          {s < 3 && <div className="w-6 h-px bg-border mx-1" />}
        </div>
      ))}
    </div>
  )
}
