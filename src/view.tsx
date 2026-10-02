import { For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import type { Row, Tone } from "./rows"

type Theme = Plugin.Context["theme"]

function toneColor(theme: Theme, tone: Tone): RGBA {
  switch (tone) {
    case "muted":
      return theme.text.muted
    case "success":
      return theme.text.feedback.success.base
    case "warning":
      return theme.text.feedback.warning.base
    case "error":
      return theme.text.feedback.error.base
    default:
      return theme.text.base
  }
}

function RowView(props: { theme: Theme; row: Row }) {
  const row = props.row
  if (row.kind === "text") return <text fg={toneColor(props.theme, row.tone)}>{row.text}</text>
  return (
    <text>
      <span style={{ fg: props.theme.text.muted }}>{row.label}</span>
      <span style={{ fg: toneColor(props.theme, row.tone) }}>{row.filled}</span>
      <span style={{ fg: props.theme.border.base }}>{row.empty}</span>
      <span style={{ fg: props.theme.text.base }}>{row.percent}</span>
    </text>
  )
}

export function QuotaView(props: { theme: Theme; rows: () => Row[] }) {
  return (
    <box flexDirection="column" paddingTop={1}>
      <text fg={props.theme.text.base}>
        <b>Claude Quota</b>
      </text>
      <Show when={props.rows().length > 0}>
        <For each={props.rows()}>{(row) => <RowView theme={props.theme} row={row} />}</For>
      </Show>
    </box>
  )
}
