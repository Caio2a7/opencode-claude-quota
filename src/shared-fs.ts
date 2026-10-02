import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

/** Synchronous file primitives behind the shared store; injectable so tests run against memory. */
export interface StoreFs {
  readText(path: string): string
  writeText(path: string, data: string): void
  rename(from: string, to: string): void
  mkdirp(dir: string): void
  /** Creates the file only if absent. Returns `false` when it already exists. */
  createExclusive(path: string, data: string): boolean
  /** Modification time in ms, or `null` when the file does not exist. */
  mtimeMs(path: string): number | null
  remove(path: string): void
}

const hasCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === code

export const nodeFs: StoreFs = {
  readText: (path) => readFileSync(path, "utf8"),
  writeText: (path, data) => writeFileSync(path, data, { mode: 0o600 }),
  rename: renameSync,
  mkdirp: (dir) => void mkdirSync(dir, { recursive: true, mode: 0o700 }),
  createExclusive(path, data) {
    try {
      writeFileSync(path, data, { flag: "wx", mode: 0o600 })
      return true
    } catch (error) {
      if (hasCode(error, "EEXIST")) return false
      throw error
    }
  },
  mtimeMs(path) {
    try {
      return statSync(path).mtimeMs
    } catch (error) {
      if (hasCode(error, "ENOENT")) return null
      throw error
    }
  },
  remove(path) {
    try {
      unlinkSync(path)
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error
    }
  },
}

/** `$XDG_CACHE_HOME/opencode-claude-quota` (absolute paths only, per the XDG spec) or `~/.cache/opencode-claude-quota`. */
export function defaultCacheDir(env: Readonly<Record<string, string | undefined>>, home: string): string {
  const xdg = env.XDG_CACHE_HOME?.trim()
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".cache"), "opencode-claude-quota")
}
