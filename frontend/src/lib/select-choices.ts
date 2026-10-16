// The values a select offers: the field's list and, before it, any stored
// value the list lacks (a legacy one, such as an Industry typed before the
// picklist), shown as-is, so that opening the select never blanks it out.

export function selectChoicesOf(options: readonly string[], ...stored: unknown[]): string[] {
  const legacy = stored
    .map((value) => (value === null || value === undefined ? "" : String(value)))
    .filter((value, i, all) => value !== "" && !options.includes(value) && all.indexOf(value) === i)
  return [...legacy, ...options]
}
