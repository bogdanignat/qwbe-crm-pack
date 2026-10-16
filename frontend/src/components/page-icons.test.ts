// Every page of the registry has a menu icon: a page added to APP_PAGES
// without one would show a bare label in the sidebar and in "+ New".

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { APP_PAGES } from "../lib/app-pages.ts"
import { PAGE_ICONS } from "./page-icons.ts"

describe("PAGE_ICONS", () => {
  it("has an icon for every APP_PAGES href", () => {
    const missing = APP_PAGES.map((page) => page.href).filter((href) => !PAGE_ICONS[href])
    assert.deepEqual(missing, [])
  })
})
