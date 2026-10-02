import { execFile } from "node:child_process"
import { readFile as fsReadFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { TokenResult, TokenSource } from "./types"

export interface CredentialDeps {
  env: Record<string, string | undefined>
  homeDir: string
  readFile: (path: string) => Promise<string>
  now: Date
  credentialsPath?: string
  platform?: NodeJS.Platform
  readKeychain?: () => Promise<string | null>
}

const MISSING = "Claude Code credentials not found — run `claude` and log in"
const INVALID = "Claude Code credentials are unreadable or malformed — run `claude` to log in again"
const EXPIRED = "Claude Code token expired — run `claude` once to refresh it"

export function readMacKeychain(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { timeout: 5000 },
      (err, stdout) => resolve(err ? null : stdout),
    )
  })
}

export function defaultCredentialDeps(): CredentialDeps {
  return {
    env: process.env,
    homeDir: homedir(),
    readFile: (p) => fsReadFile(p, "utf8"),
    now: new Date(),
    platform: process.platform,
    readKeychain: readMacKeychain,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function interpret(content: string, source: TokenSource, now: Date): TokenResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, reason: "invalid", message: INVALID }
  }
  const oauth = isObject(parsed) ? parsed.claudeAiOauth : undefined
  if (!isObject(oauth) || typeof oauth.accessToken !== "string" || oauth.accessToken.trim() === "") {
    return { ok: false, reason: "invalid", message: INVALID }
  }
  const { accessToken, expiresAt } = oauth
  const expiry = typeof expiresAt === "number" && Number.isFinite(expiresAt) ? new Date(expiresAt) : null
  if (expiry !== null && expiry.getTime() <= now.getTime()) return { ok: false, reason: "expired", message: EXPIRED }
  return { ok: true, token: accessToken, source, expiresAt: expiry }
}

async function tryRead(deps: CredentialDeps, path: string): Promise<string | null> {
  try {
    return await deps.readFile(path)
  } catch {
    return null
  }
}

function candidatePath(deps: CredentialDeps): string {
  if (deps.credentialsPath) return deps.credentialsPath
  const dir = deps.env.CLAUDE_CONFIG_DIR?.trim()
  return join(dir ? dir : join(deps.homeDir, ".claude"), ".credentials.json")
}

export async function resolveAccessToken(deps: CredentialDeps): Promise<TokenResult> {
  const envToken = deps.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()
  if (envToken) return { ok: true, token: envToken, source: "env", expiresAt: null }

  const file = await tryRead(deps, candidatePath(deps))
  if (file !== null) return interpret(file, "file", deps.now)

  if (deps.platform === "darwin" && deps.readKeychain) {
    const stored = await deps.readKeychain().catch(() => null)
    if (stored) return interpret(stored, "keychain", deps.now)
  }
  return { ok: false, reason: "missing", message: MISSING }
}
