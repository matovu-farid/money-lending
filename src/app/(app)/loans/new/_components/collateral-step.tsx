import { useRef, useState } from "react"
import type { UseFormRegister, UseFormSetValue, FieldErrors } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import type { LoanFormValues } from "../_types"

interface CollateralStepProps {
  register: UseFormRegister<LoanFormValues>
  setValue: UseFormSetValue<LoanFormValues>
  errors: FieldErrors<LoanFormValues>
  knownNatures: string[]
  collateralNature: string
  onBack: () => void
  onNext: () => void
}

export function CollateralStep({
  register,
  setValue,
  errors,
  knownNatures,
  collateralNature,
  onBack,
  onNext,
}: CollateralStepProps) {
  const [showNatureSuggestions, setShowNatureSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const natureInputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLUListElement>(null)

  const filteredNatures = collateralNature.trim()
    ? knownNatures.filter((n) =>
        n.toLowerCase().includes(collateralNature.toLowerCase())
      )
    : knownNatures

  // Merge the react-hook-form register ref with our local ref for the collateral nature input
  const { ref: rhfNatureRef, ...collateralNatureRegistration } = register("collateralNature", {
    required: "Collateral nature is required",
    maxLength: { value: 100, message: "Collateral nature is too long (max 100 characters)" },
  })

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-1 relative">
          <Label htmlFor="collateralNature" className="font-semibold">Type of Collateral</Label>
          <Input
            id="collateralNature"
            type="text"
            autoComplete="off"
            placeholder="e.g. Land Title, Vehicle Log Book"
            role="combobox"
            aria-expanded={showNatureSuggestions && filteredNatures.length > 0}
            aria-autocomplete="list"
            {...collateralNatureRegistration}
            ref={(el) => {
              rhfNatureRef(el)
              ;(natureInputRef as React.MutableRefObject<HTMLInputElement | null>).current = el
            }}
            onChange={(e) => {
              collateralNatureRegistration.onChange(e)
              setShowNatureSuggestions(true)
              setHighlightedIndex(-1)
            }}
            onFocus={() => setShowNatureSuggestions(true)}
            onBlur={(e) => {
              collateralNatureRegistration.onBlur(e)
              // Delay to allow click on suggestion
              setTimeout(() => setShowNatureSuggestions(false), 150)
            }}
            onKeyDown={(e) => {
              if (!showNatureSuggestions || filteredNatures.length === 0) return
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setHighlightedIndex((i) =>
                  i < filteredNatures.length - 1 ? i + 1 : 0
                )
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setHighlightedIndex((i) =>
                  i > 0 ? i - 1 : filteredNatures.length - 1
                )
              } else if (e.key === "Enter" && highlightedIndex >= 0) {
                e.preventDefault()
                setValue("collateralNature", filteredNatures[highlightedIndex], { shouldValidate: true })
                setShowNatureSuggestions(false)
                setHighlightedIndex(-1)
              } else if (e.key === "Escape") {
                setShowNatureSuggestions(false)
              }
            }}
          />
          {showNatureSuggestions && filteredNatures.length > 0 && (
            <ul
              ref={suggestionsRef}
              role="listbox"
              className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-md border border-border bg-popover py-1 shadow-md"
            >
              {filteredNatures.map((nature, i) => (
                <li
                  key={nature}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${
                    i === highlightedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                  onMouseDown={() => {
                    setValue("collateralNature", nature, { shouldValidate: true })
                    setShowNatureSuggestions(false)
                    setHighlightedIndex(-1)
                  }}
                >
                  {nature}
                </li>
              ))}
            </ul>
          )}
          {errors.collateralNature && (
            <p className="text-sm text-destructive">{errors.collateralNature.message}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="collateralDescription" className="font-semibold">Description</Label>
          <textarea
            id="collateralDescription"
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring min-h-[80px] resize-y"
            placeholder="Describe the collateral and any extra details about the loan..."
            maxLength={2500}
            {...register("collateralDescription", {
              required: "Collateral description is required",
              maxLength: { value: 2500, message: "Description is too long (max 2500 characters)" },
            })}
          />
          {errors.collateralDescription && (
            <p className="text-sm text-destructive">{errors.collateralDescription.message}</p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="button" onClick={onNext}>Next</Button>
        </div>
      </CardContent>
    </Card>
  )
}
