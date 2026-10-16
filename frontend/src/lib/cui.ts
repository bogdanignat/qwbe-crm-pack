// The Romanian CUI (fiscal code) as vtiger checks it before saving (spec §4.1):
// digits only, at most 10, the last one a check digit over the others with the
// key 753217532. The "RO" VAT prefix is refused with a hint, not stripped: the
// field holds the code alone, and silently editing what was typed would hide
// the mistake.

const KEY = [7, 5, 3, 2, 1, 7, 5, 3, 2]

function checkDigitOf(body: string): number {
  const digits = body.padStart(KEY.length, "0")
  const sum = KEY.reduce((total, k, i) => total + k * Number(digits[i]), 0)
  const digit = (sum * 10) % 11
  return digit === 10 ? 0 : digit
}

export function cuiError(value: string): string | null {
  const cui = value.trim()
  if (cui === "") return null
  if (/^ro/i.test(cui)) return "Enter the CUI without the RO prefix: digits only"
  if (!/^\d+$/.test(cui)) return "The CUI holds digits only"
  if (cui.length < 2 || cui.length > 10) return "The CUI has 2 to 10 digits"
  if (checkDigitOf(cui.slice(0, -1)) !== Number(cui.at(-1))) return "This CUI is not valid: its check digit does not match"
  return null
}
