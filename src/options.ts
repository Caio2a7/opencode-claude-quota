import { clampInterval } from "./poller"

export interface QuotaOptions {
  refreshIntervalMs: number
  showBreakdown: boolean
  showModels: boolean
  credentialsPath: string | undefined
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/** Validates untrusted plugin options; invalid values fall back to defaults. */
export function parseOptions(raw: Readonly<Record<string, unknown>> | undefined): QuotaOptions {
  const input = raw ?? {}
  const seconds = typeof input.refreshInterval === "number" ? input.refreshInterval * 1000 : undefined
  const path = typeof input.credentialsPath === "string" ? input.credentialsPath.trim() : ""
  return {
    refreshIntervalMs: clampInterval(seconds),
    showBreakdown: bool(input.showBreakdown, true),
    showModels: bool(input.showModels, true),
    credentialsPath: path === "" ? undefined : path,
  }
}
