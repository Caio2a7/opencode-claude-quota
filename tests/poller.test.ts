import { describe, expect, test } from "bun:test"
import { createPoller, MAX_BACKOFF_MS, type LoadResult, type Timers } from "../src/poller"
import type { UsageSnapshot } from "../src/types"

const snapshot = (n: number): UsageSnapshot => ({
  windows: [{ id: "five_hour", label: "5h", utilization: n, resetsAt: null }],
  extraUsage: null,
  breakdown: [],
  fetchedAt: new Date(0),
})

function harness(results: LoadResult[], intervalMs?: number) {
  let time = 1_000_000
  const pending = new Map<number, { at: number; fn: () => void }>()
  let nextId = 1
  let calls = 0
  const timers: Timers = {
    set: (fn, ms) => {
      const id = nextId++
      pending.set(id, { at: time + ms, fn })
      return id
    },
    clear: (handle) => void pending.delete(handle as number),
  }
  const poller = createPoller({
    intervalMs,
    now: () => new Date(time),
    timers,
    load: async () => results[Math.min(calls++, results.length - 1)]!,
  })
  const nextDelay = (): number | null => {
    const first = [...pending.values()].sort((a, b) => a.at - b.at)[0]
    return first ? first.at - time : null
  }
  const advance = async (ms: number): Promise<void> => {
    time += ms
    for (const [id, t] of [...pending]) {
      if (t.at <= time) {
        pending.delete(id)
        t.fn()
      }
    }
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { poller, advance, nextDelay, calls: () => calls }
}

const ok = (n: number): LoadResult => ({ ok: true, snapshot: snapshot(n) })
const fail = (kind: "network" | "http" | "unauthorized"): LoadResult => ({ ok: false, kind, message: kind })
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("poller", () => {
  test("fetches on start and schedules the default 60s interval", async () => {
    const h = harness([ok(10)])
    h.poller.start()
    await settle()
    expect(h.poller.getState().snapshot?.windows[0]?.utilization).toBe(10)
    expect(h.nextDelay()).toBe(60_000)
    h.poller.stop()
  })

  test("clamps the interval to a 30s minimum", async () => {
    const h = harness([ok(1)], 5_000)
    h.poller.start()
    await settle()
    expect(h.nextDelay()).toBe(30_000)
    h.poller.stop()
  })

  test("keeps the last good snapshot when a later fetch fails", async () => {
    const h = harness([ok(10), fail("network")])
    h.poller.start()
    await settle()
    await h.advance(60_000)
    await settle()
    const state = h.poller.getState()
    expect(state.snapshot?.windows[0]?.utilization).toBe(10)
    expect(state.error?.kind).toBe("network")
    h.poller.stop()
  })

  test("backs off exponentially on network errors, capped at 10 minutes", async () => {
    const h = harness([fail("network")])
    h.poller.start()
    await settle()
    expect(h.nextDelay()).toBe(60_000)
    const delays: number[] = []
    for (let i = 0; i < 6; i++) {
      await h.advance(h.nextDelay() ?? 0)
      await settle()
      delays.push(h.nextDelay() ?? 0)
    }
    expect(delays[0]).toBe(120_000)
    expect(delays[1]).toBe(240_000)
    expect(Math.max(...delays)).toBe(MAX_BACKOFF_MS)
    h.poller.stop()
  })

  test("waits at least retryAfterMs when rate limited", async () => {
    const h = harness([{ ok: false, kind: "rate_limited", message: "slow down", retryAfterMs: 300_000 }])
    h.poller.start()
    await settle()
    expect(h.nextDelay()).toBe(300_000)
    h.poller.stop()
  })

  test("resets the backoff after a success", async () => {
    const h = harness([fail("http"), ok(5)])
    h.poller.start()
    await settle()
    await h.advance(60_000)
    await settle()
    expect(h.poller.getState().error).toBeNull()
    expect(h.nextDelay()).toBe(60_000)
    h.poller.stop()
  })

  test("debounces manual refresh within 30s of a real request", async () => {
    const h = harness([ok(1), ok(2)])
    h.poller.start()
    await settle()
    expect(await h.poller.refresh()).toBe(false)
    expect(h.calls()).toBe(1)
    await h.advance(30_000)
    expect(await h.poller.refresh()).toBe(true)
    expect(h.poller.getState().snapshot?.windows[0]?.utilization).toBe(2)
    h.poller.stop()
  })

  test("stop cancels the pending timer", async () => {
    const h = harness([ok(1)])
    h.poller.start()
    await settle()
    h.poller.stop()
    expect(h.nextDelay()).toBeNull()
  })

  test("notifies subscribers and supports unsubscribe", async () => {
    const h = harness([ok(1)])
    let notified = 0
    const off = h.poller.subscribe(() => notified++)
    h.poller.start()
    await settle()
    expect(notified).toBeGreaterThanOrEqual(2)
    off()
    h.poller.stop()
  })

  test("manual refresh cannot bypass network backoff", async () => {
    const h2 = harness([fail("network"), fail("network"), ok(1)])
    h2.poller.start()
    await settle()
    await h2.advance(60_000)
    await settle()
    expect(await h2.poller.refresh()).toBe(false)
    await h2.advance(60_000)
    expect(await h2.poller.refresh()).toBe(false)
    expect(h2.calls()).toBe(2)
    h2.poller.stop()
  })

  test("backs off on repeated unauthorized responses but still allows manual refresh", async () => {
    const h = harness([fail("unauthorized"), fail("unauthorized"), ok(1)])
    h.poller.start()
    await settle()
    expect(h.nextDelay()).toBe(60_000)
    await h.advance(60_000)
    await settle()
    expect(h.nextDelay()).toBe(120_000)
    await h.advance(30_000) // past the debounce window, still inside the backoff
    expect(await h.poller.refresh()).toBe(true)
    expect(h.poller.getState().error).toBeNull()
    h.poller.stop()
  })

  test("internal and credential failures keep the plain interval", async () => {
    const h = harness([{ ok: false, kind: "internal", message: "x" }])
    h.poller.start()
    await settle()
    await h.advance(60_000)
    await settle()
    expect(h.nextDelay()).toBe(60_000)
    h.poller.stop()
  })

  test("stop() during an in-flight attempt does not reschedule or publish", async () => {
    let release: (r: LoadResult) => void = () => {}
    const scheduled: number[] = []
    const timers: Timers = { set: (_fn, ms) => scheduled.push(ms), clear: () => {} }
    const poller = createPoller({ timers, load: () => new Promise<LoadResult>((r) => (release = r)) })
    poller.start()
    await settle()
    poller.stop()
    release(ok(7))
    await settle()
    expect(scheduled).toEqual([])
    expect(poller.getState().snapshot).toBeNull()
  })
})
