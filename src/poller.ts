import type { FetchResult, UsageSnapshot } from "./types"

export const DEFAULT_INTERVAL_MS = 60_000
export const MIN_INTERVAL_MS = 30_000
export const MAX_BACKOFF_MS = 10 * 60_000

/** Failures retried with capped exponential backoff. Missing credentials and internal errors keep the plain interval. */
const BACKOFF_KINDS: ReadonlySet<string> = new Set(["network", "http", "unauthorized"])
/** Failures that also block manual/event refreshes until the backoff elapses. */
const BLOCKING_KINDS: ReadonlySet<string> = new Set(["network", "http", "rate_limited"])

export type PollerErrorKind = "credentials" | "internal" | "network" | "unauthorized" | "rate_limited" | "http" | "parse"

export interface PollerError {
  kind: PollerErrorKind
  message: string
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

export type LoadResult = FetchResult | { ok: false; kind: "credentials" | "internal"; message: string; retryAfterMs?: undefined }

export interface PollerOptions {
  /** Resolves credentials and fetches usage. Must not throw; failures are returned as `ok: false`. */
  load: () => Promise<LoadResult>
  intervalMs?: number
  now?: () => Date
  timers?: Timers
}

export interface Poller {
  start(): void
  stop(): void
  /** Forces a fetch unless one ran (or is blocked by backoff / rate limiting) within the debounce window. */
  refresh(): Promise<boolean>
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
  private state: PollerState = { snapshot: null, error: null, lastAttemptAt: null, loading: false }
  private handle: unknown = null
  private running = false
  private stopped = false
  private failures = 0
  private blockedUntil = 0
  private inFlight: Promise<void> | null = null

  constructor(private readonly options: PollerOptions) {
    this.intervalMs = clampInterval(options.intervalMs)
    this.now = options.now ?? (() => new Date())
    this.timers = options.timers ?? realTimers
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.stopped = false
    void this.run()
  }

  stop(): void {
    this.running = false
    this.stopped = true
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = null
    this.listeners.clear()
  }

  async refresh(): Promise<boolean> {
    if (this.inFlight || this.now().getTime() < this.blockedUntil) return false
    await this.run()
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

  private nextDelay(result: LoadResult): number {
    if (result.ok) return this.intervalMs
    if (result.kind === "rate_limited") return Math.max(this.intervalMs, result.retryAfterMs ?? 0)
    if (BACKOFF_KINDS.has(result.kind)) return Math.min(MAX_BACKOFF_MS, this.intervalMs * 2 ** this.failures)
    return this.intervalMs
  }

  private schedule(delay: number): void {
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = this.running ? this.timers.set(() => void this.run(), delay) : null
  }

  private run(): Promise<void> {
    if (!this.inFlight) {
      this.inFlight = this.attempt().finally(() => {
        this.inFlight = null
      })
    }
    return this.inFlight
  }

  private async attempt(): Promise<void> {
    const startedAt = this.now()
    this.setState({ loading: true, lastAttemptAt: startedAt })
    const result = await this.options.load()
    const delay = this.nextDelay(result)
    if (this.stopped) return
    this.failures = !result.ok && BACKOFF_KINDS.has(result.kind) ? this.failures + 1 : 0
    const blocking = !result.ok && BLOCKING_KINDS.has(result.kind)
    this.blockedUntil = startedAt.getTime() + (blocking ? delay : MIN_INTERVAL_MS)
    if (result.ok) this.setState({ snapshot: result.snapshot, error: null, loading: false })
    else this.setState({ error: { kind: result.kind, message: result.message }, loading: false })
    this.schedule(delay)
  }
}
