import type { BreakdownRow, ExtraUsage, UsageSnapshot, UsageWindow, WindowId } from "./types"

const WINDOW_IDS: readonly string[] = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"]

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isWindowId = (value: unknown): value is WindowId => typeof value === "string" && WINDOW_IDS.includes(value)

/** `undefined` marks an invalid value, `null` a legitimately absent one. */
function dateOrNull(value: unknown): Date | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const numberOrNull = (value: unknown): number | null | undefined =>
  value === null ? null : isFiniteNumber(value) ? value : undefined
const stringOrNull = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined

function reviveWindow(value: unknown): UsageWindow | null {
  if (!isObject(value) || !isWindowId(value.id) || typeof value.label !== "string") return null
  const resetsAt = dateOrNull(value.resetsAt)
  if (!isFiniteNumber(value.utilization) || resetsAt === undefined) return null
  return { id: value.id, label: value.label, utilization: value.utilization, resetsAt }
}

function reviveBreakdownRow(value: unknown): BreakdownRow | null {
  if (!isObject(value) || typeof value.key !== "string" || typeof value.label !== "string") return null
  return isFiniteNumber(value.percent) ? { key: value.key, label: value.label, percent: value.percent } : null
}

function reviveExtra(value: unknown): ExtraUsage | null | undefined {
  if (value === null) return null
  if (!isObject(value) || typeof value.enabled !== "boolean") return undefined
  const usedCredits = numberOrNull(value.usedCredits)
  const monthlyLimit = numberOrNull(value.monthlyLimit)
  const currency = stringOrNull(value.currency)
  const decimalPlaces = numberOrNull(value.decimalPlaces)
  if (usedCredits === undefined || monthlyLimit === undefined || currency === undefined || decimalPlaces === undefined) {
    return undefined
  }
  return { enabled: value.enabled, usedCredits, monthlyLimit, currency, decimalPlaces }
}

function reviveList<T>(value: unknown, revive: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const items = value.map(revive)
  return items.every((item): item is Exclude<T, null> => item !== null) ? (items as T[]) : null
}

/** Rebuilds a snapshot from untrusted JSON (dates as ISO strings); `null` when any part is malformed. */
export function reviveSnapshot(value: unknown): UsageSnapshot | null {
  if (!isObject(value)) return null
  const windows = reviveList(value.windows, reviveWindow)
  const breakdown = reviveList(value.breakdown, reviveBreakdownRow)
  const extraUsage = reviveExtra(value.extraUsage)
  const fetchedAt = dateOrNull(value.fetchedAt)
  if (!windows || !breakdown || extraUsage === undefined || !fetchedAt) return null
  return { windows, extraUsage, breakdown, fetchedAt }
}
