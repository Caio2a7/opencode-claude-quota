import type { Plugin } from "@opencode/plugin/tui"
import type { Poller } from "./poller"

/** Forces a refresh and reports the outcome as a toast. */
export function createRefreshCommand(poller: Poller, toast: Plugin.Context["ui"]["toast"]): () => Promise<void> {
  return async () => {
    const ran = await poller.refresh()
    const { error } = poller.getState()
    if (error) toast.show({ message: error.message, variant: "error" })
    else if (ran) toast.show({ message: "Claude quota refreshed", variant: "success" })
    else toast.show({ message: "Claude quota is already fresh", variant: "info" })
  }
}
