import type { BreakdownRow, ExtraUsage, UsageSnapshot, UsageWindow, WindowId } from "./types"

export class UsageParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageParseError"
  }
}

const WINDOWS: ReadonlyArray<readonly [WindowId, string]> = [
  ["five_hour", "5h"],
  ["seven_day", "Week"],
  ["seven_day_opus", "Opus"],
  ["seven_day_sonnet", "Sonnet"],
]

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

const clamp = (n: number): number => Math.min(100, Math.max(0, n))
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseWindows(raw: Obj): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const [id, label] of WINDOWS) {
    const w = raw[id]
    if (!isObj(w)) continue
    const utilization = num(w.utilization)
    if (utilization === null) continue
    out.push({ id, label, utilization: clamp(utilization), resetsAt: parseDate(w.resets_at) })
  }
  return out
}

function decimalPlaces(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null
}

function parseExtra(v: unknown): ExtraUsage | null {
  if (!isObj(v)) return null
  return {
    enabled: v.is_enabled === true,
    usedCredits: num(v.used_credits),
    monthlyLimit: num(v.monthly_limit),
    currency: str(v.currency),
    decimalPlaces: decimalPlaces(v.decimal_places),
  }
}

function parseBreakdown(v: unknown): BreakdownRow[] {
  if (!isObj(v) || !Array.isArray(v.rows)) return []
  const out: BreakdownRow[] = []
  for (const row of v.rows as unknown[]) {
    if (!isObj(row)) continue
    const key = str(row.key)
    const label = str(row.display_name)
    const percent = num(row.percent)
    if (key === null || label === null || percent === null) continue
    out.push({ key, label, percent: clamp(percent) })
  }
  return out
}

export function parseUsageResponse(raw: unknown, now: Date): UsageSnapshot {
  if (!isObj(raw)) throw new UsageParseError("Usage response is not a JSON object")
  return {
    windows: parseWindows(raw),
    extraUsage: parseExtra(raw.extra_usage),
    breakdown: parseBreakdown(raw.seven_day_breakdown),
    fetchedAt: now,
  }
}
