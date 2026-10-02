import { join } from "node:path"
import { isFiniteNumber, isObject, reviveSnapshot } from "./snapshot-codec"
import type { StoreFs } from "./shared-fs"
import type { FetchErrorKind, UsageSnapshot } from "./types"

export const STATE_VERSION = 1
export const LOCK_STALE_MS = 30_000

const ERROR_KINDS: readonly string[] = ["network", "unauthorized", "rate_limited", "http", "parse"]

export interface SharedError {
  kind: FetchErrorKind
  message: string
}

/** Everything instances share through the cache file. Never contains credentials. */
export interface SharedState {
  version: typeof STATE_VERSION
  snapshot: UsageSnapshot | null
  /** Epoch ms of the request that produced `snapshot`. */
  fetchedAt: number | null
  /** Epoch ms before which no instance may call the endpoint. */
  blockedUntil: number
  consecutiveFailures: number
  lastError: SharedError | null
}

export interface SharedStore {
  /** Never throws: a missing or corrupt file reads as an empty state. */
  read(): SharedState
  /** Atomic (temp file + rename). Returns `false` when the cache directory is unusable. */
  write(state: SharedState): boolean
  /** Returns a release function, or `null` while another instance holds a non-stale lock. */
  tryLock(): (() => void) | null
}

export interface SharedStoreOptions {
  dir: string
  fs: StoreFs
  now: () => number
}

export function emptyState(): SharedState {
  return { version: STATE_VERSION, snapshot: null, fetchedAt: null, blockedUntil: 0, consecutiveFailures: 0, lastError: null }
}

function reviveError(value: unknown): SharedError | null {
  if (!isObject(value) || typeof value.message !== "string") return null
  const kind = value.kind
  return typeof kind === "string" && ERROR_KINDS.includes(kind) ? { kind: kind as FetchErrorKind, message: value.message } : null
}

function reviveState(raw: unknown): SharedState {
  if (!isObject(raw) || raw.version !== STATE_VERSION) return emptyState()
  const snapshot = reviveSnapshot(raw.snapshot)
  const failures = raw.consecutiveFailures
  return {
    version: STATE_VERSION,
    snapshot,
    fetchedAt: snapshot && isFiniteNumber(raw.fetchedAt) ? raw.fetchedAt : null,
    blockedUntil: isFiniteNumber(raw.blockedUntil) ? raw.blockedUntil : 0,
    consecutiveFailures: isFiniteNumber(failures) && failures > 0 ? Math.floor(failures) : 0,
    lastError: reviveError(raw.lastError),
  }
}

export function createSharedStore({ dir, fs, now }: SharedStoreOptions): SharedStore {
  const statePath = join(dir, "state.json")
  const lockPath = join(dir, "fetch.lock")

  const acquire = (): boolean => fs.createExclusive(lockPath, String(now()))

  /** A lock whose owner died is removed; returns whether acquiring again is worth a try. */
  const clearStale = (): boolean => {
    const modified = fs.mtimeMs(lockPath)
    if (modified !== null && now() - modified <= LOCK_STALE_MS) return false
    fs.remove(lockPath)
    return true
  }

  return {
    read() {
      try {
        return reviveState(JSON.parse(fs.readText(statePath)))
      } catch {
        return emptyState()
      }
    },
    write(state) {
      const tmp = `${statePath}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`
      try {
        fs.mkdirp(dir)
        fs.writeText(tmp, JSON.stringify(state))
        fs.rename(tmp, statePath)
        return true
      } catch {
        try {
          fs.remove(tmp)
        } catch {
          // The cache is best effort; a leftover temp file is harmless.
        }
        return false
      }
    },
    tryLock() {
      try {
        fs.mkdirp(dir)
        if (!acquire() && !(clearStale() && acquire())) return null
        return () => {
          try {
            fs.remove(lockPath)
          } catch {
            // An unremovable lock simply expires after LOCK_STALE_MS.
          }
        }
      } catch {
        // Unusable cache directory: fetch uncoordinated rather than never.
        return () => {}
      }
    },
  }
}
