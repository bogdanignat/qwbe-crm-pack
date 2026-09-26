#!/usr/bin/env node
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { requestStop } from "./launcher-control.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
try {
  if (process.argv.length > 2) throw new Error("Utilizare: npm stop (fără argumente).")
  const stopped = await requestStop(root)
  console.log(stopped
    ? "Mama qwbe și CRM au fost oprite. Baza de date și celelalte proiecte sunt neatinse."
    : "Nu există un launcher activ pentru acest CRM. Nu am oprit niciun proces; baza de date este neatinsă.")
} catch (error) {
  console.error(`Oprire refuzată: ${error.message}`)
  process.exitCode = 1
}
