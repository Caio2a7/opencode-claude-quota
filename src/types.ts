export type WindowId = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet"
export interface UsageWindow { id: WindowId; label: string; utilization: number; resetsAt: Date | null }
export interface ExtraUsage { enabled: boolean; usedCredits: number | null; monthlyLimit: number | null; currency: string | null; decimalPlaces: number | null }
export interface BreakdownRow { key: string; label: string; percent: number }
export interface UsageSnapshot { windows: UsageWindow[]; extraUsage: ExtraUsage | null; breakdown: BreakdownRow[]; fetchedAt: Date }
export type Severity = "ok" | "warn" | "high" | "critical"
export type FetchErrorKind = "network" | "unauthorized" | "rate_limited" | "http" | "parse"
export type FetchResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; kind: FetchErrorKind; message: string; retryAfterMs?: number }
export type TokenSource = "env" | "file" | "keychain"
export type TokenResult =
  | { ok: true; token: string; source: TokenSource; expiresAt: Date | null }
  | { ok: false; reason: "missing" | "invalid" | "expired"; message: string }
