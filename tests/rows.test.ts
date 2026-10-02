import { describe, expect, test } from "bun:test"
import { parseOptions } from "../src/options"
import { buildRows } from "../src/rows"
import type { PollerState } from "../src/poller"
import type { UsageSnapshot } from "../src/types"

const now = new Date("2026-01-01T12:00:00Z")
const snapshot: UsageSnapshot = {
  windows: [
    { id: "five_hour", label: "5h", utilization: 51, resetsAt: new Date(now.getTime() + 70 * 60_000) },
    { id: "seven_day", label: "Week", utilization: 6, resetsAt: null },
    { id: "seven_day_opus", label: "Opus", utilization: 80, resetsAt: null },
  ],
  extraUsage: { enabled: true, usedCredits: 1250, monthlyLimit: 5000, currency: "USD", decimalPlaces: 2 },
  breakdown: [
    { key: "cc", label: "Claude Code", percent: 86 },
    { key: "zero", label: "Nothing", percent: 0 },
  ],
  fetchedAt: new Date(now.getTime() - 12_000),
}
const base: PollerState = { snapshot, error: null, lastAttemptAt: now, loading: false }
const texts = (state: PollerState, opts = parseOptions({})) =>
  buildRows(state, now, opts).map((r) => (r.kind === "text" ? r.text : `${r.label}${r.percent}`))

describe("buildRows", () => {
  test("renders windows, reset, extra usage, breakdown and age", () => {
    const out = texts(base)
    expect(out).toContain("5h       51%")
    expect(out).toContain("       resets in 1h 10m")
    expect(out).toContain("Extra  $12.50 / $50.00")
    expect(out).toContain("This week")
    expect(out).toContain("Claude Code".padEnd(21) + "  86%")
    expect(out.some((t) => t.startsWith("Nothing"))).toBe(false)
    expect(out.at(-1)).toBe("updated 12s ago")
  })

  test("respects showModels and showBreakdown", () => {
    const out = texts(base, parseOptions({ showModels: false, showBreakdown: false }))
    expect(out.some((t) => t.startsWith("Opus"))).toBe(false)
    expect(out.some((t) => t.startsWith("This week"))).toBe(false)
  })

  test("scales extra usage by decimalPlaces and shows raw numbers when null", () => {
    const withDp = (decimalPlaces: number | null) => ({
      ...base,
      snapshot: { ...snapshot, extraUsage: { enabled: true, usedCredits: 1250, monthlyLimit: 10000, currency: "USD", decimalPlaces } },
    })
    expect(texts(withDp(2))).toContain("Extra  $12.50 / $100.00")
    expect(texts(withDp(0))).toContain("Extra  $1,250.00 / $10,000.00")
    expect(texts(withDp(null))).toContain("Extra  $1,250.00 / $10,000.00")
  })

  test("hides extra usage when disabled", () => {
    const out = texts({ ...base, snapshot: { ...snapshot, extraUsage: { ...snapshot.extraUsage!, enabled: false } } })
    expect(out.some((t) => t.startsWith("Extra"))).toBe(false)
  })

  test("shows the error with a stale marker when a snapshot exists", () => {
    const out = texts({ ...base, error: { kind: "network", message: "offline" } })
    expect(out).toContain("offline (stale)")
  })

  test("shows only the error without a snapshot", () => {
    const out = texts({ ...base, snapshot: null, error: { kind: "credentials", message: "Not signed in" } })
    expect(out).toEqual(["Not signed in"])
  })
})
