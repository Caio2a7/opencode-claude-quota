import { fetchUsage } from "./api"
import { defaultCredentialDeps, resolveAccessToken } from "./credentials"
import type { LoadResult } from "./poller"

/** Builds the poller's loader: read-only credential lookup, then a single usage request. */
export function createLoader(credentialsPath: string | undefined): () => Promise<LoadResult> {
  return async () => {
    try {
      const deps = { ...defaultCredentialDeps(), now: new Date(), credentialsPath }
      const token = await resolveAccessToken(deps)
      if (!token.ok) return { ok: false, kind: "credentials", message: token.message }
      return await fetchUsage(token.token)
    } catch {
      // Raw runtime text can embed paths or token fragments, so only a fixed message is surfaced.
      return { ok: false, kind: "internal", message: "Unexpected error loading Claude usage" }
    }
  }
}
