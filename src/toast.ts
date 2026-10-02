import type { Plugin } from "@opencode/plugin/tui"
import { formatDuration } from "./format"
import type { Poller } from "./poller"

/** Forces a refresh and reports the outcome as a toast. */
export function createRefreshCommand(poller: Poller, toast: Plugin.Context["ui"]["toast"]): () => Promise<void> {
  return async () => {
    const ran = await poller.refresh()
    const { error } = poller.getState()
    if (error?.kind === "rate_limited") {
      const wait = error.retryAt ? ` — retrying in ${formatDuration(error.retryAt.getTime() - Date.now())}` : ""
      toast.show({ message: `Rate limited by Anthropic${wait}`, variant: "warning" })
    } else if (error) toast.show({ message: error.message, variant: "error" })
    else if (ran) toast.show({ message: "Claude quota refreshed", variant: "success" })
    else toast.show({ message: "Claude quota is already fresh", variant: "info" })
  }
}
