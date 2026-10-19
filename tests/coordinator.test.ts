import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { backoffMs, BACKOFF_MAX_MS, createCoordinator, LOCK_RETRY_MS } from "../src/coordinator"
import { createPoller, type LoadResult, type Timers } from "../src/poller"
import { createSharedStore } from "../src/shared-state"
import type { UsageSnapshot } from "../src/types"
import { createMemFs } from "./helpers/memfs"

const MIN = 60_000
const INTERVAL = 2 * MIN
const DIR = "/cache/ocq"
const LOCK = join(DIR, "fetch.lock")

function world() {
  let t = 1_000_000_000_000
  const now = () => t
  const mem = createMemFs(now)
  const store = createSharedStore({ dir: DIR, fs: mem.fs, now })
  const queue: LoadResult[] = []
  let fetches = 0
  let gate: Promise<void> | null = null
  const fetchOnce = async (): Promise<LoadResult> => {
    fetches++
    if (gate) await gate
    return queue.shift() ?? { ok: false, kind: "internal", message: "queue empty" }
  }
  const coordinator = () => createCoordinator({ store, fetchOnce, intervalMs: INTERVAL, now })
  const snap = (n: number): UsageSnapshot => ({
    windows: [{ id: "five_hour", label: "5h", utilization: n, resetsAt: null }],
    extraUsage: null,
    breakdown: [],
    fetchedAt: new Date(t),
  })
  return {
    store,
    mem,
    now,
    queue,
    coordinator,
    snap,
    fetches: () => fetches,
    advance: (ms: number) => (t += ms),
    hold: () => {
      let open!: () => void
      gate = new Promise<void>((r) => (open = r))
      return () => open()
    },
    ok: (n: number): LoadResult => ({ ok: true, snapshot: snap(n) }),
  }
}

const rateLimited = (retryAfterMs?: number): LoadResult => ({ ok: false, kind: "rate_limited", message: "429", retryAfterMs })
const req = { maxAgeMs: INTERVAL }

describe("adoption", () => {
  test("a second instance adopts the shared snapshot without a request", async () => {
    const w = world()
    w.queue.push(w.ok(10))
    const a = w.coordinator()
    const b = w.coordinator()
    expect((await a(req)).ok).toBe(true)
    w.advance(30_000)
    const second = await b(req)
    expect(w.fetches()).toBe(1)
    expect(second.ok && second.snapshot.windows[0]?.utilization).toBe(10)
    expect(second.nextInMs).toBe(INTERVAL - 30_000)
  })

  test("fetches again once the snapshot reaches the requested max age", async () => {
    const w = world()
    w.queue.push(w.ok(10), w.ok(20))
    const load = w.coordinator()
    await load(req)
    w.advance(INTERVAL - 1)
    await load(req)
    expect(w.fetches()).toBe(1)
    w.advance(1)
    const third = await load(req)
    expect(w.fetches()).toBe(2)
    expect(third.ok && third.snapshot.windows[0]?.utilization).toBe(20)
  })

  test("post-turn refreshes only fetch when the snapshot is older than 60s", async () => {
    const w = world()
    w.queue.push(w.ok(10), w.ok(20))
    const load = w.coordinator()
    await load(req)
    w.advance(40_000)
    await load({ maxAgeMs: MIN })
    expect(w.fetches()).toBe(1)
    w.advance(30_000)
    await load({ maxAgeMs: MIN })
    expect(w.fetches()).toBe(2)
  })
})

describe("backoff persistence", () => {
  test("429 honours Retry-After and blocks every instance", async () => {
    const w = world()
    w.queue.push(rateLimited(5 * MIN))
    const a = w.coordinator()
    const b = w.coordinator()
    const first = await a(req)
    expect(!first.ok && first.retryAfterMs).toBe(5 * MIN)
    expect(w.store.read().blockedUntil).toBe(w.now() + 5 * MIN)
    w.advance(MIN)
    const second = await b({ maxAgeMs: 0 })
    expect(w.fetches()).toBe(1)
    expect(!second.ok && second.kind).toBe("rate_limited")
    expect(!second.ok && second.retryAfterMs).toBe(4 * MIN)
  })

  test("without Retry-After the block grows 2m, 4m, 8m… up to 30m", async () => {
    const w = world()
    const load = w.coordinator()
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      w.queue.push(rateLimited())
      const r = await load({ maxAgeMs: 0 })
      delays.push(!r.ok ? (r.retryAfterMs ?? -1) : -1)
      w.advance(delays.at(-1)!)
    }
    expect(delays).toEqual([2, 4, 8, 16, 30, 30, 30].map((m) => m * MIN))
    expect(backoffMs(99)).toBe(BACKOFF_MAX_MS)
  })

  test("a success resets the failure count and the block", async () => {
    const w = world()
    const load = w.coordinator()
    w.queue.push(rateLimited(), rateLimited(), w.ok(5), rateLimited())
    for (let i = 0; i < 2; i++) w.advance((await load({ maxAgeMs: 0 }))!.nextInMs!)
    expect(w.store.read().consecutiveFailures).toBe(2)
    await load({ maxAgeMs: 0 })
    expect(w.store.read()).toMatchObject({ consecutiveFailures: 0, blockedUntil: 0, lastError: null })
    w.advance(INTERVAL)
    const again = await load({ maxAgeMs: 0 })
    expect(!again.ok && again.retryAfterMs).toBe(2 * MIN)
  })

  test.each(["network", "http"] as const)("%s errors share the same persisted backoff", async (kind) => {
    const w = world()
    w.queue.push({ ok: false, kind, message: "boom" })
    const result = await w.coordinator()(req)
    expect(!result.ok && result.retryAfterMs).toBe(2 * MIN)
    expect(w.store.read()).toMatchObject({ consecutiveFailures: 1, lastError: { kind, message: "boom" } })
    expect(w.store.read().blockedUntil).toBe(w.now() + 2 * MIN)
  })

  test("a failure keeps the last good snapshot for every instance", async () => {
    const w = world()
    w.queue.push(w.ok(33), rateLimited())
    const load = w.coordinator()
    await load(req)
    w.advance(INTERVAL)
    const failed = await load(req)
    expect(!failed.ok && failed.snapshot?.windows[0]?.utilization).toBe(33)
    expect(w.store.read().snapshot?.windows[0]?.utilization).toBe(33)
  })

  test("unauthorized is not shared: other instances may still try", async () => {
    const w = world()
    w.queue.push({ ok: false, kind: "unauthorized", message: "denied" }, w.ok(1))
    const r = await w.coordinator()(req)
    expect(!r.ok && r.kind).toBe("unauthorized")
    expect(r.nextInMs).toBe(INTERVAL)
    expect(w.store.read().blockedUntil).toBe(0)
    expect((await w.coordinator()(req)).ok).toBe(true)
  })
})

describe("single flight", () => {
  test("a held lock makes other instances wait and re-read instead of fetching", async () => {
    const w = world()
    const open = w.hold()
    w.queue.push(w.ok(7))
    const a = w.coordinator()(req)
    const waiting = await w.coordinator()(req)
    expect(w.fetches()).toBe(1)
    expect(waiting).toMatchObject({ ok: false, nextInMs: LOCK_RETRY_MS })
    open()
    await a
    expect(w.mem.files.has(LOCK)).toBe(false)
  })

  test("a crashed holder's stale lock does not block fetching forever", async () => {
    const w = world()
    w.mem.files.set(LOCK, { data: "x", mtime: w.now() - 31_000 })
    w.queue.push(w.ok(3))
    expect((await w.coordinator()(req)).ok).toBe(true)
    expect(w.fetches()).toBe(1)
  })

  test("the lock is released even when fetching rejects", async () => {
    const w = world()
    const load = createCoordinator({ store: w.store, fetchOnce: () => Promise.reject(new Error("x")), intervalMs: INTERVAL, now: w.now })
    await expect(load(req)).rejects.toThrow()
    expect(w.mem.files.has(LOCK)).toBe(false)
  })
})

describe("pollers sharing one state file", () => {
  function instance(w: ReturnType<typeof world>) {
    const scheduled: Array<{ fn: () => void; ms: number }> = []
    const timers: Timers = { set: (fn, ms) => scheduled.push({ fn, ms }), clear: () => {} }
    const poller = createPoller({
      timers,
      intervalMs: INTERVAL,
      now: () => new Date(w.now()),
      initial: w.store.read().snapshot,
      load: w.coordinator(),
    })
    return { poller, scheduled }
  }
  const settle = () => new Promise((r) => setTimeout(r, 0))

  test("two instances starting together issue exactly one fetch", async () => {
    const w = world()
    const open = w.hold()
    w.queue.push(w.ok(12))
    const a = instance(w)
    const b = instance(w)
    a.poller.start()
    b.poller.start()
    await settle()
    open()
    await settle()
    expect(w.fetches()).toBe(1)
    expect(a.poller.getState().snapshot?.windows[0]?.utilization).toBe(12)
    const retry = b.scheduled.at(-1)!
    expect(retry.ms).toBe(LOCK_RETRY_MS)
    retry.fn()
    await settle()
    expect(w.fetches()).toBe(1)
    expect(b.poller.getState().snapshot?.windows[0]?.utilization).toBe(12)
    a.poller.stop()
    b.poller.stop()
  })

  test("startup renders from the shared cache before any load completes", async () => {
    const w = world()
    w.queue.push(w.ok(64))
    await w.coordinator()(req)
    w.advance(10_000)
    const late = instance(w)
    expect(late.poller.getState().snapshot?.windows[0]?.utilization).toBe(64)
    late.poller.start()
    await settle()
    expect(w.fetches()).toBe(1)
    expect(late.poller.getState().error).toBeNull()
    expect(late.scheduled[0]!.ms).toBe(INTERVAL - 10_000)
    late.poller.stop()
  })

  test("an instance starting during a block shows the data plus the rate-limit state", async () => {
    const w = world()
    w.queue.push(w.ok(64), rateLimited(4 * MIN))
    const load = w.coordinator()
    await load(req)
    w.advance(INTERVAL)
    await load(req)
    const late = instance(w)
    late.poller.start()
    await settle()
    const { snapshot, error } = late.poller.getState()
    expect(snapshot?.windows[0]?.utilization).toBe(64)
    expect(error?.kind).toBe("rate_limited")
    expect(error?.retryAt?.getTime()).toBe(w.now() + 4 * MIN)
    expect(w.fetches()).toBe(2)
    late.poller.stop()
  })
})
