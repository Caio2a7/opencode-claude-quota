import { describe, test, expect } from "bun:test"
import { join } from "node:path"
import { resolveAccessToken } from "../src/credentials"

const NOW = new Date("2026-10-02T18:30:00Z")
const HOME = "/home/test"
const SECRET = "sk-ant-oat01-SUPERSECRET"

function harness(files: Record<string, string>) {
  const calls: string[] = []
  const readFile = async (p: string) => {
    calls.push(p)
    if (!(p in files)) throw new Error("ENOENT")
    return files[p]!
  }
  return { calls, readFile }
}

const creds = (oauth: unknown) => JSON.stringify({ claudeAiOauth: oauth })
const defaultPath = join(HOME, ".claude", ".credentials.json")

describe("resolveAccessToken: env", () => {
  test("uses trimmed env token without reading files", async () => {
    const { calls, readFile } = harness({})
    const r = await resolveAccessToken({
      env: { CLAUDE_CODE_OAUTH_TOKEN: `  ${SECRET}\n` },
      homeDir: HOME,
      readFile,
      now: NOW,
    })
    expect(r).toEqual({ ok: true, token: SECRET, source: "env", expiresAt: null })
    expect(calls).toEqual([])
  })

  test.each(["", "   ", "\n\t"])("blank env %j falls through to file", async (blank) => {
    const { calls, readFile } = harness({ [defaultPath]: creds({ accessToken: SECRET }) })
    const r = await resolveAccessToken({ env: { CLAUDE_CODE_OAUTH_TOKEN: blank }, homeDir: HOME, readFile, now: NOW })
    expect(calls).toEqual([defaultPath])
    expect(r.ok && r.source).toBe("file")
  })
})

describe("resolveAccessToken: file paths", () => {
  test("default path is ~/.claude/.credentials.json", async () => {
    const { calls, readFile } = harness({ [defaultPath]: creds({ accessToken: SECRET }) })
    const r = await resolveAccessToken({ env: {}, homeDir: HOME, readFile, now: NOW })
    expect(calls).toEqual([defaultPath])
    expect(r).toEqual({ ok: true, token: SECRET, source: "file", expiresAt: null })
  })

  test("CLAUDE_CONFIG_DIR overrides home dir", async () => {
    const p = join("/custom/dir", ".credentials.json")
    const { calls, readFile } = harness({ [p]: creds({ accessToken: SECRET }) })
    const r = await resolveAccessToken({ env: { CLAUDE_CONFIG_DIR: "/custom/dir" }, homeDir: HOME, readFile, now: NOW })
    expect(calls).toEqual([p])
    expect(r.ok).toBe(true)
  })

  test("explicit credentialsPath wins over everything", async () => {
    const { calls, readFile } = harness({ "/x/creds.json": creds({ accessToken: SECRET }) })
    const r = await resolveAccessToken({
      env: { CLAUDE_CONFIG_DIR: "/custom/dir" },
      homeDir: HOME,
      readFile,
      now: NOW,
      credentialsPath: "/x/creds.json",
    })
    expect(calls).toEqual(["/x/creds.json"])
    expect(r.ok).toBe(true)
  })
})

describe("resolveAccessToken: failures", () => {
  const run = (files: Record<string, string>) =>
    resolveAccessToken({ env: {}, homeDir: HOME, readFile: harness(files).readFile, now: NOW })

  test("missing when readFile rejects", async () => {
    const r = await run({})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("missing")
  })

  test.each([
    ["invalid JSON", `{not json ${SECRET}`],
    ["empty file", ""],
    ["JSON null", "null"],
    ["no claudeAiOauth", "{}"],
    ["claudeAiOauth null", creds(null)],
    ["no accessToken", creds({ refreshToken: SECRET })],
    ["numeric accessToken", creds({ accessToken: 123 })],
    ["null accessToken", creds({ accessToken: null })],
  ])("invalid: %s", async (_n, content) => {
    const r = await run({ [defaultPath]: content })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("invalid")
      expect(r.message).not.toContain(SECRET)
    }
  })

  test("expired when expiresAt <= now (boundary inclusive)", async () => {
    for (const exp of [NOW.getTime(), NOW.getTime() - 1, 0]) {
      const r = await run({ [defaultPath]: creds({ accessToken: SECRET, expiresAt: exp }) })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.reason).toBe("expired")
        expect(r.message).not.toContain(SECRET)
      }
    }
  })

  test("not expired one ms in the future; expiresAt is a Date", async () => {
    const exp = NOW.getTime() + 1
    const r = await run({ [defaultPath]: creds({ accessToken: SECRET, expiresAt: exp }) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.expiresAt!.getTime()).toBe(exp)
  })

  test("non-numeric expiresAt is ignored (expiresAt null)", async () => {
    const r = await run({ [defaultPath]: creds({ accessToken: SECRET, expiresAt: "soon" }) })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.expiresAt).toBeNull()
  })

  test("missing-file message does not leak env token", async () => {
    const r = await resolveAccessToken({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "   " },
      homeDir: HOME,
      readFile: harness({}).readFile,
      now: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).not.toContain(SECRET)
  })
})

describe("resolveAccessToken: keychain and config dir", () => {
  const keychain = JSON.stringify({ claudeAiOauth: { accessToken: SECRET } })

  test("darwin falls back to the keychain only when the file is missing", async () => {
    const { readFile } = harness({})
    let queried = 0
    const readKeychain = async () => (queried++, keychain)
    const r = await resolveAccessToken({ env: {}, homeDir: HOME, readFile, now: NOW, platform: "darwin", readKeychain })
    expect(r).toEqual({ ok: true, token: SECRET, source: "keychain", expiresAt: null })
    expect(queried).toBe(1)
  })

  test("keychain is not queried when the credentials file exists", async () => {
    const { readFile } = harness({ [defaultPath]: keychain })
    let queried = 0
    const readKeychain = async () => (queried++, keychain)
    const r = await resolveAccessToken({ env: {}, homeDir: HOME, readFile, now: NOW, platform: "darwin", readKeychain })
    expect(r.ok && r.source).toBe("file")
    expect(queried).toBe(0)
  })

  test("keychain is ignored on other platforms and failures degrade to missing", async () => {
    const { readFile } = harness({})
    const readKeychain = async () => keychain
    const linux = await resolveAccessToken({ env: {}, homeDir: HOME, readFile, now: NOW, platform: "linux", readKeychain })
    expect(!linux.ok && linux.reason).toBe("missing")
    const broken = await resolveAccessToken({
      env: {},
      homeDir: HOME,
      readFile,
      now: NOW,
      platform: "darwin",
      readKeychain: () => Promise.reject(new Error("denied")),
    })
    expect(!broken.ok && broken.reason).toBe("missing")
  })

  test("empty or blank CLAUDE_CONFIG_DIR uses the default directory", async () => {
    for (const dir of ["", "  "]) {
      const { calls, readFile } = harness({})
      await resolveAccessToken({ env: { CLAUDE_CONFIG_DIR: dir }, homeDir: HOME, readFile, now: NOW })
      expect(calls).toEqual([defaultPath])
    }
  })
})
