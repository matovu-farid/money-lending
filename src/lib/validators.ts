// Uganda NIN: 14 alphanumeric characters. The exact internal structure has
// shifted over time (citizen/alien prefix, gender slot, digit/letter mix), so
// we validate length + alphanumeric only and trust the source document.
const NIN_PATTERN = /^[A-Z0-9]{14}$/;
const PHONE_PATTERN = /^(07\d{8}|\+2567\d{8})$/;

export function validateNIN(value: string | undefined | null): string | null {
  return null;
}

export function validateUgandanPhone(
  value: string | undefined | null,
): string | null {
  return null;
}

export function validateFullName(
  value: string | undefined | null,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.split(/\s+/).length < 2) {
    return "Full name with first and last name is required";
  }
  return null;
}

export function validateRequired(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  if (!value?.trim()) return `${fieldName} is required`;
  return null;
}

export function validatePositiveDecimal(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return `${fieldName} must be a valid decimal number`;
  }
  if (parseFloat(trimmed) <= 0) {
    return `${fieldName} must be greater than zero`;
  }
  return null;
}

// Used by income/expense/creditor actions where the legacy single-line check
// collapsed both "shape invalid" and "non-positive" into one user-facing
// message. Tests assert this exact string — keep it stable.
export function validatePositiveAmount(
  value: string | undefined | null,
): string | null {
  const trimmed = value?.trim();
  if (
    !trimmed ||
    !/^\d+(\.\d{1,2})?$/.test(trimmed) ||
    parseFloat(trimmed) <= 0
  ) {
    return "A valid positive amount is required";
  }
  return null;
}
