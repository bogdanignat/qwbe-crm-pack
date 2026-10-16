// Which collapsible blocks a viewer closed, kept in this browser only: a
// per-viewer convenience, never record data. Storage can be missing (server
// render), full or refused (private mode); every access is guarded and a
// failure just means "open", the default.

const PREFIX = "crm-pack.block-closed."

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">

const browserStore = (): Store | undefined => (typeof window === "undefined" ? undefined : window.localStorage)

// Reaching window.localStorage can itself throw (blocked storage), so the
// store is resolved inside the guard.
export function readBlockOpen(key: string, store?: Store): boolean {
  try {
    return (store ?? browserStore())?.getItem(PREFIX + key) !== "1"
  } catch {
    return true
  }
}

// Only a closed block is stored; opening it again removes the entry.
export function writeBlockOpen(key: string, open: boolean, store?: Store): void {
  try {
    const target = store ?? browserStore()
    if (open) target?.removeItem(PREFIX + key)
    else target?.setItem(PREFIX + key, "1")
  } catch {
    // Storage refused: the block still toggles, it is only not remembered.
  }
}
