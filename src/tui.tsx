import { createSignal } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import { createLoader } from "./loader"
import { parseOptions } from "./options"
import { createPoller } from "./poller"
import { buildRows } from "./rows"
import { RefreshCommand } from "./command"
import { createRefreshCommand } from "./toast"
import { QuotaView } from "./view"

const TICK_MS = 30_000
const ID = "opencode-claude-quota"

// Plain object instead of `Plugin.define()` (an identity function): published installs then need no runtime import
// of `@opencode/plugin`, which the host does not provide to packages under node_modules.
const plugin = {
  id: ID,
  setup(context) {
    const options = parseOptions(context.options)
    const poller = createPoller({
      intervalMs: options.refreshIntervalMs,
      load: createLoader(options.credentialsPath),
    })
    const [state, setState] = createSignal(poller.getState())
    const [now, setNow] = createSignal(new Date())
    const unsubscribe = poller.subscribe((next) => setState(next))
    const ticker = setInterval(() => setNow(new Date()), TICK_MS)
    const rows = () => buildRows(state(), now(), options)

    const stopEvents = context.data.on("session.execution.succeeded", () => void poller.refresh())

    const forceRefresh = createRefreshCommand(poller, context.ui.toast)

    const removeSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => <QuotaView theme={context.theme} rows={rows} />,
    })
    const removeCommands = context.ui.slot({
      append: "app",
      render: () => <RefreshCommand keymap={context.keymap} id={ID} run={forceRefresh} />,
    })

    poller.start()
    return () => {
      removeSidebar()
      removeCommands()
      stopEvents()
      unsubscribe()
      clearInterval(ticker)
      poller.stop()
    }
  },
} satisfies Plugin.Definition

export default plugin
