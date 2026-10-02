import { describe, expect, test } from "bun:test"
import { clampInterval, createPoller, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, type LoadRequest, type LoadResult, type Timers } from "../src/poller"
import type { UsageSnapshot } from "../src/types"

const snapshot = (n: number): UsageSnapshot => ({
  windows: [{ id: "five_hour", label: "5h", utilization: n, resetsAt: null }],
  extraUsage: null,
  breakdown: [],
  fetchedAt: new Date(0),
})
const ok = (n: number, nextInMs?: number): LoadResult => ({ ok: true, snapshot: snapshot(n), nextInMs })
const settle = () => new Promise((r) => setTimeout(r, 0))

function harness(results: LoadResult[], intervalMs?: number) {
  let time = 1_000_000
  const pending = new Map<number, { at: number; fn: () => void }>()
  const requests: LoadRequest[] = []
  let nextId = 1
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
    load: async (request) => results[Math.min(requests.push(request) - 1, results.length - 1)]!,
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
    await settle()
  }
  return { poller, advance, nextDelay, requests, now: () => time }
}

describe("clampInterval", () => {
  test("defaults to 120s with a 60s floor", () => {
    expect(DEFAULT_INTERVAL_MS).toBe(120_000)
    expect(MIN_INTERVAL_MS).toBe(60_000)
    expect(clampInterval(undefined)).toBe(120_000)
    expect(clampInterval(Number.NaN)).toBe(120_000)
    expect(clampInterval(1_000)).toBe(60_000)
    expect(clampInterval(90_500)).toBe(90_500)
  })
})

describe("poller", () => {
  test("loads on start and schedules the default interval", async () => {
    const h = harness([ok(10)])
    h.poller.start()
    await settle()
    expect(h.poller.getState().snapshot?.windows[0]?.utilization).toBe(10)
    expect(h.nextDelay()).toBe(120_000)
    expect(h.requests).toEqual([{ maxAgeMs: 120_000 }])
    h.poller.stop()
  })

  test("the loader's nextInMs overrides the interval, floored at 1s", async () => {
    const h = harness([ok(1, 45_000), ok(2, 10)])
    h.poller.start()
    await settle()
    expect(h.nextDelay()).toBe(45_000)
    await h.advance(45_000)
    expect(h.nextDelay()).toBe(1_000)
    h.poller.stop()
  })

  test("failures keep the last snapshot, expose retryAt and follow the loader's delay", async () => {
    const failure: LoadResult = { ok: false, kind: "rate_limited", message: "429", retryAfterMs: 240_000, nextInMs: 240_000 }
    const h = harness([ok(5), failure, ok(6)])
    h.poller.start()
    await settle()
    await h.advance(120_000)
    const { snapshot, error } = h.poller.getState()
    expect(snapshot?.windows[0]?.utilization).toBe(5)
    expect(error).toEqual({ kind: "rate_limited", message: "429", retryAt: new Date(h.now() + 240_000) })
    expect(h.nextDelay()).toBe(240_000)
    await h.advance(240_000)
    expect(h.poller.getState().error).toBeNull()
    h.poller.stop()
  })

  test("a failure may carry the shared snapshot to adopt", async () => {
    const h = harness([{ ok: false, kind: "network", message: "x", snapshot: snapshot(77) }])
    h.poller.start()
    await settle()
    expect(h.poller.getState().snapshot?.windows[0]?.utilization).toBe(77)
    h.poller.stop()
  })

  test("failures without a block have no retryAt", async () => {
    const h = harness([{ ok: false, kind: "credentials", message: "no creds" }])
    h.poller.start()
    await settle()
    expect(h.poller.getState().error).toEqual({ kind: "credentials", message: "no creds", retryAt: null })
    h.poller.stop()
  })

  test("renders the initial snapshot immediately", () => {
    const poller = createPoller({ initial: snapshot(9), load: () => new Promise(() => {}) })
    expect(poller.getState().snapshot?.windows[0]?.utilization).toBe(9)
  })

  test("refresh passes its max age and skips while a load is in flight", async () => {
    const h = harness([ok(1)])
    h.poller.start()
    const skipped = await h.poller.refresh(60_000)
    await settle()
    expect(skipped).toBe(false)
    expect(await h.poller.refresh(60_000)).toBe(true)
    expect(await h.poller.refresh()).toBe(true)
    expect(h.requests.map((r) => r.maxAgeMs)).toEqual([120_000, 60_000, 30_000])
    h.poller.stop()
  })

  test("stop() during an in-flight load does not reschedule or publish", async () => {
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

  test("subscribers are notified and can unsubscribe", async () => {
    const h = harness([ok(1)])
    const seen: boolean[] = []
    const off = h.poller.subscribe((s) => seen.push(s.loading))
    h.poller.start()
    await settle()
    expect(seen).toEqual([true, false])
    off()
    await h.advance(120_000)
    expect(seen).toHaveLength(2)
    h.poller.stop()
  })
})
