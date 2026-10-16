import { test } from "node:test"
import assert from "node:assert/strict"

import { DEFAULT_LIST_STATE, listStateOf, writeListState, type ListState } from "./list-url.ts"

const read = (query: string) => listStateOf(new URLSearchParams(query))
const written = (state: ListState, query = "") => {
  const params = new URLSearchParams(query)
  writeListState(params, state)
  return params.toString()
}

test("an empty URL is the default list", () => {
  assert.deepEqual(read(""), DEFAULT_LIST_STATE)
})

test("the defaults stay out of the URL, other keys stay in", () => {
  assert.equal(written(DEFAULT_LIST_STATE, "tab=more&q=old&f.name=x&page=3"), "tab=more")
})

test("a state round-trips through the URL", () => {
  const state: ListState = {
    q: "Exe mplu",
    filters: { industry: "Construction" },
    sortBy: "name",
    descending: true,
    offset: 100,
    pageSize: 50,
  }
  const query = written(state)
  assert.equal(query, "q=Exe+mplu&f.industry=Construction&sort=-name&page=3&size=50")
  assert.deepEqual(read(query), state)
})

test("bad values fall back to their defaults", () => {
  const state = read("size=999&page=-2&sort=name;drop&f.1bad=x&f.ok=%20%20&q=%20")
  assert.deepEqual(state, DEFAULT_LIST_STATE)
  assert.equal(read("page=2.5&size=50").offset, 0)
  assert.equal(read("page=99999999999").offset, 0)
})

test("long values are cut", () => {
  assert.equal(read(`q=${"a".repeat(500)}`).q.length, 200)
})

test("the page follows the size", () => {
  assert.equal(read("page=4&size=100").offset, 300)
  assert.equal(read("page=4").offset, 75)
})
