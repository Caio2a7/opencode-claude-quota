import type { FetchResult, UsageSnapshot } from "./types"

export const DEFAULT_INTERVAL_MS = 120_000
export const MIN_INTERVAL_MS = 60_000
/** A post-turn refresh only fetches when the shared snapshot is older than this. */
export const POST_TURN_MAX_AGE_MS = 60_000
/** A manual refresh only fetches when the shared snapshot is older than this. */
export const MANUAL_MAX_AGE_MS = 30_000
const MIN_DELAY_MS = 1_000

export type PollerErrorKind = "credentials" | "internal" | "network" | "unauthorized" | "rate_limited" | "http" | "parse"

export interface PollerError {
  kind: PollerErrorKind
  message: string
  /** When the next request may happen, if the failure is a known block (rate limit, backoff). */
  retryAt: Date | null
}

export interface PollerState {
  snapshot: UsageSnapshot | null
  error: PollerError | null
  lastAttemptAt: Date | null
  loading: boolean
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface LoadRequest {
  /** Cached data younger than this must be reused instead of fetching. */
  maxAgeMs: number
}

type LoadFailure = { ok: false; kind: "credentials" | "internal"; message: string; retryAfterMs?: number }

/**
 * `snapshot` on a failure carries the last known data; `nextInMs` overrides the polling delay;
 * `retryAfterMs` on a failure is how long requests are blocked.
 */
export type LoadResult = (FetchResult | LoadFailure) & { snapshot?: UsageSnapshot; nextInMs?: number }

export interface PollerOptions {
  /** Resolves data (cache or network). Must not throw; failures are returned as `ok: false`. */
  load: (request: LoadRequest) => Promise<LoadResult>
  intervalMs?: number
  /** Snapshot to show immediately, before the first load completes. */
  initial?: UsageSnapshot | null
  now?: () => Date
  timers?: Timers
}

export interface Poller {
  start(): void
  stop(): void
  /** Asks the loader for fresh data unless one load is already running. Resolves `false` when it was skipped. */
  refresh(maxAgeMs?: number): Promise<boolean>
  getState(): PollerState
  subscribe(listener: (state: PollerState) => void): () => void
}

export function clampInterval(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return DEFAULT_INTERVAL_MS
  return Math.max(MIN_INTERVAL_MS, Math.floor(ms))
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createPoller(options: PollerOptions): Poller {
  return new PollerImpl(options)
}

class PollerImpl implements Poller {
  private readonly intervalMs: number
  private readonly now: () => Date
  private readonly timers: Timers
  private readonly listeners = new Set<(state: PollerState) => void>()
  private state: PollerState
  private handle: unknown = null
  private running = false
  private stopped = false
  private inFlight: Promise<void> | null = null

  constructor(private readonly options: PollerOptions) {
    this.intervalMs = clampInterval(options.intervalMs)
    this.now = options.now ?? (() => new Date())
    this.timers = options.timers ?? realTimers
    this.state = { snapshot: options.initial ?? null, error: null, lastAttemptAt: null, loading: false }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.stopped = false
    void this.run(this.intervalMs)
  }

  stop(): void {
    this.running = false
    this.stopped = true
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = null
    this.listeners.clear()
  }

  async refresh(maxAgeMs = MANUAL_MAX_AGE_MS): Promise<boolean> {
    if (this.inFlight) return false
    await this.run(maxAgeMs)
    return true
  }

  getState(): PollerState {
    return this.state
  }

  subscribe(listener: (state: PollerState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<PollerState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  private schedule(delay: number): void {
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = this.running ? this.timers.set(() => void this.run(this.intervalMs), delay) : null
  }

  private run(maxAgeMs: number): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.attempt(maxAgeMs).finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private async attempt(maxAgeMs: number): Promise<void> {
    this.setState({ loading: true, lastAttemptAt: this.now() })
    const result = await this.options.load({ maxAgeMs })
    if (this.stopped) return
    const retryAfter = result.ok ? undefined : result.retryAfterMs
    const retryAt = retryAfter === undefined ? null : new Date(this.now().getTime() + retryAfter)
    const error = result.ok ? null : { kind: result.kind, message: result.message, retryAt }
    this.setState({ snapshot: result.snapshot ?? this.state.snapshot, error, loading: false })
    this.schedule(Math.max(MIN_DELAY_MS, result.nextInMs ?? this.intervalMs))
  }
}
