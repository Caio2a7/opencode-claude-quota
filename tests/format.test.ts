import { describe, test, expect } from "bun:test"
import { formatDuration, formatAge, severity, renderBar } from "../src/format"

const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H

describe("formatDuration", () => {
  test.each([
    [0, "now"],
    [-1, "now"],
    [-10 * D, "now"],
    [1, "1m"],
    [59_999, "1m"],
    [60_000, "1m"],
    [119_999, "1m"],
    [120_000, "2m"],
    [H - 1, "59m"],
    [H, "1h 0m"],
    [H + 59_999, "1h 0m"],
    [2 * H, "2h 0m"],
    [2 * H + 30 * M, "2h 30m"],
    [D - 1, "23h 59m"],
    [D, "1d 0h"],
    [D + H, "1d 1h"],
    [D + H - 1, "1d 0h"],
    [3 * D + 5 * H + 59 * M, "3d 5h"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe("formatAge", () => {
  test.each([
    [0, "just now"],
    [9_999, "just now"],
    [10_000, "10s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [H - 1, "59m ago"],
    [H, "1h ago"],
    [H + 59 * M, "1h ago"],
    [5 * H, "5h ago"],
    [30 * H, "30h ago"],
  ])("%d ms -> %s", (ms, expected) => {
    expect(formatAge(ms)).toBe(expected)
  })
})

describe("severity", () => {
  test.each([
    [-5, "ok"],
    [0, "ok"],
    [49.999, "ok"],
    [50, "warn"],
    [74.99, "warn"],
    [75, "high"],
    [99.99, "high"],
    [100, "critical"],
    [150, "critical"],
  ])("%d -> %s", (pct, expected) => {
    expect(severity(pct)).toBe(expected as never)
  })
})

describe("renderBar", () => {
  test("empty and full", () => {
    expect(renderBar(0, 10)).toEqual({ filled: "", empty: "─".repeat(10) })
    expect(renderBar(100, 10)).toEqual({ filled: "━".repeat(10), empty: "" })
  })

  test("rounds to nearest cell", () => {
    expect(renderBar(42, 10)).toEqual({ filled: "━".repeat(4), empty: "─".repeat(6) })
    expect(renderBar(50, 10)).toEqual({ filled: "━".repeat(5), empty: "─".repeat(5) })
    expect(renderBar(14, 10).filled).toBe("━")
    expect(renderBar(16, 10).filled).toBe("━━")
    expect(renderBar(4.9, 10).filled).toBe("")
    expect(renderBar(95.1, 10).filled).toBe("━".repeat(10))
  })

  test("clamps out-of-range percentages", () => {
    expect(renderBar(-5, 8)).toEqual({ filled: "", empty: "─".repeat(8) })
    expect(renderBar(150, 8)).toEqual({ filled: "━".repeat(8), empty: "" })
    expect(renderBar(Infinity, 8).filled).toBe("━".repeat(8))
  })

  test("non-positive width yields empty strings", () => {
    expect(renderBar(50, 0)).toEqual({ filled: "", empty: "" })
    expect(renderBar(50, -4)).toEqual({ filled: "", empty: "" })
  })

  test("total length always equals width", () => {
    for (const width of [1, 2, 7, 10, 33]) {
      for (const pct of [-1, 0, 0.1, 33.3, 49.999, 50, 66.6, 99.99, 100, 200]) {
        const { filled, empty } = renderBar(pct, width)
        expect(filled.length + empty.length).toBe(width)
        expect(filled).toBe("━".repeat(filled.length))
        expect(empty).toBe("─".repeat(empty.length))
      }
    }
  })

  test("NaN does not throw", () => {
    expect(() => renderBar(NaN, 10)).not.toThrow()
  })
})
