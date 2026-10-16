// An IBAN as people read it: groups of four (RO00 EXMP 0000 ...), the way
// banks print it. Display only; the stored and copied value stays raw.

export function ibanGroupsOf(value: string): string[] {
  return value.replace(/\s+/g, "").match(/.{1,4}/g) ?? []
}

// A Romanian IBAN, as typed (spaces and lower case allowed): RO, two check
// digits, a four-letter bank code, then 16 letters or digits, and the ISO
// 13616 mod-97 checksum.
export function ibanError(value: string): string | null {
  const iban = value.replace(/\s+/g, "").toUpperCase()
  if (iban === "") return null
  if (!/^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(iban)) {
    return "A Romanian IBAN is RO, 2 check digits, a 4-letter bank code and 16 letters or digits"
  }
  const digits = [...iban.slice(4) + iban.slice(0, 4)].map((c) => parseInt(c, 36)).join("")
  const remainder = [...digits].reduce((r, d) => (r * 10 + Number(d)) % 97, 0)
  return remainder === 1 ? null : "This IBAN is not valid: its check digits do not match"
}
