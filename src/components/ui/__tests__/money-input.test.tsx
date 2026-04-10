// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import "@testing-library/jest-dom/vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { MoneyInput, type MoneyPreset, type MoneySuggestion } from "../money-input"

type TestForm = { amount: string }

const TEST_PRESETS: MoneyPreset[] = [
  { label: "50K", value: "50000" },
  { label: "100K", value: "100000" },
  { label: "500K", value: "500000" },
]

const TEST_SUGGESTIONS: MoneySuggestion[] = [
  { label: "Interest only", value: "150000", description: "Covers this month's interest" },
  { label: "Full cycle", value: "500000", description: "Interest + principal portion" },
  { label: "Pay off", value: "2000000" },
]

function Harness({
  defaultValue = "",
  min,
  required,
  disabled,
  presets,
  suggestions,
}: {
  defaultValue?: string
  min?: number
  required?: boolean | string
  disabled?: boolean
  presets?: readonly MoneyPreset[]
  suggestions?: readonly MoneySuggestion[]
}) {
  const { control } = useForm<TestForm>({
    defaultValues: { amount: defaultValue },
    mode: "onBlur",
  })
  return (
    <MoneyInput
      name="amount"
      control={control}
      label="Amount"
      min={min}
      required={required}
      disabled={disabled}
      id="amount"
      presets={presets}
      suggestions={suggestions}
    />
  )
}

describe("MoneyInput", () => {
  it("renders with label and formatted default value", () => {
    render(<Harness defaultValue="50000" />)
    expect(screen.getByLabelText("Amount")).toHaveValue("50,000")
  })

  it("strips non-digit characters on input", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.type(input, "abc123def")
    expect(input).toHaveValue("123")
  })

  it("strips leading zeros so '0000' never displays as '0,000'", async () => {
    const user = userEvent.setup()
    render(<Harness defaultValue="50000" />)
    const input = screen.getByLabelText("Amount")
    await user.clear(input)
    await user.type(input, "0000")
    expect(input).toHaveValue("")
  })

  it("formats displayed value with commas", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.type(input, "1500000")
    expect(input).toHaveValue("1,500,000")
  })

  it("does not allow decimal points (UGX is integer-only)", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.type(input, "100.50")
    expect(input).toHaveValue("10,050")
  })

  it("shows min validation error when value is below minimum", async () => {
    const user = userEvent.setup()
    render(<Harness min={50000} required="Required" />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.type(input, "10000")
    await user.tab()
    expect(await screen.findByText("Must be at least 50,000")).toBeInTheDocument()
  })

  it("does not show min error when value meets minimum", async () => {
    const user = userEvent.setup()
    render(<Harness min={50000} required="Required" />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.type(input, "50000")
    await user.tab()
    expect(screen.queryByText("Must be at least 50,000")).not.toBeInTheDocument()
  })

  it("shows required error when field is required and empty", async () => {
    const user = userEvent.setup()
    render(<Harness required="Issuance fee is required" />)
    const input = screen.getByLabelText("Amount")
    await user.click(input)
    await user.tab()
    expect(await screen.findByText("Issuance fee is required")).toBeInTheDocument()
  })

  describe("presets", () => {
    it("renders preset buttons when presets prop is provided", () => {
      render(<Harness presets={TEST_PRESETS} />)
      expect(screen.getByRole("button", { name: "50K" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "100K" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "500K" })).toBeInTheDocument()
    })

    it("does not render preset buttons when presets prop is omitted", () => {
      render(<Harness />)
      expect(screen.queryByRole("button", { name: "50K" })).not.toBeInTheDocument()
    })

    it("clicking a preset sets the input value", async () => {
      const user = userEvent.setup()
      render(<Harness presets={TEST_PRESETS} />)
      await user.click(screen.getByRole("button", { name: "100K" }))
      expect(screen.getByLabelText("Amount")).toHaveValue("100,000")
    })

    it("clicking a different preset updates the value", async () => {
      const user = userEvent.setup()
      render(<Harness presets={TEST_PRESETS} />)
      await user.click(screen.getByRole("button", { name: "50K" }))
      expect(screen.getByLabelText("Amount")).toHaveValue("50,000")
      await user.click(screen.getByRole("button", { name: "500K" }))
      expect(screen.getByLabelText("Amount")).toHaveValue("500,000")
    })

    it("preset buttons are disabled when input is disabled", () => {
      render(<Harness presets={TEST_PRESETS} disabled />)
      expect(screen.getByRole("button", { name: "50K" })).toBeDisabled()
      expect(screen.getByRole("button", { name: "100K" })).toBeDisabled()
    })
  })

  describe("suggestions", () => {
    it("does not show suggestions dropdown before focus", () => {
      render(<Harness suggestions={TEST_SUGGESTIONS} />)
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    })

    it("shows suggestions dropdown on focus", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} />)
      await user.click(screen.getByLabelText("Amount"))
      const listbox = screen.getByRole("listbox", { name: "Suggested amounts" })
      expect(listbox).toBeInTheDocument()
      expect(within(listbox).getAllByRole("option")).toHaveLength(3)
    })

    it("displays suggestion labels and formatted amounts", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} />)
      await user.click(screen.getByLabelText("Amount"))
      expect(screen.getByText("Interest only")).toBeInTheDocument()
      expect(screen.getByText("Covers this month's interest")).toBeInTheDocument()
      expect(screen.getByText("UGX 150,000")).toBeInTheDocument()
    })

    it("clicking a suggestion sets the input value and closes dropdown", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} />)
      const input = screen.getByLabelText("Amount")
      await user.click(input)
      await user.click(screen.getByText("Full cycle"))
      expect(input).toHaveValue("500,000")
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    })

    it("shows check icon on the selected suggestion", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} defaultValue="150000" />)
      await user.click(screen.getByLabelText("Amount"))
      const selectedOption = screen.getByRole("option", { selected: true })
      expect(within(selectedOption).getByText("Interest only")).toBeInTheDocument()
    })

    it("does not show suggestions dropdown when disabled", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} disabled />)
      const input = screen.getByLabelText("Amount")
      // disabled inputs can't be focused via click
      await user.click(input)
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    })

    it("user can still type a custom amount with suggestions", async () => {
      const user = userEvent.setup()
      render(<Harness suggestions={TEST_SUGGESTIONS} />)
      const input = screen.getByLabelText("Amount")
      await user.click(input)
      await user.type(input, "750000")
      expect(input).toHaveValue("750,000")
    })

    it("does not show dropdown when suggestions prop is omitted", async () => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByLabelText("Amount"))
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    })
  })
})
