import type { StoreFs } from "../../src/shared-fs"

const enoent = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })

/** In-memory StoreFs that records how files were written, with switches to simulate failures. */
export function createMemFs(now: () => number) {
  const files = new Map<string, { data: string; mtime: number }>()
  const writes: string[] = []
  const renames: Array<[string, string]> = []
  const fail = { write: false, mkdir: false }
  const fs: StoreFs = {
    readText(path) {
      const file = files.get(path)
      if (!file) throw enoent(path)
      return file.data
    },
    writeText(path, data) {
      if (fail.write) throw new Error("EACCES")
      writes.push(path)
      files.set(path, { data, mtime: now() })
    },
    rename(from, to) {
      const file = files.get(from)
      if (!file) throw enoent(from)
      files.delete(from)
      files.set(to, file)
      renames.push([from, to])
    },
    mkdirp() {
      if (fail.mkdir) throw new Error("EACCES")
    },
    createExclusive(path, data) {
      if (files.has(path)) return false
      files.set(path, { data, mtime: now() })
      return true
    },
    mtimeMs: (path) => files.get(path)?.mtime ?? null,
    remove: (path) => void files.delete(path),
  }
  return { fs, files, writes, renames, fail }
}
