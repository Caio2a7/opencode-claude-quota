import { describe, expect, test } from "bun:test"
import {
  createUserAgentResolver,
  detectClaudeVersion,
  FALLBACK_CLAUDE_CODE_VERSION,
  FALLBACK_USER_AGENT,
  parseClaudeVersion,
  type ExecFn,
} from "../src/user-agent"

const HOME = "/home/u"
const LOCAL = `${HOME}/.local/bin/claude`

describe("parseClaudeVersion", () => {
  test.each([
    ["2.1.287 (Claude Code)\n", "2.1.287"],
    ["claude 10.0.1", "10.0.1"],
    ["2.2.0-beta.1 (Claude Code)", "2.2.0-beta.1"],
    ["v3.4.5+build7", "3.4.5+build7"],
  ])("%j -> %s", (out, expected) => expect(parseClaudeVersion(out)).toBe(expected))

  test.each(["", "command not found", "1.2", "abc.def.ghi"])("%j -> null", (out) =>
    expect(parseClaudeVersion(out)).toBeNull(),
  )
})

describe("detectClaudeVersion", () => {
  test("uses `claude` on PATH with --version, no shell", async () => {
    const calls: Array<[string, readonly string[], number]> = []
    const exec: ExecFn = async (file, args, timeout) => (calls.push([file, args, timeout]), "2.5.1 (Claude Code)")
    expect(await detectClaudeVersion(exec, HOME)).toBe("2.5.1")
    expect(calls).toEqual([["claude", ["--version"], 3000]])
  })

  test("falls back to ~/.local/bin/claude when PATH has no claude", async () => {
    const exec: ExecFn = async (file) => {
      if (file === "claude") throw new Error("ENOENT")
      return "2.6.0 (Claude Code)"
    }
    expect(await detectClaudeVersion(exec, HOME)).toBe("2.6.0")
  })

  test("also tries the local binary when PATH output is unparseable", async () => {
    const seen: string[] = []
    const exec: ExecFn = async (file) => (seen.push(file), file === "claude" ? "garbage" : "2.7.3")
    expect(await detectClaudeVersion(exec, HOME)).toBe("2.7.3")
    expect(seen).toEqual(["claude", LOCAL])
  })

  test("null when neither works", async () => {
    expect(await detectClaudeVersion(() => Promise.reject(new Error("x")), HOME)).toBeNull()
  })
})

describe("createUserAgentResolver", () => {
  test("builds claude-code/<version>", async () => {
    expect(await createUserAgentResolver(async () => "2.9.9 (Claude Code)", HOME)()).toBe("claude-code/2.9.9")
  })

  test("falls back to the constant when Claude Code is unavailable or unparseable", async () => {
    expect(FALLBACK_USER_AGENT).toBe(`claude-code/${FALLBACK_CLAUDE_CODE_VERSION}`)
    expect(FALLBACK_CLAUDE_CODE_VERSION).toBe("2.1.287")
    expect(await createUserAgentResolver(() => Promise.reject(new Error("x")), HOME)()).toBe(FALLBACK_USER_AGENT)
    expect(await createUserAgentResolver(async () => "nope", HOME)()).toBe(FALLBACK_USER_AGENT)
  })

  test("never throws, even when exec throws synchronously", async () => {
    const exec: ExecFn = () => {
      throw new Error("sync")
    }
    expect(await createUserAgentResolver(exec, HOME)()).toBe(FALLBACK_USER_AGENT)
  })

  test("is memoized: one detection per process", async () => {
    let calls = 0
    const resolve = createUserAgentResolver(async () => (calls++, "2.1.0"), HOME)
    const [a, b] = await Promise.all([resolve(), resolve()])
    await resolve()
    expect([a, b]).toEqual(["claude-code/2.1.0", "claude-code/2.1.0"])
    expect(calls).toBe(1)
  })
})
