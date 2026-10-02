import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

export const FALLBACK_CLAUDE_CODE_VERSION = "2.1.287"
export const FALLBACK_USER_AGENT = `claude-code/${FALLBACK_CLAUDE_CODE_VERSION}`
const EXEC_TIMEOUT_MS = 3_000
const SEMVER = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

/** Runs `file args` without a shell and resolves its stdout; rejects on failure or timeout. */
export type ExecFn = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>

const nodeExec: ExecFn = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: timeoutMs, windowsHide: true }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    )
  })

/** `2.1.287 (Claude Code)` → `2.1.287`; `null` when there is no semver-like token. */
export function parseClaudeVersion(output: string): string | null {
  return SEMVER.exec(output)?.[0] ?? null
}

async function tryVersion(exec: ExecFn, file: string): Promise<string | null> {
  try {
    return parseClaudeVersion(await exec(file, ["--version"], EXEC_TIMEOUT_MS))
  } catch {
    return null
  }
}

/** Asks `claude` on PATH first, then `~/.local/bin/claude`. */
export async function detectClaudeVersion(exec: ExecFn, home: string): Promise<string | null> {
  return (await tryVersion(exec, "claude")) ?? (await tryVersion(exec, join(home, ".local", "bin", "claude")))
}

/**
 * Resolves `claude-code/<installed version>` once and memoizes the promise. Never rejects: falls back to
 * `FALLBACK_USER_AGENT` when Claude Code is missing or prints something unparseable.
 */
export function createUserAgentResolver(exec: ExecFn = nodeExec, home: string = homedir()): () => Promise<string> {
  let cached: Promise<string> | null = null
  return () => {
    cached ??= detectClaudeVersion(exec, home).then(
      (version) => (version ? `claude-code/${version}` : FALLBACK_USER_AGENT),
      () => FALLBACK_USER_AGENT,
    )
    return cached
  }
}
