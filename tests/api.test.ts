import { describe, test, expect } from "bun:test"
import { fetchUsage, USAGE_URL } from "../src/api"
import fixture from "./fixtures/usage.json"

const TOKEN = "sk-ant-oat01-SUPERSECRET"
const NOW = new Date("2026-10-02T18:30:00Z")
type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

const run = (fetch: FetchFn, timeoutMs = 1000) =>
  fetchUsage(TOKEN, { fetch: fetch as never, timeoutMs, now: () => NOW } as never)

const respond = (status: number, body = "", headers: Record<string, string> = {}): FetchFn => async () =>
  new Response(body, { status, headers })

describe("USAGE_URL and request shape", () => {
  test("url constant", () => {
    expect(USAGE_URL).toBe("https://api.anthropic.com/api/oauth/usage")
  })

  test("calls fetch with url, auth headers and an AbortSignal", async () => {
    let seen: { url: unknown; init?: RequestInit } | undefined
    await run(async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify(fixture), { status: 200 })
    })
    expect(String(seen!.url)).toBe(USAGE_URL)
    const h = new Headers(seen!.init!.headers)
    expect(h.get("authorization")).toBe(`Bearer ${TOKEN}`)
    expect(h.get("anthropic-beta")).toBe("oauth-2025-04-20")
    expect(seen!.init!.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("fetchUsage: success", () => {
  test("200 valid returns snapshot with fetchedAt from now()", async () => {
    const r = await run(respond(200, JSON.stringify(fixture)))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot.windows.map((w) => w.utilization)).toEqual([42, 6])
      expect(r.snapshot.fetchedAt).toEqual(NOW)
    }
  })
})

describe("fetchUsage: failures", () => {
  const kindOf = async (f: FetchFn) => {
    const r = await run(f)
    expect(r.ok).toBe(false)
    return r as Extract<Awaited<ReturnType<typeof run>>, { ok: false }>
  }

  test("fetch rejection -> network, never throws, no token leak", async () => {
    const r = await kindOf(async () => {
      throw new Error("connect ECONNREFUSED")
    })
    expect(r.kind).toBe("network")
    expect(r.message).not.toContain(TOKEN)
  })

  test("fetch rejecting with a non-Error -> network", async () => {
    const r = await kindOf(() => Promise.reject("boom"))
    expect(r.kind).toBe("network")
  })

  test("timeout aborts and maps to network", async () => {
    const hang: FetchFn = (_u, init) =>
      new Promise((_res, rej) => {
        init!.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))
      })
    const start = Date.now()
    const r = await kindOf(hang)
    expect(r.kind).toBe("network")
    expect(Date.now() - start).toBeLessThan(2000)
  })

  test.each([401, 403])("%d -> unauthorized", async (status) => {
    const r = await kindOf(respond(status, "denied"))
    expect(r.kind).toBe("unauthorized")
    expect(r.message).not.toContain(TOKEN)
  })

  test.each([
    ["30", 30_000],
    ["1", 1_000],
    [undefined, undefined],
    ["abc", undefined],
    ["0", undefined],
    ["-5", undefined],
    ["", undefined],
  ])("429 retry-after %p -> %p ms", async (header, expected) => {
    const headers: Record<string, string> = header === undefined ? {} : { "retry-after": header }
    const r = await kindOf(respond(429, "slow down", headers))
    expect(r.kind).toBe("rate_limited")
    expect(r.retryAfterMs).toBe(expected)
  })

  test("500 -> http with status in message", async () => {
    const r = await kindOf(respond(500, "oops"))
    expect(r.kind).toBe("http")
    expect(r.message).toContain("500")
    expect(r.message).not.toContain(TOKEN)
  })

  test.each(["not json {", "", "[1,2]", "null", "42", '"str"'])("200 body %j -> parse", async (body) => {
    const r = await kindOf(respond(200, body))
    expect(r.kind).toBe("parse")
    expect(r.message).not.toContain(TOKEN)
  })
})

describe("hardening", () => {
  test("caps Retry-After at one hour", async () => {
    const r = await run(respond(429, "", { "retry-after": "999999" }))
    expect(r.ok === false && r.retryAfterMs).toBe(3_600_000)
  })

  test("parse failure message is fixed text without a body excerpt", async () => {
    const r = await run(respond(200, "secret-looking {{ body"))
    expect(r.ok === false && r.message).toBe("Unexpected response from the Claude usage endpoint")
  })

  test("timeout stays armed while the body is being read", async () => {
    const stalled: FetchFn = async (_u, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init!.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")))
        },
      })
      return new Response(body, { status: 200 })
    }
    const r = await run(stalled, 50)
    expect(r.ok === false && r.kind).toBe("network")
  })
})

describe("user agent", () => {
  const capture = () => {
    const seen: string[] = []
    const fetch: FetchFn = async (_u, init) => {
      seen.push(new Headers(init!.headers).get("user-agent") ?? "")
      return new Response("{}", { status: 200 })
    }
    return { seen, fetch }
  }

  test("sends the given user agent", async () => {
    const { seen, fetch } = capture()
    await fetchUsage(TOKEN, { fetch: fetch as never, now: () => NOW, userAgent: "claude-code/9.9.9" })
    expect(seen).toEqual(["claude-code/9.9.9"])
  })

  test("defaults to the Claude Code fallback agent", async () => {
    const { seen, fetch } = capture()
    await fetchUsage(TOKEN, { fetch: fetch as never, now: () => NOW })
    expect(seen).toEqual(["claude-code/2.1.287"])
  })

  test("retry-after: 0 counts as absent so the persisted backoff applies", async () => {
    const r = await run(respond(429, "", { "retry-after": "0" }))
    expect(r.ok === false && r.kind === "rate_limited" && r.retryAfterMs).toBeUndefined()
  })
})
