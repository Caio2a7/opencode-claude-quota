import type { Severity } from "./types"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatDuration(ms: number): string {
  if (!(ms > 0)) return "now"
  if (ms >= DAY) {
    const days = Math.floor(ms / DAY)
    return `${days}d ${Math.floor((ms % DAY) / HOUR)}h`
  }
  if (ms >= HOUR) {
    const hours = Math.floor(ms / HOUR)
    return `${hours}h ${Math.floor((ms % HOUR) / MINUTE)}m`
  }
  return `${Math.max(1, Math.floor(ms / MINUTE))}m`
}

export function formatAge(ms: number): string {
  if (ms < 10 * SECOND) return "just now"
  if (ms < MINUTE) return `${Math.floor(ms / SECOND)}s ago`
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  return `${Math.floor(ms / HOUR)}h ago`
}

export function severity(pct: number): Severity {
  if (pct >= 100) return "critical"
  if (pct >= 75) return "high"
  if (pct >= 50) return "warn"
  return "ok"
}

export function renderBar(pct: number, width: number): { filled: string; empty: string } {
  if (!(width > 0)) return { filled: "", empty: "" }
  const safe = Number.isNaN(pct) ? 0 : Math.min(100, Math.max(0, pct))
  const cells = Math.round((safe / 100) * width)
  return { filled: "━".repeat(cells), empty: "─".repeat(width - cells) }
}
