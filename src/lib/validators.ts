const NIN_PATTERN = /^[CA][MF]\d{8}[A-Z0-9]{4}$/
const PHONE_PATTERN = /^(07\d{8}|\+2567\d{8})$/

export function validateNIN(value: string | undefined | null): string | null {
  const trimmed = value?.trim()?.toUpperCase()
  if (!trimmed || !NIN_PATTERN.test(trimmed)) {
    return "Valid NIN is required (e.g. CM97027102X4CU)"
  }
  return null
}

export function validateUgandanPhone(value: string | undefined | null): string | null {
  const cleaned = value?.trim()?.replace(/\s/g, "")
  if (!cleaned || !PHONE_PATTERN.test(cleaned)) {
    return "Valid Ugandan mobile number is required (e.g. 0771234567)"
  }
  return null
}

export function validateFullName(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.split(/\s+/).length < 2) {
    return "Full name with first and last name is required"
  }
  return null
}

export function validateRequired(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim()) return `${fieldName} is required`
  return null
}

export function validatePositiveDecimal(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim() || !/^\d+(\.\d{1,2})?$/.test(value)) {
    return `${fieldName} must be a valid decimal number`
  }
  if (parseFloat(value) <= 0) {
    return `${fieldName} must be greater than zero`
  }
  return null
}
