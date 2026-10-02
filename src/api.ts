import { parseUsageResponse } from "./parse"
import type { FetchResult } from "./types"
import { VERSION } from "./version"

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_MS = 60_000
const MAX_RETRY_MS = 60 * 60_000

export interface FetchOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header.trim())
  return header !== null && header.trim() !== "" && Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_MS)
    : DEFAULT_RETRY_MS
}

function failure(kind: "network" | "unauthorized" | "rate_limited" | "http" | "parse", message: string, retryMs?: number): FetchResult {
  return retryMs === undefined ? { ok: false, kind, message } : { ok: false, kind, message, retryAfterMs: retryMs }
}

function statusFailure(res: Response): FetchResult {
  if (res.status === 401 || res.status === 403) {
    return failure("unauthorized", `Claude rejected the token (HTTP ${res.status}) — run \`claude\` to log in again`)
  }
  if (res.status === 429) {
    return failure("rate_limited", "Claude usage endpoint rate limited (HTTP 429)", retryAfterMs(res.headers.get("retry-after")))
  }
  return failure("http", `Claude usage endpoint returned HTTP ${res.status}`)
}

async function request(token: string, opts: FetchOptions): Promise<Response | string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const res = await (opts.fetch ?? fetch)(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
        "User-Agent": `opencode-claude-quota/${VERSION}`,
      },
      signal: controller.signal,
    })
    return res.ok ? await res.text() : res
  } finally {
    clearTimeout(timer)
  }
}

function networkFailure(err: unknown): FetchResult {
  const reason = err instanceof Error && err.name === "AbortError" ? "request timed out" : "request failed"
  return failure("network", `Network error: ${reason}`)
}

/** Never throws. The timeout stays armed until the response body has been fully read. */
export async function fetchUsage(token: string, opts: FetchOptions = {}): Promise<FetchResult> {
  let outcome: Response | string
  try {
    outcome = await request(token, opts)
  } catch (err) {
    return networkFailure(err)
  }
  if (typeof outcome !== "string") return statusFailure(outcome)
  try {
    const raw: unknown = JSON.parse(outcome)
    return { ok: true, snapshot: parseUsageResponse(raw, (opts.now ?? (() => new Date()))()) }
  } catch {
    return failure("parse", "Unexpected response from the Claude usage endpoint")
  }
}
