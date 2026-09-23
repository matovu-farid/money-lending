// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { submitAccessRequest } = vi.hoisted(() => ({
  submitAccessRequest: vi.fn(),
}))

vi.mock("./actions", () => ({ submitAccessRequest }))

import RequestAccessPage from "./page"

describe("RequestAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders a lightweight lead form without account credentials", () => {
    render(<RequestAccessPage />)

    expect(screen.getByRole("heading", { name: "Request access" })).toBeInTheDocument()
    expect(screen.getByLabelText("Full Name")).toBeInTheDocument()
    expect(screen.getByLabelText("Email")).toBeInTheDocument()
    expect(screen.getByLabelText("Phone / WhatsApp")).toBeInTheDocument()
    expect(screen.getByLabelText("Business or organization")).toBeInTheDocument()
    expect(screen.getByLabelText("How can we help?")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument()
    expect(screen.queryByText("Create Account")).not.toBeInTheDocument()
  })

  it("requires at least one contact method in the browser", async () => {
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText("Full Name"), "Amina Namusoke")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    expect(await screen.findByText(
      "Please provide an email address or phone/WhatsApp number.",
    )).toBeInTheDocument()
    expect(submitAccessRequest).not.toHaveBeenCalled()
  })

  it("submits with only an email address", async () => {
    submitAccessRequest.mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText("Full Name"), "Amina Namusoke")
    await user.type(screen.getByLabelText("Email"), "amina@example.com")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    expect(submitAccessRequest).toHaveBeenCalledWith({
      name: "Amina Namusoke",
      email: "amina@example.com",
      phone: "",
      organization: "",
      message: "",
    })
  })

  it("submits with only a phone number", async () => {
    submitAccessRequest.mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText("Full Name"), "Amina Namusoke")
    await user.type(screen.getByLabelText("Phone / WhatsApp"), "+256 700 000000")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    expect(submitAccessRequest).toHaveBeenCalledWith({
      name: "Amina Namusoke",
      email: "",
      phone: "+256 700 000000",
      organization: "",
      message: "",
    })
  })

  it("shows the confirmation after a successful request", async () => {
    submitAccessRequest.mockResolvedValueOnce({ success: true })
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText("Full Name"), "Amina Namusoke")
    await user.type(screen.getByLabelText("Phone / WhatsApp"), "+256 700 000000")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    expect(await screen.findByText(/Thanks, Amina Namusoke/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send request" })).not.toBeInTheDocument()
  })

  it("renders the generic server error and keeps the form available", async () => {
    submitAccessRequest.mockResolvedValueOnce({
      error: "We couldn't submit your request right now. Please try again.",
    })
    const user = userEvent.setup()
    render(<RequestAccessPage />)

    await user.type(screen.getByLabelText("Full Name"), "Amina Namusoke")
    await user.type(screen.getByLabelText("Phone / WhatsApp"), "+256 700 000000")
    await user.click(screen.getByRole("button", { name: "Send request" }))

    expect(await screen.findByText(
      "We couldn't submit your request right now. Please try again.",
    )).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send request" })).toBeInTheDocument()
  })
})
