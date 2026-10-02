import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCacheDir, nodeFs } from "../src/shared-fs"
import { createSharedStore, emptyState, LOCK_STALE_MS, type SharedState } from "../src/shared-state"
import type { UsageSnapshot } from "../src/types"
import { createMemFs } from "./helpers/memfs"

const DIR = "/cache/ocq"
const STATE = `${DIR}/state.json`
const LOCK = `${DIR}/fetch.lock`

const snapshot: UsageSnapshot = {
  windows: [{ id: "five_hour", label: "5h", utilization: 42, resetsAt: new Date("2026-10-02T20:00:00Z") }],
  extraUsage: { enabled: true, usedCredits: 150, monthlyLimit: 1000, currency: "USD", decimalPlaces: 2 },
  breakdown: [{ key: "claude_code", label: "Claude Code", percent: 90 }],
  fetchedAt: new Date("2026-10-02T18:30:00Z"),
}
const state: SharedState = {
  version: 1,
  snapshot,
  fetchedAt: snapshot.fetchedAt.getTime(),
  blockedUntil: 5000,
  consecutiveFailures: 2,
  lastError: { kind: "rate_limited", message: "slow down" },
}

function setup() {
  let t = 1_000_000
  const mem = createMemFs(() => t)
  const store = createSharedStore({ dir: DIR, fs: mem.fs, now: () => t })
  return { mem, store, advance: (ms: number) => (t += ms) }
}

describe("read/write", () => {
  test("a missing file reads as an empty state", () => {
    expect(setup().store.read()).toEqual(emptyState())
  })

  test("round-trips a state with dates revived", () => {
    const { store } = setup()
    expect(store.write(state)).toBe(true)
    const back = store.read()
    expect(back).toEqual(state)
    expect(back.snapshot?.fetchedAt).toBeInstanceOf(Date)
    expect(back.snapshot?.windows[0]?.resetsAt).toBeInstanceOf(Date)
  })

  test("the persisted file holds dates as ISO strings and only known keys", () => {
    const { store, mem } = setup()
    store.write(state)
    const raw = JSON.parse(mem.files.get(STATE)!.data)
    expect(Object.keys(raw).sort()).toEqual(["blockedUntil", "consecutiveFailures", "fetchedAt", "lastError", "snapshot", "version"])
    expect(raw.snapshot.fetchedAt).toBe("2026-10-02T18:30:00.000Z")
  })

  test.each(["", "not json {", "[1]", "null", '{"version":2}', '{"version":1,"snapshot":"x"}'])(
    "corrupt content %j reads as empty without throwing",
    (content) => {
      const { store, mem } = setup()
      mem.files.set(STATE, { data: content, mtime: 0 })
      expect(store.read().snapshot).toBeNull()
      expect(store.read().blockedUntil).toBe(0)
    },
  )

  test("a malformed snapshot is dropped but valid siblings survive", () => {
    const { store, mem } = setup()
    const broken = { ...state, snapshot: { ...state.snapshot, windows: [{ id: "bogus" }] } }
    mem.files.set(STATE, { data: JSON.stringify(broken), mtime: 0 })
    const back = store.read()
    expect(back.snapshot).toBeNull()
    expect(back.fetchedAt).toBeNull()
    expect(back.blockedUntil).toBe(5000)
    expect(back.lastError?.kind).toBe("rate_limited")
  })

  test("writes go through a temp file and rename, never straight to state.json", () => {
    const { store, mem } = setup()
    store.write(state)
    expect(mem.writes).toHaveLength(1)
    expect(mem.writes[0]).not.toBe(STATE)
    expect(mem.writes[0]).toStartWith(`${STATE}.`)
    expect(mem.renames).toEqual([[mem.writes[0]!, STATE]])
    expect([...mem.files.keys()]).toEqual([STATE])
  })

  test("a failing write reports false and keeps the previous state", () => {
    const { store, mem } = setup()
    store.write(state)
    mem.fail.write = true
    expect(store.write({ ...state, blockedUntil: 9 })).toBe(false)
    expect(store.read().blockedUntil).toBe(5000)
    mem.fail.mkdir = true
    mem.fail.write = false
    expect(store.write(state)).toBe(false)
  })
})

describe("lock", () => {
  test("only one holder at a time; release frees it", () => {
    const { store, mem } = setup()
    const release = store.tryLock()
    expect(release).not.toBeNull()
    expect(store.tryLock()).toBeNull()
    release!()
    expect(mem.files.has(LOCK)).toBe(false)
    expect(store.tryLock()).not.toBeNull()
  })

  test("a lock older than 30s is stale and gets taken over", () => {
    const { store, advance } = setup()
    store.tryLock()
    advance(LOCK_STALE_MS)
    expect(store.tryLock()).toBeNull()
    advance(1)
    expect(store.tryLock()).not.toBeNull()
  })

  test("an unusable cache directory degrades to uncoordinated fetching", () => {
    const { store, mem } = setup()
    mem.fail.mkdir = true
    const release = store.tryLock()
    expect(release).not.toBeNull()
    expect(() => release!()).not.toThrow()
  })
})

describe("paths and real filesystem", () => {
  test("defaultCacheDir honours an absolute XDG_CACHE_HOME only", () => {
    expect(defaultCacheDir({ XDG_CACHE_HOME: "/x/cache" }, "/home/u")).toBe("/x/cache/opencode-claude-quota")
    expect(defaultCacheDir({ XDG_CACHE_HOME: "relative" }, "/home/u")).toBe("/home/u/.cache/opencode-claude-quota")
    expect(defaultCacheDir({ XDG_CACHE_HOME: " " }, "/home/u")).toBe("/home/u/.cache/opencode-claude-quota")
    expect(defaultCacheDir({}, "/home/u")).toBe("/home/u/.cache/opencode-claude-quota")
  })

  test("nodeFs creates the directory 0700 and files 0600", () => {
    const root = mkdtempSync(join(tmpdir(), "ocq-test-"))
    try {
      const dir = join(root, "nested", "opencode-claude-quota")
      const store = createSharedStore({ dir, fs: nodeFs, now: Date.now })
      expect(store.write(state)).toBe(true)
      expect(store.read()).toEqual(state)
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600)
      const release = store.tryLock()
      expect(release).not.toBeNull()
      expect(statSync(join(dir, "fetch.lock")).mode & 0o777).toBe(0o600)
      expect(store.tryLock()).toBeNull()
      release!()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
