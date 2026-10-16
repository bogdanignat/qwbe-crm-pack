// Numbers grouped by thousands in the app's locale (850.000), as vtiger shows
// amounts and head counts.

import { APP_LOCALE } from "./locale.ts"

const NUMBER = new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 20 })

export function formatNumber(value: number): string {
  return NUMBER.format(value)
}
