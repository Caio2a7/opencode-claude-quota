import { formatDuration, renderBar, severity } from "./format"
import type { PollerState } from "./poller"
import type { ExtraUsage, Severity, UsageWindow } from "./types"
import type { QuotaOptions } from "./options"

export type Tone = "text" | "muted" | "success" | "warning" | "error"

export type Row =
  | { kind: "bar"; label: string; filled: string; empty: string; percent: string; tone: Tone }
  | { kind: "text"; text: string; tone: Tone }

export const BAR_WIDTH = 14
const LABEL_WIDTH = 7
const PRIMARY = new Set(["five_hour", "seven_day"])

const SEVERITY_TONE: Record<Severity, Tone> = {
  ok: "success",
  warn: "warning",
  high: "error",
  critical: "error",
}

const indent = " ".repeat(LABEL_WIDTH)

function windowRows(w: UsageWindow, now: Date): Row[] {
  const pct = Math.round(w.utilization)
  const bar = renderBar(w.utilization, BAR_WIDTH)
  const rows: Row[] = [
    {
      kind: "bar",
      label: w.label.padEnd(LABEL_WIDTH),
      ...bar,
      percent: `${String(pct).padStart(4)}%`,
      tone: SEVERITY_TONE[severity(w.utilization)],
    },
  ]
  if (w.resetsAt) {
    const left = w.resetsAt.getTime() - now.getTime()
    rows.push({ kind: "text", text: `${indent}resets in ${formatDuration(left)}`, tone: "muted" })
  }
  return rows
}

function formatMoney(amount: number, currency: string | null, decimalPlaces: number | null): string {
  const major = decimalPlaces === null ? amount : amount / 10 ** decimalPlaces
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency ?? "USD" }).format(major)
  } catch {
    return `${major.toFixed(2)} ${currency ?? ""}`.trim()
  }
}

function extraRow(extra: ExtraUsage | null): Row[] {
  if (!extra?.enabled) return []
  const { currency, decimalPlaces } = extra
  const used = formatMoney(extra.usedCredits ?? 0, currency, decimalPlaces)
  const limit = extra.monthlyLimit === null ? "" : ` / ${formatMoney(extra.monthlyLimit, currency, decimalPlaces)}`
  return [{ kind: "text", text: `Extra  ${used}${limit}`, tone: "text" }]
}

function errorRows(state: PollerState, now: Date): Row[] {
  const { error, snapshot } = state
  if (!error) return []
  if (error.kind === "rate_limited") {
    const retry = error.retryAt ? ` · retry in ${formatDuration(error.retryAt.getTime() - now.getTime())}` : ""
    return [{ kind: "text", text: `rate limited${retry}`, tone: "muted" }]
  }
  return [{ kind: "text", text: `${error.message}${snapshot ? " (stale)" : ""}`, tone: "muted" }]
}

/** Pure view-model: everything the sidebar shows, independent of the renderer. */
export function buildRows(state: PollerState, now: Date, options: QuotaOptions): Row[] {
  const rows: Row[] = []
  const snap = state.snapshot
  if (snap) {
    const windows = snap.windows.filter((w) => PRIMARY.has(w.id) || options.showModels)
    for (const w of windows) rows.push(...windowRows(w, now))
    rows.push(...extraRow(snap.extraUsage))
  } else if (state.loading) {
    rows.push({ kind: "text", text: "Loading…", tone: "muted" })
  }
  rows.push(...errorRows(state, now))
  return rows
}
