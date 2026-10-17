// The indicator light a status value shows (T-1817): ok (teal, running),
// warn (amber), alert (red), idle (grey; also any value not listed).

export type StatusTone = "ok" | "warn" | "alert" | "idle"

// vtiger's company statuses (picklist P5, the `rating` field).
const COMPANY_STATUS_TONES = new Map<string, StatusTone>([
  ["Activ", "ok"],
  ["Inactiv", "idle"],
  ["Restrictionat", "warn"],
  ["Restructurare", "warn"],
  ["Litigiu cu GT", "warn"],
  ["Lichidare", "alert"],
  ["Insolventa", "alert"],
  ["Dizolvat/Radiat", "alert"],
  ["Tepar", "alert"],
])

export function companyStatusToneOf(value: string): StatusTone {
  return COMPANY_STATUS_TONES.get(value) ?? "idle"
}
