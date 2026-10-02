import { describe, test, expect } from "bun:test"
import { parseUsageResponse } from "../src/parse"

const NOW = new Date("2026-10-02T18:30:00Z")
const parse = (b: unknown) => parseUsageResponse({ seven_day_breakdown: b }, NOW).breakdown

describe("parseUsageResponse: seven_day_breakdown", () => {
  test("parses rows with display_name labels", () => {
    expect(
      parse({ rows: [{ key: "claude_code", display_name: "Claude Code", percent: 86 }, { key: "chat", display_name: "Chats", percent: 7 }] }),
    ).toEqual([
      { key: "claude_code", label: "Claude Code", percent: 86 },
      { key: "chat", label: "Chats", percent: 7 },
    ])
  })

  test("clamps percent", () => {
    expect(parse({ rows: [{ key: "a", display_name: "A", percent: 150 }, { key: "b", display_name: "B", percent: -3 }] }).map((r) => r.percent)).toEqual([100, 0])
  })

  test("skips malformed rows", () => {
    expect(
      parse({ rows: [null, "x", 1, {}, { key: "a", display_name: "A" }, { key: 1, display_name: "A", percent: 1 }, { key: "a", percent: 1 }, { key: "ok", display_name: "Ok", percent: 5 }] }),
    ).toEqual([{ key: "ok", label: "Ok", percent: 5 }])
  })

  test.each([["undefined", undefined], ["null", null], ["string", "x"], ["no rows", {}], ["rows not array", { rows: {} }]])(
    "[] when breakdown is %s",
    (_n, v) => expect(parse(v)).toEqual([]),
  )

  test("[] when key absent", () => {
    expect(parseUsageResponse({}, NOW).breakdown).toEqual([])
  })

  test("fixture breakdown parses", () => {
    expect(parse({ rows: [{ key: "opus", display_name: "Opus", percent: 84 }] })).toHaveLength(1)
  })
})
