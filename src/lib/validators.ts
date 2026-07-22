// Uganda NIN: 14 alphanumeric characters. The exact internal structure has
// shifted over time (citizen/alien prefix, gender slot, digit/letter mix), so
// we validate length + alphanumeric only and trust the source document.
const NIN_PATTERN = /^[A-Z0-9]{14}$/;
export function normalizeUgandanPhone(
  value: string | undefined | null,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/\s+/g, "");
  if (/^07\d{8}$/.test(cleaned)) return cleaned;
  if (/^\+2567\d{8}$/.test(cleaned)) return `0${cleaned.slice(4)}`;
  return null;
}

export function validateNIN(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return "Valid NIN is required (e.g. CF83037108RLLK)";

  const normalized = trimmed.toUpperCase();
  if (!NIN_PATTERN.test(normalized)) {
    return "Valid NIN is required (e.g. CF83037108RLLK)";
  }
  return null;
}

export function validateUgandanPhone(
  value: string | undefined | null,
): string | null {
  return normalizeUgandanPhone(value)
    ? null
    : "Valid Ugandan mobile number is required (e.g. 0771234567)";
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateUuid(
  value: string | undefined | null,
  fieldName: string,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !UUID_PATTERN.test(trimmed)) {
    return `${fieldName} must be a valid UUID`;
  }
  return null;
}

export function validateWaiveReason(
  value: string | undefined | null,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length < 10) {
    return "Reason must be at least 10 characters";
  }
  return null;
}

export function validateWaiveLoanAmountInput(input: {
  loanId: string;
  amount: string;
  reason: string;
}): string | null {
  const loanIdErr = validateUuid(input.loanId, "Loan ID");
  if (loanIdErr) return loanIdErr;
  const amountErr = validatePositiveDecimal(input.amount, "Amount");
  if (amountErr) return amountErr;
  return validateWaiveReason(input.reason);
}
