import { describe, test, expect } from "bun:test"
import { parseUsageResponse, UsageParseError } from "../src/parse"
import fixture from "./fixtures/usage.json"

const NOW = new Date("2026-10-02T18:30:00Z")
const win = (utilization: unknown, resets_at?: unknown) => ({ utilization, resets_at })

describe("parseUsageResponse: input validation", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["array of objects", [{ five_hour: win(1) }]],
    ["string", "{}"],
    ["number", 42],
    ["boolean", true],
  ])("throws UsageParseError for %s", (_n, raw) => {
    expect(() => parseUsageResponse(raw, NOW)).toThrow(UsageParseError)
  })

  test("UsageParseError is an Error", () => {
    expect(new UsageParseError("x")).toBeInstanceOf(Error)
  })

  test("empty object yields no windows and null extraUsage", () => {
    const snap = parseUsageResponse({}, NOW)
    expect(snap.windows).toEqual([])
    expect(snap.extraUsage).toBeNull()
    expect(snap.fetchedAt).toBe(NOW)
  })
})

describe("parseUsageResponse: real fixture", () => {
  const snap = parseUsageResponse(fixture, NOW)

  test("yields exactly 5h=42 and Week=6, ignoring unknown keys", () => {
    expect(snap.windows.map((w) => [w.id, w.label, w.utilization])).toEqual([
      ["five_hour", "5h", 42],
      ["seven_day", "Week", 6],
    ])
  })

  test("parses reset timestamps", () => {
    expect(snap.windows[0]!.resetsAt!.getTime()).toBe(Date.parse("2026-10-02T19:50:00.184659+00:00"))
    expect(snap.windows[1]!.resetsAt!.getTime()).toBe(Date.parse("2026-10-04T17:00:00.184682+00:00"))
  })

  test("extraUsage disabled with null fields", () => {
    expect(snap.extraUsage).toEqual({ enabled: false, usedCredits: null, monthlyLimit: null, currency: null, decimalPlaces: null })
  })

  test("fetchedAt is now", () => {
    expect(snap.fetchedAt).toBe(NOW)
  })
})

describe("parseUsageResponse: windows", () => {
  test("fixed order regardless of key order, with labels", () => {
    const snap = parseUsageResponse(
      {
        seven_day_sonnet: win(4),
        seven_day_opus: win(3),
        seven_day: win(2),
        five_hour: win(1),
      },
      NOW,
    )
    expect(snap.windows.map((w) => [w.id, w.label])).toEqual([
      ["five_hour", "5h"],
      ["seven_day", "Week"],
      ["seven_day_opus", "Opus"],
      ["seven_day_sonnet", "Sonnet"],
    ])
  })

  test("clamps utilization to [0,100]", () => {
    const snap = parseUsageResponse({ five_hour: win(150), seven_day: win(-5), seven_day_opus: win(100) }, NOW)
    expect(snap.windows.map((w) => w.utilization)).toEqual([100, 0, 100])
  })

  test("keeps fractional utilization", () => {
    expect(parseUsageResponse({ five_hour: win(49.999) }, NOW).windows[0]!.utilization).toBe(49.999)
  })

  test.each([
    ["null", null],
    ["string", "50"],
    ["number", 50],
    ["array", [50]],
    ["missing utilization", {}],
    ["string utilization", win("50")],
    ["null utilization", win(null)],
  ])("skips window when value is %s", (_n, value) => {
    expect(parseUsageResponse({ five_hour: value, seven_day: win(7) }, NOW).windows.map((w) => w.id)).toEqual([
      "seven_day",
    ])
  })

  test("resetsAt null when missing, null, non-string, or invalid", () => {
    for (const r of [undefined, null, "not-a-date", "", 12345]) {
      const w = parseUsageResponse({ five_hour: win(10, r) }, NOW).windows[0]!
      expect(w.resetsAt).toBeNull()
      expect(w.utilization).toBe(10)
    }
  })

  test("resetsAt is a valid Date for ISO strings", () => {
    const w = parseUsageResponse({ five_hour: win(10, "2026-10-02T20:00:00Z") }, NOW).windows[0]!
    expect(w.resetsAt).toBeInstanceOf(Date)
    expect(w.resetsAt!.toISOString()).toBe("2026-10-02T20:00:00.000Z")
  })
})

describe("parseUsageResponse: extra_usage", () => {
  test.each([
    ["absent", undefined],
    ["null", null],
    ["string", "yes"],
    ["array", []],
  ])("null when extra_usage is %s", (_n, v) => {
    expect(parseUsageResponse({ extra_usage: v }, NOW).extraUsage).toBeNull()
  })

  test("enabled with values", () => {
    const snap = parseUsageResponse(
      { extra_usage: { is_enabled: true, used_credits: 12.5, monthly_limit: 100, currency: "USD" } },
      NOW,
    )
    expect(snap.extraUsage).toEqual({ enabled: true, usedCredits: 12.5, monthlyLimit: 100, currency: "USD", decimalPlaces: null })
  })

  test.each([
    [2, 2],
    [0, 0],
    [-1, null],
    [1.5, null],
    ["2", null],
    [null, null],
  ])("decimal_places %p parses to %p", (raw, expected) => {
    const snap = parseUsageResponse({ extra_usage: { is_enabled: true, decimal_places: raw } }, NOW)
    expect(snap.extraUsage!.decimalPlaces).toBe(expected)
  })

  test("enabled only when is_enabled === true", () => {
    for (const v of ["true", 1, null, undefined]) {
      expect(parseUsageResponse({ extra_usage: { is_enabled: v } }, NOW).extraUsage!.enabled).toBe(false)
    }
  })

  test("wrong-typed fields become null", () => {
    const snap = parseUsageResponse(
      { extra_usage: { is_enabled: true, used_credits: "5", monthly_limit: {}, currency: 3 } },
      NOW,
    )
    expect(snap.extraUsage).toEqual({ enabled: true, usedCredits: null, monthlyLimit: null, currency: null, decimalPlaces: null })
  })
})
