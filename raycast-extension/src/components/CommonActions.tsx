import { Action, ActionPanel, Icon, Keyboard } from "@raycast/api";

export function CommonActions({ onToggleDetail, onRefresh }: { onToggleDetail?: () => void; onRefresh: () => void }) {
  return (
    <ActionPanel.Section>
      {onToggleDetail && (
        <Action
          title="Toggle Details"
          icon={Icon.Sidebar}
          shortcut={{ modifiers: ["cmd"], key: "d" }}
          onAction={onToggleDetail}
        />
      )}
      <Action
        title="Reload from Dalux"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={onRefresh}
      />
    </ActionPanel.Section>
  );
}
