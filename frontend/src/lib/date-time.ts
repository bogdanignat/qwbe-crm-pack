// Dates and times as the reader expects them: in the app's locale and time
// zone (lib/locale.ts), never as the raw ISO text the API carries.

import { APP_LOCALE, APP_TIME_ZONE } from "./locale.ts"

// A complete ISO 8601 timestamp: date, time and zone (createdAt, modifiedAt).
// A bare date or a free text that only starts like one is left alone.
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

export function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
}

// "16.10.2026, 19:21"; the activity feed adds the seconds.
const PARTS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE,
}
const DATE_TIME = new Intl.DateTimeFormat(APP_LOCALE, PARTS)
const WITH_SECONDS = new Intl.DateTimeFormat(APP_LOCALE, { ...PARTS, second: "2-digit" })

export function formatDateTime(iso: string, { seconds = false }: { seconds?: boolean } = {}): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  return (seconds ? WITH_SECONDS : DATE_TIME).format(time)
}
