import { describe, expect, test } from "bun:test"
import { parseOptions } from "../src/options"

describe("parseOptions", () => {
  test("applies defaults for missing options", () => {
    expect(parseOptions(undefined)).toEqual({
      refreshIntervalMs: 60_000,
      showBreakdown: true,
      showModels: true,
      credentialsPath: undefined,
    })
    expect(parseOptions({})).toEqual(parseOptions(undefined))
  })

  test.each([
    [5, 30_000],
    [0, 30_000],
    [-10, 30_000],
    [30, 30_000],
    [90, 90_000],
    [45.5, 45_500],
  ])("refreshInterval %p seconds -> %p ms", (seconds, ms) => {
    expect(parseOptions({ refreshInterval: seconds }).refreshIntervalMs).toBe(ms)
  })

  test.each([["fast"], [null], [Number.NaN], [Infinity], [undefined]])("invalid refreshInterval %p -> default", (v) => {
    expect(parseOptions({ refreshInterval: v }).refreshIntervalMs).toBe(60_000)
  })

  test("booleans must be real booleans", () => {
    expect(parseOptions({ showBreakdown: false, showModels: false })).toMatchObject({
      showBreakdown: false,
      showModels: false,
    })
    expect(parseOptions({ showBreakdown: "no", showModels: 0 })).toMatchObject({
      showBreakdown: true,
      showModels: true,
    })
  })

  test("credentialsPath is trimmed and blank/non-string values are dropped", () => {
    expect(parseOptions({ credentialsPath: "  /tmp/c.json " }).credentialsPath).toBe("/tmp/c.json")
    expect(parseOptions({ credentialsPath: "   " }).credentialsPath).toBeUndefined()
    expect(parseOptions({ credentialsPath: 3 }).credentialsPath).toBeUndefined()
  })
})
