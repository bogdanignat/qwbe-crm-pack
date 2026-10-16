// Field checks every form can share, each returning the message to show under
// the field, or null. Pure, so the same rule runs in a test and in the form.

export function requiredError(label: string, value: unknown): string | null {
  return value === null || value === undefined || String(value).trim() === "" ? `${label} is required` : null
}

export function maxLengthError(label: string, value: string, max: number): string | null {
  return value.length > max ? `${label} can be at most ${max} characters` : null
}

export function emailError(value: string): string | null {
  const email = value.trim()
  return email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? null : "Enter an email address like name@example.com"
}

export function integerError(value: string): string | null {
  const n = value.trim()
  return n === "" || /^-?\d+$/.test(n) ? null : "Enter a whole number"
}
