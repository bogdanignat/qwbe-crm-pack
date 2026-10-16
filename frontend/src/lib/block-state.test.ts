// The remembered open/closed state of a block (T-1814): per browser, and a
// storage failure never breaks the page.

import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { readBlockOpen, writeBlockOpen } from "./block-state.ts"

const memory = () => {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  }
}

const refusing = {
  getItem: () => {
    throw new Error("SecurityError")
  },
  setItem: () => {
    throw new Error("QuotaExceededError")
  },
  removeItem: () => {
    throw new Error("SecurityError")
  },
}

describe("block state", () => {
  it("is open until closed, and stores only a closed block", () => {
    const store = memory()
    assert.equal(readBlockOpen("org.Address", store), true)
    writeBlockOpen("org.Address", false, store)
    assert.equal(readBlockOpen("org.Address", store), false)
    assert.equal(readBlockOpen("org.Description", store), true)
    writeBlockOpen("org.Address", true, store)
    assert.equal(store.items.size, 0)
  })

  it("falls back to open when storage is missing or refuses", () => {
    assert.equal(readBlockOpen("x"), true)
    assert.equal(readBlockOpen("x", refusing), true)
    assert.doesNotThrow(() => writeBlockOpen("x", false, refusing))
  })
})
