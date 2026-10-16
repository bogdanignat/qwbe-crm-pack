// An IBAN as people read it: groups of four (RO00 EXMP 0000 ...), the way
// banks print it. Display only; the stored and copied value stays raw.

export function ibanGroupsOf(value: string): string[] {
  return value.replace(/\s+/g, "").match(/.{1,4}/g) ?? []
}
