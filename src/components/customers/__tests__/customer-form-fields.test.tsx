// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useForm } from "react-hook-form"
import { describe, expect, it, vi } from "vitest"
import { CustomerFormFields, type CustomerFormValues } from "../customer-form-fields"

const { mockUseLiveQuery } = vi.hoisted(() => ({
  mockUseLiveQuery: vi.fn(() => ({ data: [] })),
}))

vi.mock("@tanstack/react-db", () => ({
  useLiveQuery: mockUseLiveQuery,
}))

vi.mock("@/collections/customers", () => ({
  customerCollection: {},
}))

function Harness({
  onSubmit,
}: {
  onSubmit: (values: CustomerFormValues) => void
}) {
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    mode: "onChange",
    defaultValues: {
      fullName: "",
      nin: "",
      contact: "",
      address: "",
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <CustomerFormFields
        register={register}
        setValue={setValue}
        control={control}
        errors={errors}
      />
      <button type="submit">Submit</button>
    </form>
  )
}

describe("CustomerFormFields", () => {
  it("warns when the entered phone number matches another customer after normalization", async () => {
    mockUseLiveQuery.mockReturnValue({
      data: [
        {
          id: "customer-1",
          nin: "CF83037108RLLK",
          contact: "0771234567",
        },
      ],
    } as any)

    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<Harness onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText("Full Name"), "John Doe")
    await user.type(screen.getByLabelText("NIN (National ID Number)"), "CF83037108RLLK")
    await user.type(screen.getByLabelText("Contact"), "+256771234567")
    await user.type(screen.getByLabelText("Physical Address"), "Kampala, Uganda")

    expect(
      screen.getByText("This phone number is already registered to another customer."),
    ).toBeInTheDocument()
  })

  it("submits the contact value through react-hook-form", async () => {
    mockUseLiveQuery.mockReturnValue({ data: [] } as any)
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<Harness onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText("Full Name"), "John Doe")
    await user.type(screen.getByLabelText("NIN (National ID Number)"), "CF83037108RLLK")
    await user.type(screen.getByLabelText("Contact"), "0771234567")
    await user.type(screen.getByLabelText("Physical Address"), "Kampala, Uganda")
    await user.click(screen.getByRole("button", { name: "Submit" }))

    expect(onSubmit).toHaveBeenCalledWith(
      {
        fullName: "John Doe",
        nin: "CF83037108RLLK",
        contact: "0771234567",
        address: "Kampala, Uganda",
      },
      expect.anything(),
    )
  })
})
